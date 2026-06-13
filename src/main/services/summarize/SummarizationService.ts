import type { Database, ChunkRow } from '../../db/database'
import type { ProviderRegistry } from '../providers/Registry'
import type { LlmProvider } from '../providers/types'
import { estimateTokens, stripThink, DEFAULT_CONTEXT_TOKENS } from '../llm/prompt'
import { detectResponseLanguage } from '../documents/languageDetector'
import {
  buildSummaryPrompt,
  SUMMARY_MAX_TOKENS,
  SUMMARY_PROMPT_RESERVE_TOKENS,
  type SummaryMode,
} from './prompt'

export type SummarizationErrorCode = 'no_content' | 'model_not_ready' | 'failed'

export class SummarizationError extends Error {
  constructor(
    message: string,
    readonly code: SummarizationErrorCode,
  ) {
    super(message)
    this.name = 'SummarizationError'
  }
}

export interface SummarizeResult {
  summary: string
  /** True when the cached summary was returned without re-generating. */
  cached: boolean
}

/**
 * Lazily computes and caches a whole-document summary. First request generates
 * it (one LLM call for a doc that fits the window, map-reduce for longer docs)
 * and stores it on the document row; later requests return the cache instantly.
 * reindex_document nulls the cache so it never goes stale (see migration 0008).
 *
 * Deliberately NOT run at ingest: that would force an LLM generation per
 * imported doc and serialize bulk imports through the models worker.
 */
export class SummarizationService {
  constructor(
    private readonly db: Database,
    private readonly registry: ProviderRegistry,
  ) {}

  async summarize(
    documentId: number,
    opts: { force?: boolean; abortSignal?: AbortSignal } = {},
  ): Promise<SummarizeResult> {
    const repo = this.db.documents()
    const doc = await repo.getDocument(documentId)
    if (!doc) throw new SummarizationError(`Document ${documentId} not found`, 'failed')
    if (!opts.force && doc.summary && doc.summary.trim().length > 0) {
      return { summary: doc.summary, cached: true }
    }

    const chunks = await repo.listChunksForDocument(documentId)
    if (chunks.length === 0) {
      throw new SummarizationError('No indexed content to summarize.', 'no_content')
    }

    const llm = this.registry.llm()
    if (!llm.isReady()) {
      throw new SummarizationError('The language model is not loaded yet.', 'model_not_ready')
    }

    // Summarize in the document's own language. Detect from a slice of the body
    // rather than the title (titles are often filenames / single words).
    const language = await detectResponseLanguage(
      chunks
        .map((c) => c.text)
        .join(' ')
        .slice(0, 2000),
    )

    const ctxTokens = llm.contextWindowTokens() || DEFAULT_CONTEXT_TOKENS
    const budget = Math.max(1000, ctxTokens - SUMMARY_PROMPT_RESERVE_TOKENS - SUMMARY_MAX_TOKENS)
    const windows = packContentWindows(chunks, budget)

    let summary: string
    if (windows.length === 1) {
      summary = await this.generate(
        llm,
        doc.title,
        windows[0]!,
        language,
        'whole',
        opts.abortSignal,
      )
    } else {
      // map: summarize each section, then reduce the partials into one overview.
      const partials: string[] = []
      for (const w of windows) {
        if (opts.abortSignal?.aborted) throw new SummarizationError('cancelled', 'failed')
        partials.push(await this.generate(llm, doc.title, w, language, 'partial', opts.abortSignal))
      }
      summary = await this.generate(
        llm,
        doc.title,
        partials.join('\n\n'),
        language,
        'reduce',
        opts.abortSignal,
      )
    }

    summary = summary.trim()
    if (summary.length === 0) {
      throw new SummarizationError('The model returned an empty summary.', 'failed')
    }
    await repo.setSummary(documentId, summary)
    // Warm the summary-embedding index inline when the embedder is already up
    // (ADR-0003): the corpus route + hierarchical prefilter can then use this
    // doc immediately instead of waiting for the idle backfill. Best-effort —
    // any failure leaves the embedding NULL for the backfill to fill. Not
    // gated by the CPU guard: embedding is a single cheap forward pass, not
    // the multi-window LLM generation that guard is about.
    try {
      const embedder = this.registry.embedder()
      if (embedder.isReady()) {
        const vecs = await embedder.embed([summary])
        const vec = vecs[0]
        if (vec && vec.length > 0) {
          await repo.setSummaryEmbedding(documentId, Array.from(vec), embedder.identity())
        }
      }
    } catch {
      /* embedding is best-effort; the idle backfill will retry */
    }
    return { summary, cached: false }
  }

  private async generate(
    llm: LlmProvider,
    title: string,
    body: string,
    language: 'de' | 'en',
    mode: SummaryMode,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const prompt = buildSummaryPrompt(language, title, body, mode)
    const raw = await llm.generateRaw(prompt, {
      maxTokens: SUMMARY_MAX_TOKENS,
      ...(abortSignal ? { abortSignal } : {}),
    })
    return stripThink(raw).trim()
  }
}

/** Pack chunks (ordinal order) into consecutive windows that each fit `budget`
 *  tokens. A doc within budget becomes exactly one window (single LLM call).
 *  Exported for unit testing. */
export function packContentWindows(chunks: ChunkRow[], budget: number): string[] {
  const windows: string[] = []
  let current: string[] = []
  let currentTokens = 0
  for (const c of chunks) {
    const t = c.token_count ?? estimateTokens(c.text)
    if (current.length > 0 && currentTokens + t > budget) {
      windows.push(current.join('\n\n'))
      current = []
      currentTokens = 0
    }
    current.push(c.text)
    currentTokens += t
  }
  if (current.length > 0) windows.push(current.join('\n\n'))
  return windows
}

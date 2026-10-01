import type { ChunkRow } from '../../db/types'
import type { WorkspaceDbFacade } from '../storage/WorkspaceDbFacade'
import type { ProviderRegistry } from '../providers/Registry'
import type { LlmProvider } from '../providers/types'
import {
  estimateTokens,
  stripThink,
  buildSystemPrompt,
  CHARS_PER_TOKEN,
  CONTEXT_PACK_MARGIN_TOKENS,
  DEFAULT_CONTEXT_TOKENS,
} from '../llm/prompt'
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

const MAX_REDUCTION_LEVELS = 8
// Raw generations inherit the chat system prompt. Reserve its longest supported
// form without changing summary instructions or the user's generation settings.
const SUMMARY_SYSTEM_RESERVE_TOKENS = Math.max(
  estimateTokens(buildSystemPrompt('en', 'thorough', { codebase: true })),
  estimateTokens(buildSystemPrompt('de', 'thorough', { codebase: true })),
)

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
    private readonly db: WorkspaceDbFacade,
    private readonly registry: ProviderRegistry,
  ) {}

  async summarize(
    documentId: number,
    opts: { force?: boolean; abortSignal?: AbortSignal; workspaceId?: number } = {},
  ): Promise<SummarizeResult> {
    opts.abortSignal?.throwIfAborted()
    const initialRepo =
      opts.workspaceId === undefined
        ? this.db.documents()
        : await this.db.documentsFor(opts.workspaceId)
    const doc = await initialRepo.getDocument(documentId)
    opts.abortSignal?.throwIfAborted()
    if (!doc) throw new SummarizationError(`Document ${documentId} not found`, 'failed')
    if (doc.status !== 'ready')
      throw new SummarizationError(
        'The document must finish indexing before summarizing.',
        'no_content',
      )
    if (!opts.force && doc.summary && doc.summary.trim().length > 0) {
      return { summary: doc.summary, cached: true }
    }

    // A library switch while generating must never cache this summary onto a
    // different document with the same workspace-local id.
    const repo =
      opts.workspaceId === undefined ? await this.db.documentsFor(doc.workspaceId) : initialRepo
    const chunks = await repo.listChunksForDocument(documentId)
    opts.abortSignal?.throwIfAborted()
    if (chunks.length === 0 || !chunks.some((chunk) => /\S/u.test(chunk.text))) {
      throw new SummarizationError('No indexed content to summarize.', 'no_content')
    }

    const llm = this.registry.llm()
    if (!llm.isReady()) {
      throw new SummarizationError('The language model is not loaded yet.', 'model_not_ready')
    }

    // Summarize in the document's own language. Detect from a slice of the body
    // rather than the title (titles are often filenames / single words).
    const languageParts: string[] = []
    let remaining = 2000
    for (const chunk of chunks) {
      const prefix = chunk.text.slice(0, remaining)
      languageParts.push(prefix)
      remaining -= prefix.length + 1 // separator between chunks
      if (remaining <= 0) break
    }
    const language = await detectResponseLanguage(languageParts.join(' '))
    opts.abortSignal?.throwIfAborted()

    const preparedContext = llm.prepareContext
      ? await llm.prepareContext(opts.abortSignal ? { abortSignal: opts.abortSignal } : {})
      : llm.contextWindowTokens() || DEFAULT_CONTEXT_TOKENS
    const ctxTokens =
      Number.isFinite(preparedContext) && preparedContext > 0
        ? Math.floor(preparedContext)
        : DEFAULT_CONTEXT_TOKENS
    opts.abortSignal?.throwIfAborted()
    const framing = Math.max(
      ...(['whole', 'partial', 'reduce'] as const).map((mode) =>
        estimateTokens(buildSummaryPrompt(language, doc.title, '', mode)),
      ),
    )
    const budget = Math.floor(
      ctxTokens -
        SUMMARY_MAX_TOKENS -
        Math.max(
          SUMMARY_PROMPT_RESERVE_TOKENS,
          framing + SUMMARY_SYSTEM_RESERVE_TOKENS + CONTEXT_PACK_MARGIN_TOKENS,
        ),
    )
    if (!Number.isFinite(budget) || budget < 128)
      throw new SummarizationError(
        'The model context is too small to summarize this document.',
        'failed',
      )
    const windows = packContentWindows(chunks, budget)

    let summary: string
    if (windows.length === 1) {
      summary = await this.generate(
        llm,
        doc.title,
        windows[0]!,
        language,
        'whole',
        ctxTokens,
        opts.abortSignal,
      )
    } else {
      // map: summarize each section, then reduce the partials into one overview.
      let partials: string[] = []
      for (const w of windows) {
        opts.abortSignal?.throwIfAborted()
        partials.push(
          await this.generate(llm, doc.title, w, language, 'partial', ctxTokens, opts.abortSignal),
        )
      }
      // Every reduction input must fit too. A single concatenation can exceed
      // the window for a long PDF even though each individual map call fits.
      for (let level = 0; ; level++) {
        opts.abortSignal?.throwIfAborted()
        const groups = packTextWindows(
          partials.map((text) => ({ text })),
          budget,
        )
        if (groups.length === 1) {
          summary = await this.generate(
            llm,
            doc.title,
            groups[0]!,
            language,
            'reduce',
            ctxTokens,
            opts.abortSignal,
          )
          break
        }
        if (level >= MAX_REDUCTION_LEVELS || groups.length >= partials.length)
          throw new SummarizationError(
            'The model did not condense the document enough to fit its context. Please summarize a smaller document.',
            'failed',
          )
        const reduced: string[] = []
        for (const group of groups) {
          opts.abortSignal?.throwIfAborted()
          reduced.push(
            await this.generate(
              llm,
              doc.title,
              group,
              language,
              'reduce',
              ctxTokens,
              opts.abortSignal,
            ),
          )
        }
        partials = reduced
      }
    }

    summary = summary.trim()
    opts.abortSignal?.throwIfAborted()
    if (summary.length === 0) {
      throw new SummarizationError('The model returned an empty summary.', 'failed')
    }
    const saved = await repo.setSummary(documentId, summary, {
      contentHash: doc.contentHash,
      chunkCount: chunks.length,
      lastChunkId: chunks.reduce((last, chunk) => Math.max(last, chunk.id), 0),
    })
    opts.abortSignal?.throwIfAborted()
    if (!saved)
      throw new SummarizationError(
        'The document changed while its summary was being generated. Please retry.',
        'failed',
      )
    // Warm the summary-embedding index inline when the embedder is already up
    // (ADR-0003): the corpus route + hierarchical prefilter can then use this
    // doc immediately instead of waiting for the idle backfill. Best-effort —
    // any failure leaves the embedding NULL for the backfill to fill. Not
    // gated by the CPU guard: embedding is a single cheap forward pass, not
    // the multi-window LLM generation that guard is about.
    try {
      const embedder = this.registry.embedder()
      if (embedder.isReady() && embedder.isResident?.() !== false) {
        const vecs = await embedder.embed([summary])
        opts.abortSignal?.throwIfAborted()
        const vec = vecs[0]
        if (vec && vec.length > 0) {
          await repo.setSummaryEmbedding(documentId, Array.from(vec), embedder.identity(), summary)
        }
      }
    } catch {
      opts.abortSignal?.throwIfAborted()
      /* embedding is best-effort; the idle backfill will retry */
    }
    opts.abortSignal?.throwIfAborted()
    return { summary, cached: false }
  }

  private async generate(
    llm: LlmProvider,
    title: string,
    body: string,
    language: 'de' | 'en',
    mode: SummaryMode,
    contextTokens: number,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    abortSignal?.throwIfAborted()
    const prompt = buildSummaryPrompt(language, title, body, mode)
    const raw = await llm.generateRaw(prompt, {
      maxTokens: SUMMARY_MAX_TOKENS,
      plannedContextTokens: contextTokens,
      ...(abortSignal ? { abortSignal } : {}),
    })
    abortSignal?.throwIfAborted()
    const result = stripThink(raw).trim()
    if (!result)
      throw new SummarizationError(
        'The model returned an empty summary section. Please retry.',
        'failed',
      )
    return result
  }
}

/** Pack chunks (ordinal order) into consecutive windows that each fit `budget`
 *  tokens. A doc within budget becomes exactly one window (single LLM call).
 *  Exported for unit testing. */
export function packContentWindows(chunks: ChunkRow[], budget: number): string[] {
  return packTextWindows(chunks, budget)
}

function packTextWindows(
  items: ReadonlyArray<{ text: string; token_count?: number | null }>,
  budget: number,
): string[] {
  if (!Number.isFinite(budget) || budget < 1) throw new Error('Invalid summary context budget.')
  budget = Math.floor(budget)
  const windows: string[] = []
  let current: string[] = []
  let currentTokens = 0
  for (const item of items) {
    if (!item.text) continue
    const tokens = Math.max(item.token_count ?? 0, estimateTokens(item.text))
    // Old imports can contain an individual chunk larger than the whole model
    // window. Split losslessly, at whitespace where practical, never through a
    // surrogate pair; the stored/citable original chunk stays unchanged.
    const charLimit = Math.max(
      2,
      Math.min(
        Math.floor(budget * CHARS_PER_TOKEN),
        Math.floor((item.text.length * budget) / tokens),
      ),
    )
    for (let start = 0; start < item.text.length; ) {
      let end = Math.min(item.text.length, start + charLimit)
      if (end < item.text.length) {
        const boundary = item.text.slice(start, end).search(/\s+\S*$/u)
        if (boundary >= charLimit / 2) end = start + boundary + 1
        if (/[\uD800-\uDBFF]/u.test(item.text[end - 1]!)) end--
      }
      const text = item.text.slice(start, end)
      const cost = Math.max(
        estimateTokens(text),
        Math.ceil((tokens * text.length) / item.text.length),
      )
      if (tokens > budget) {
        if (current.length) windows.push(current.join('\n\n'))
        current = []
        currentTokens = 0
        windows.push(text)
        start = end
        continue
      }
      const separator = current.length > 0 ? estimateTokens('\n\n') : 0
      if (current.length > 0 && currentTokens + separator + cost > budget) {
        windows.push(current.join('\n\n'))
        current = []
        currentTokens = 0
      }
      currentTokens += (current.length > 0 ? estimateTokens('\n\n') : 0) + cost
      current.push(text)
      start = end
    }
  }
  if (current.length > 0) windows.push(current.join('\n\n'))
  return windows
}

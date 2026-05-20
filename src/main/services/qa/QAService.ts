import type { Database } from '../../db/database'
import type { RetrievalService } from '../retrieval/RetrievalService'
import type { LlamaService } from '../llm/LlamaService'
import type { RetrievalHit, StreamEvent, AnswerOptions } from '../../../shared/documents'
import { REFUSAL_TEXT } from '../llm/prompt'

const DEFAULT_TOP_K = 8
// RRF fuses 1/(60+rank) scores so even strong matches sit around 0.03–0.05.
// The score gate is here purely to catch the empty-pool case; we rely on the
// LLM itself to decline when the retrieved chunks don't actually answer.
const DEFAULT_REFUSAL_THRESHOLD = 0

/**
 * Streaming RAG entry-point. Pipeline:
 *   1. Retrieve hybrid hits via RetrievalService.search
 *   2. If 0 hits OR top score < threshold → emit `refusal` + `done`, no LLM call
 *   3. Otherwise emit `citation` events up-front, then stream tokens via LlamaService.ask
 *   4. Emit `done` with the full text + citation list
 *
 * Caller consumes this as an AsyncIterable. The eval harness in AP-E.2 collects
 * events to a final `AnswerResult { answer, citations, refused }`.
 *
 * NOTE: this is not the MVP's QAService (which is a study-question generator
 * for a different AP). Our QAService is the streaming RAG-answer service that
 * Spec 2 names — same name, different feature.
 */
export class QAService {
  constructor(
    private readonly db: Database,
    private readonly retrieval: RetrievalService,
    private readonly llama: LlamaService,
  ) {}

  async *answer(
    workspaceId: number,
    query: string,
    opts: AnswerOptions = {},
  ): AsyncIterable<StreamEvent> {
    void this.db // retained for parity with future enrichment paths
    const topK = opts.topK ?? DEFAULT_TOP_K
    const threshold = opts.refusalThreshold ?? DEFAULT_REFUSAL_THRESHOLD
    const language = opts.language ?? detectLanguage(query)

    // ---- 0. contextualize the retrieval query against prior turns ----
    // The LLM still sees the user's literal question in the prompt; only the
    // text fed to BM25/dense/rerank is rewritten. Failures fall back to the
    // raw query so a flaky LLM never blocks an answer.
    const retrievalQuery =
      opts.contextualize === true && opts.history && opts.history.length > 0
        ? await contextualizeQuery(this.llama, opts.history, query)
        : query

    // ---- 1. retrieve ----
    let hits: RetrievalHit[] = []
    try {
      const searchOpts: Parameters<RetrievalService['search']>[3] = {}
      if (opts.rerank !== undefined) searchOpts.rerank = opts.rerank
      if (opts.multiQuery !== undefined) searchOpts.multiQuery = opts.multiQuery
      if (opts.activeDocumentIds !== undefined)
        searchOpts.activeDocumentIds = opts.activeDocumentIds
      hits = await this.retrieval.search(workspaceId, retrievalQuery, topK, searchOpts)
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
      return
    }

    // ---- 2. refusal path ----
    const topScore = hits[0]?.score ?? 0
    if (hits.length === 0 || topScore < threshold) {
      const reason = hits.length === 0 ? 'no_hits' : 'below_threshold'
      const message = REFUSAL_TEXT[language]
      const suggestions = uniqueByDoc(hits, 3).map((h) => ({
        doc_id: h.document_id,
        title: h.document_title,
        score: h.score,
      }))
      yield { type: 'refusal', reason, message, suggestions }
      yield { type: 'done', full_text: message, citations: [] }
      return
    }

    // ---- 3. citations + streaming generation ----
    const citations = hits.map((h) => ({
      doc_id: h.document_id,
      chunk_id: h.chunk_id,
      score: h.score,
    }))
    for (const c of citations) {
      yield { type: 'citation', ...c }
    }

    // collect token chunks into a thread-safe queue; consumer drains while
    // LlamaService.ask runs concurrently.
    const queue: string[] = []
    const collector = (chunk: string): void => {
      queue.push(chunk)
    }

    let collectedFull = ''
    try {
      const askOpts: Parameters<LlamaService['ask']>[2] = {
        onChunk: collector,
      }
      if (opts.history) askOpts.conversationHistory = opts.history
      const askPromise = this.llama.ask(query, hits, askOpts)
      // drain the queue while ask is still running
      while (true) {
        if (queue.length > 0) {
          while (queue.length > 0) {
            yield { type: 'token', text: queue.shift()! }
          }
        }
        const settled = await Promise.race([askPromise, sleep(15)])
        if (settled !== SLEEP_SENTINEL) {
          collectedFull = settled as string
          break
        }
      }
      // flush any final buffered chunks the ask() resolution raced past
      while (queue.length > 0) {
        yield { type: 'token', text: queue.shift()! }
      }
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
      return
    }

    yield {
      type: 'done',
      full_text: collectedFull,
      citations,
    }
  }
}

const SLEEP_SENTINEL = Symbol('sleep')
function sleep(ms: number): Promise<typeof SLEEP_SENTINEL> {
  return new Promise((r) => setTimeout(() => r(SLEEP_SENTINEL), ms))
}

// Cap the history we send to the rewriter — recent turns carry the topic;
// older ones mostly add noise and risk overflowing the small generation we
// want here.
const CONTEXTUALIZE_MAX_TURNS = 6
const CONTEXTUALIZE_PER_TURN_CHARS = 600

/** Minimal surface of LlamaService that the rewriter needs. Defined locally
 *  so the helper can be unit-tested without instantiating LlamaService. */
export interface ContextualizerLLM {
  isReady(): boolean
  generateRaw(prompt: string): Promise<string>
}

/**
 * Rewrite a follow-up question into a standalone search query using prior
 * conversation turns. Returns the original `query` unchanged if the LLM is
 * unavailable, the rewrite errors, or the rewrite comes back empty/too long.
 *
 * Exported for unit tests; QAService.answer calls it via the local
 * `contextualizeQuery` symbol.
 */
export async function contextualizeQuery(
  llama: ContextualizerLLM,
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
  query: string,
): Promise<string> {
  if (!llama.isReady() || history.length === 0) return query
  const recent = history.slice(-CONTEXTUALIZE_MAX_TURNS)
  const lines = recent.map((m) => {
    const role = m.role === 'user' ? 'User' : 'Assistant'
    const text =
      m.content.length > CONTEXTUALIZE_PER_TURN_CHARS
        ? m.content.slice(0, CONTEXTUALIZE_PER_TURN_CHARS) + '…'
        : m.content
    return `${role}: ${text}`
  })
  const prompt =
    `You are rewriting a follow-up question into a standalone search query for a document-retrieval system.\n` +
    `Use the conversation to resolve pronouns and "more / also / again" references. Keep the user's language. ` +
    `Output ONLY the rewritten query on a single line — no quotes, no preamble, no explanation. ` +
    `If the question is already standalone, return it unchanged.\n\n` +
    `Conversation:\n${lines.join('\n')}\n\n` +
    `Follow-up question: ${query}\n\n` +
    `Standalone query:`
  try {
    const raw = await llama.generateRaw(prompt)
    const cleaned = cleanRewrite(raw)
    if (!cleaned) return query
    // Guard: if the model returned a multi-paragraph essay, fall back —
    // something went wrong with the instruction-following.
    if (cleaned.length > 400) return query
    return cleaned
  } catch {
    return query
  }
}

function cleanRewrite(raw: string): string {
  // Take the first non-empty line, strip surrounding quotes/markdown markers.
  const firstLine = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0)
  if (!firstLine) return ''
  return firstLine.replace(/^[`'"\s]+|[`'"\s]+$/g, '').replace(/^(query|search):\s*/i, '')
}

function uniqueByDoc(hits: RetrievalHit[], limit: number): RetrievalHit[] {
  const seen = new Set<number>()
  const out: RetrievalHit[] = []
  for (const h of hits) {
    if (seen.has(h.document_id)) continue
    seen.add(h.document_id)
    out.push(h)
    if (out.length >= limit) break
  }
  return out
}

// crude language detect for refusal-text selection only. Real language
// binding happens via LlamaService profile/system-prompt; this fallback
// only matters when we never call the LLM (refusal path).
function detectLanguage(query: string): 'de' | 'en' {
  if (/[äöüß]/i.test(query)) return 'de'
  if (/\b(was|wie|wer|wo|wann|warum|der|die|das|ist|sind)\b/i.test(query)) return 'de'
  return 'en'
}

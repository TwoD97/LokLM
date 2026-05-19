import type { Database } from '../../db/database'
import type { RetrievalService } from '../retrieval/RetrievalService'
import type { LlamaService } from '../llm/LlamaService'
import type { RetrievalHit, StreamEvent, AnswerOptions } from '../../../shared/documents'
import { REFUSAL_TEXT } from '../llm/prompt'

const DEFAULT_TOP_K = 8
const DEFAULT_REFUSAL_THRESHOLD = 0.3

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

    // ---- 1. retrieve ----
    let hits: RetrievalHit[] = []
    try {
      const searchOpts: Parameters<RetrievalService['search']>[3] = {}
      if (opts.rerank !== undefined) searchOpts.rerank = opts.rerank
      if (opts.multiQuery !== undefined) searchOpts.multiQuery = opts.multiQuery
      if (opts.activeDocumentIds !== undefined)
        searchOpts.activeDocumentIds = opts.activeDocumentIds
      hits = await this.retrieval.search(workspaceId, query, topK, searchOpts)
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

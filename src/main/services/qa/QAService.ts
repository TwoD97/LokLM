import type { Database } from '../../db/database'
import type { RetrievalService } from '../retrieval/RetrievalService'
import type { ProviderRegistry } from '../providers/Registry'
import type { AskOptions } from '../llm/LlamaService'
import type { RetrievalHit, StreamEvent, AnswerOptions, StageName } from '../../../shared/documents'
import {
  REFUSAL_TEXT,
  buildSystemPrompt,
  packHitsToBudget,
  answerMaxTokens,
  estimateTokens,
  estimateHistoryTokens,
  DEFAULT_CONTEXT_TOKENS,
  CONTEXT_PACK_MARGIN_TOKENS,
} from '../llm/prompt'
import { detectResponseLanguage } from '../documents/languageDetector'

// 3 wins on the eval sweep (tests/evals/report/runs/2026-05-20T19-46-39…):
// across Qwen3-8B, Granite-3.3-8B and Mistral-Nemo-12B, k=3 was best- or
// tied-best on Nemotron-judged answer quality (~0.92), and TTFT scales
// with prompt length so smaller k is also a latency win. Bigger k didn't
// improve quality on this corpus and just slowed prefill.
//
// The eval set is mostly focused factoid questions ("what is X?", "wie funktioniert Y?").
// For summary / comparison / list-style intents 3 chunks is too few — the
// model can't see enough of the document to answer. classifyQueryBreadth
// detects those and bumps topK; callers that pin opts.topK (evals, tests)
// bypass the heuristic entirely.
const FOCUSED_TOP_K = 3
const BROAD_TOP_K = 8
const SUMMARY_TOP_K = 12
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
    private readonly registry: ProviderRegistry,
  ) {}

  async *answer(
    workspaceId: number,
    query: string,
    opts: AnswerOptions = {},
    /** Server-side abort signal — the chat:cancel IPC fires this so
     *  contextualize + expand-queries LLM calls (which used to run to
     *  completion regardless of cancel) can be torn down on user cancel.
     *  Not part of AnswerOptions because that type round-trips through
     *  IPC and AbortSignal isn't structured-cloneable. */
    abortSignal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    void this.db // retained for parity with future enrichment paths
    const topK = opts.topK ?? adaptiveTopK(query)
    const threshold = opts.refusalThreshold ?? DEFAULT_REFUSAL_THRESHOLD
    // Answer language: forced when the caller set opts.language ('de'/'en'),
    // otherwise auto — detect it from the query (Auto mode). detectResponseLanguage
    // only loads eld for queries long enough to score reliably ; short prompts
    // take the regex path, so the common case stays cheap.
    const language = opts.language ?? (await detectResponseLanguage(query))

    // Stage events emitted from inside awaited helpers (RetrievalService) land
    // here; we drain the buffer between awaits and re-yield as StreamEvents.
    // Storing start-times keyed by stage name so the matching 'done' event can
    // attach a wall-clock durationMs the renderer prints next to each step.
    const stageBuffer: StreamEvent[] = []
    const stageStarts = new Map<string, number>()
    const emitStage = (stage: StageName, status: 'start' | 'done', detail?: string): void => {
      if (status === 'start') {
        stageStarts.set(stage, performance.now())
        const ev: StreamEvent = { type: 'stage', stage, status: 'start' }
        if (detail !== undefined) (ev as { detail?: string }).detail = detail
        stageBuffer.push(ev)
      } else {
        const startedAt = stageStarts.get(stage)
        const durationMs =
          startedAt != null ? Math.max(0, Math.round(performance.now() - startedAt)) : undefined
        const ev: StreamEvent = { type: 'stage', stage, status: 'done' }
        if (durationMs !== undefined) (ev as { durationMs?: number }).durationMs = durationMs
        if (detail !== undefined) (ev as { detail?: string }).detail = detail
        stageBuffer.push(ev)
      }
    }

    // ---- 0. contextualize the retrieval query against prior turns ----
    // The LLM still sees the user's literal question in the prompt; only the
    // text fed to BM25/dense/rerank is rewritten. Failures fall back to the
    // raw query so a flaky LLM never blocks an answer.
    let retrievalQuery = query
    if (opts.contextualize === true && opts.history && opts.history.length > 0) {
      emitStage('contextualize', 'start')
      // Drain immediately so the renderer sees the row before the (possibly
      // multi-hundred-ms) LLM rewrite call awaits.
      while (stageBuffer.length > 0) yield stageBuffer.shift()!
      retrievalQuery = await contextualizeQuery(
        this.registry.llm(),
        opts.history,
        query,
        abortSignal ? { abortSignal } : {},
      )
      emitStage('contextualize', 'done', retrievalQuery === query ? 'unchanged' : 'rewritten')
      while (stageBuffer.length > 0) yield stageBuffer.shift()!
    }

    // ---- 1. retrieve ----
    let hits: RetrievalHit[] = []
    try {
      const searchOpts: Parameters<RetrievalService['search']>[3] = {
        onStage: emitStage,
        // Hands RetrievalService the response language so applyLanguageMatchBoost
        // can favour matching-language chunks at rank time (mig 0007 / eld).
        // Computed via opts.language ?? detectLanguage(query) up at line 62 so
        // retrieval and the LLM agree on the target language.
        responseLanguage: language,
      }
      if (opts.rerank !== undefined) searchOpts.rerank = opts.rerank
      if (opts.multiQuery !== undefined) searchOpts.multiQuery = opts.multiQuery
      if (opts.activeDocumentIds !== undefined)
        searchOpts.activeDocumentIds = opts.activeDocumentIds
      // Race the search promise against a short tick so we can drain the
      // stageBuffer mid-flight — RetrievalService emits its stage events from
      // inside the same awaited call, and without interleaving the renderer
      // wouldn't see them until search() resolved.
      const searchPromise = this.retrieval
        .search(workspaceId, retrievalQuery, topK, searchOpts)
        .then((r) => ({ ok: true as const, hits: r }))
        .catch((err) => ({ ok: false as const, err }))
      while (true) {
        while (stageBuffer.length > 0) yield stageBuffer.shift()!
        const settled = await Promise.race([searchPromise, sleep(15)])
        if (settled !== SLEEP_SENTINEL) {
          const result = settled as { ok: true; hits: RetrievalHit[] } | { ok: false; err: unknown }
          if (!result.ok) {
            yield {
              type: 'error',
              message: result.err instanceof Error ? result.err.message : String(result.err),
            }
            return
          }
          hits = result.hits
          break
        }
      }
      // Flush any remaining stage events the race may have skipped past.
      while (stageBuffer.length > 0) yield stageBuffer.shift()!
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

    // ---- 2.5 pack the Context block to the model's window ----
    // Trim hits so the prompt fits the (often small) local context window.
    // CRITICAL: this runs BEFORE citations are emitted, so the chips the UI
    // shows match exactly what the model was fed — packing inside the provider
    // would surface citations for chunks that got trimmed out of the prompt.
    // The LlamaService overflow-retry stays as a belt-and-suspenders fallback
    // for any non-QAService caller that passes unpacked hits.
    const ctxTokens = this.registry.llm().contextWindowTokens() || DEFAULT_CONTEXT_TOKENS
    const contextBudget =
      ctxTokens -
      answerMaxTokens(ctxTokens) -
      estimateTokens(buildSystemPrompt(language)) -
      estimateHistoryTokens(opts.history) -
      estimateTokens(query) -
      CONTEXT_PACK_MARGIN_TOKENS
    const fedHits = packHitsToBudget(hits, contextBudget, language)

    // ---- 3. citations + streaming generation ----
    const citations = fedHits.map((h) => ({
      doc_id: h.document_id,
      chunk_id: h.chunk_id,
      score: h.score,
    }))
    for (const c of citations) {
      yield { type: 'citation', ...c }
    }

    // Prefill = the gap between "prompt assembled" and "first token". On CPU
    // this is the dominant unobserved latency; emitting start now and done on
    // the first token gives the user something to watch.
    emitStage('prefill', 'start')
    while (stageBuffer.length > 0) yield stageBuffer.shift()!

    // collect token chunks into a thread-safe queue; consumer drains while
    // LlamaService.ask runs concurrently. We carry the native-chunk count so
    // the renderer's tokens/sec metric reflects the underlying llama.cpp
    // chunk rate, not the 125 Hz batched-push ceiling.
    const queue: Array<{ text: string; count: number }> = []
    const collector = (text: string, count: number): void => {
      queue.push({ text, count })
    }

    let collectedFull = ''
    let prefillClosed = false
    try {
      const askOpts: AskOptions = {
        onChunk: collector,
      }
      if (opts.history) askOpts.conversationHistory = opts.history
      // Forward the server-side cancel signal so chat:cancel tears down the
      // worker generation (the longest LLM call) — not just the contextualize
      // step. LlamaService.askWithModel wires this to llmAbort(streamId).
      if (abortSignal) askOpts.abortSignal = abortSignal
      // Bind the provider to this turn's language before streaming. Awaited so
      // the bundled worker's system prompt is in place before llmAsk (it holds
      // the prompt as session state). No-op when the language is unchanged.
      await this.registry.llm().setLanguage(language)
      const askPromise = this.registry.llm().ask(query, fedHits, askOpts)
      // drain the queue while ask is still running
      while (true) {
        if (queue.length > 0) {
          if (!prefillClosed) {
            emitStage('prefill', 'done')
            prefillClosed = true
            while (stageBuffer.length > 0) yield stageBuffer.shift()!
          }
          while (queue.length > 0) {
            const next = queue.shift()!
            yield { type: 'token', text: next.text, count: next.count }
          }
        }
        const settled = await Promise.race([askPromise, sleep(15)])
        if (settled !== SLEEP_SENTINEL) {
          collectedFull = settled as string
          break
        }
      }
      // flush any final buffered chunks the ask() resolution raced past
      if (!prefillClosed && queue.length > 0) {
        emitStage('prefill', 'done')
        prefillClosed = true
        while (stageBuffer.length > 0) yield stageBuffer.shift()!
      }
      while (queue.length > 0) {
        const next = queue.shift()!
        yield { type: 'token', text: next.text, count: next.count }
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
 *  so the helper can be unit-tested without instantiating LlamaService. The
 *  generateRaw signature matches LlmProvider so a ProviderRegistry.llm() is
 *  structurally assignable here; the existing unit-test fakes pass a vi.fn
 *  which accepts arbitrary extra args. */
export interface ContextualizerLLM {
  isReady(): boolean
  generateRaw(
    prompt: string,
    opts: { abortSignal?: AbortSignal; maxTokens?: number },
  ): Promise<string>
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
  opts: { abortSignal?: AbortSignal } = {},
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
    // 96 tokens is enough for any reasonable rewrite ("how about X" → "X
    // explained" stays well under) and prevents a model that ignores
    // "single line only" from spending hundreds of tokens before the
    // length guard kicks in. abortSignal lets the chat-cancel path stop
    // the rewrite mid-stream.
    const rawOpts: { abortSignal?: AbortSignal; maxTokens?: number } = { maxTokens: 96 }
    if (opts.abortSignal) rawOpts.abortSignal = opts.abortSignal
    const raw = await llama.generateRaw(prompt, rawOpts)
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

const REWRITE_PREAMBLES =
  /^(query|search|standalone query|rewritten|user question|follow[- ]?up|here is.*?):\s*/i

function cleanRewrite(raw: string): string {
  // Take the first non-empty line, strip surrounding quotes/markdown markers.
  const firstLine = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0)
  if (!firstLine) return ''
  // Strip outer quotes/whitespace, then peel off any common LLM preamble.
  // Run the strip twice so `"Query: foo"` → strip outer quotes → strip
  // prefix → `foo` works even when both wrappers are present.
  let cleaned = firstLine.replace(/^[`'"\s]+|[`'"\s]+$/g, '').replace(REWRITE_PREAMBLES, '')
  cleaned = cleaned.replace(/^[`'"\s]+|[`'"\s]+$/g, '')
  return cleaned
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

export type QueryBreadth = 'focused' | 'broad' | 'summary'

// Patterns deliberately tight: false-positives only cost prefill latency
// (topK 3→8 or 3→12) , false-negatives leave the answer underspecified ,
// which is the worse failure. When in doubt , stay focused.
// Note on `\b` and German umlauts: JS regex `\b` is ASCII-only , so
// `\bübersicht\b` does NOT match "übersicht" at start of string (the position
// before 'ü' is not a word boundary because 'ü' isn't \w). Patterns containing
// non-ASCII letters at their edges drop the `\b` and rely on the stem itself
// being unique enough to avoid false positives.
const SUMMARY_PATTERNS: RegExp[] = [
  /\bsummari[sz]e\b/i,
  /\bsummary\b/i,
  /\btl;?dr\b/i,
  /\boverview\b/i,
  /\brecap\b/i,
  /\bin (a |one )?(few|short) (words|sentences)\b/i,
  /zusammenfass/i,
  /kurzfassung/i,
  /überblick/i,
  /übersicht/i,
  // "fasse … zusammen" / "fass das mal zusammen" — split verb , window-limited
  /\bfass(e|t|en)?\b[^.?!\n]{0,40}\bzusammen\b/i,
]

const BROAD_PATTERNS: RegExp[] = [
  /\blist (all|every|each|the)\b/i,
  /\benumerate\b/i,
  /\bwhat are (all|the)\b/i,
  /\bwhich (ones|of|are)\b/i,
  /\bevery\b/i,
  /\beach of\b/i,
  /\bcompare\b/i,
  /\bcontrast\b/i,
  /\bdifferences? between\b/i,
  /\bsimilarit(y|ies)\b/i,
  /\b(versus|vs\.?)\b/i,
  /\balle\b/i,
  /sämtliche/i,
  /\bjede[rs]?\b/i,
  /\bwelche\b/i,
  /\bnenne\b/i,
  /\bzähl(e|en)?\b[^.?!\n]{0,40}\bauf\b/i,
  /\bvergleich/i,
  /\bunterschied/i,
  /gegenüber/i,
]

/**
 * Classify a query by how much of the document(s) it needs to see.
 * Summary > broad > focused. Pure , regex-only , no LLM call — runs on the
 * hot path before retrieval. Bilingual (DE/EN) to match the rest of the
 * pipeline.
 */
export function classifyQueryBreadth(query: string): QueryBreadth {
  if (SUMMARY_PATTERNS.some((p) => p.test(query))) return 'summary'
  if (BROAD_PATTERNS.some((p) => p.test(query))) return 'broad'
  return 'focused'
}

/** Maps classified breadth to a topK. Exported for tests and for callers
 *  that want the heuristic without going through QAService.answer. */
export function adaptiveTopK(query: string): number {
  switch (classifyQueryBreadth(query)) {
    case 'summary':
      return SUMMARY_TOP_K
    case 'broad':
      return BROAD_TOP_K
    case 'focused':
      return FOCUSED_TOP_K
  }
}

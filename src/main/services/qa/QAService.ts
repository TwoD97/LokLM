import type { Database, ChunkRow } from '../../db/database'
import type { RetrievalService } from '../retrieval/RetrievalService'
import type { ProviderRegistry } from '../providers/Registry'
import type { AskOptions } from '../llm/LlamaService'
import type { Document } from '../../db/schema'
import type { SummarizationService } from '../summarize/SummarizationService'
import type { RetrievalHit, StreamEvent, AnswerOptions, StageName } from '../../../shared/documents'
import {
  REFUSAL_TEXT,
  buildSystemPrompt,
  buildSummaryPreamble,
  packHitsToBudget,
  answerMaxTokens,
  estimateTokens,
  estimateHistoryTokens,
  DEFAULT_CONTEXT_TOKENS,
  CONTEXT_PACK_MARGIN_TOKENS,
} from '../llm/prompt'
import { SUMMARY_MAX_TOKENS, SUMMARY_PROMPT_RESERVE_TOKENS } from '../summarize/prompt'
import { detectResponseLanguage } from '../documents/languageDetector'
import {
  classifyQueryBreadth,
  adaptiveTopK,
  detectCorpusIntent,
  resolveRoute,
  type QueryRoute,
} from './router'
import { renderCorpusAnswer, CORPUS_LIST_MAX, type CorpusDoc } from './corpusAnswer'

// Breadth classifier + adaptiveTopK moved to ./router (the route layer reuses
// their patterns); re-exported here so existing imports (queryBreadth.test.ts,
// eval configs) keep resolving against the historical path.
export { classifyQueryBreadth, adaptiveTopK, type QueryBreadth } from './router'

// RRF fuses 1/(60+rank) scores so even strong matches sit around 0.03–0.05.
// The score gate is here purely to catch the empty-pool case; we rely on the
// LLM itself to decline when the retrieved chunks don't actually answer.
const DEFAULT_REFUSAL_THRESHOLD = 0

// Chunk top-up depth for the doc_summary route. The cached summary is the
// primary context; these are the doc's best reranked chunks packed into the
// REMAINING budget so the model has citable excerpts. Deliberately ignores
// the caller's opts.topK — that knob sizes the chunk pipeline, and on this
// route chunks are the garnish, not the meal.
const SUMMARY_ROUTE_TOP_K = 6

// CPU guard for the doc_summary route on a summary-cache MISS: generating the
// summary first means map-reduce over the whole doc BEFORE the first answer
// token. On GPU that's tolerable (seconds); on CPU a doc spanning more than a
// couple of generation windows is minutes of silence — worse than the topK-12
// fragment behaviour this route replaces. Above this window estimate we fall
// back to plain retrieval (the Library "Summarize" action remains the way to
// warm the cache explicitly).
const CPU_SUMMARY_MAX_WINDOWS = 2

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
    private readonly summarization: SummarizationService,
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
    // Pinned docs are workspace-scoped "force into context" — fetched up-front
    // so the refusal path can skip "no hits" when pinned content alone could
    // answer the question, and so the packer can reserve budget for them.
    const docsRepo = this.db.documents()
    const pinnedDocs = await docsRepo.listPinned(workspaceId)
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

    // ---- 0. route ----
    // Regex-first dispatch (ADR-0003): "summarize document X" goes to the
    // cached whole-doc summarizer , "how many / which documents about X" to
    // the documents table — instead of pretending chunk top-k can answer
    // either. The stage row only appears when a route pattern actually fired —
    // same no-op-row convention as expand_queries/rerank. Resolution misses
    // (no / ambiguous title match) fall through to plain retrieval , never an
    // error , never an LLM guess. The lazy getDocuments keeps non-summary
    // queries at zero extra DB round-trips.
    let route: QueryRoute = { kind: 'retrieval' }
    // Summary text + title held until AFTER budget packing — the preamble
    // wording depends on whether excerpt blocks actually survived the pack
    // (buildSummaryPreamble's hasExcerpts variant).
    let summaryInfo: { title: string; summary: string } | null = null
    let summaryDocId: number | null = null
    if (
      opts.routing !== false &&
      (detectCorpusIntent(query) !== null || classifyQueryBreadth(query) === 'summary')
    ) {
      emitStage('route', 'start')
      while (stageBuffer.length > 0) yield stageBuffer.shift()!
      route = await resolveRoute(query, {
        activeDocumentIds: opts.activeDocumentIds ?? null,
        getDocuments: () => this.db.documents().listDocumentTitles(workspaceId),
        // Exactly one workspace-pinned doc = the implied subject of "fasse
        // das zusammen" — but only as last resort behind title matching.
        pinnedFallbackDocumentId: pinnedDocs.length === 1 ? pinnedDocs[0]!.id : null,
      })

      // ---- corpus route: answered from the documents table , no LLM ----
      // A count is exact or it is wrong — the answer is templated (DE/EN) and
      // each listed doc carries a [doc, chunk] marker on its first chunk so
      // chips , persistence reconciliation and SourceViewer work unchanged.
      // Zero matches → the existing refusal contract (GraphRAG's zero-evidence
      // guard: fixed localized text , no generation).
      if (route.kind === 'corpus') {
        emitStage('route', 'done', '→ corpus')
        emitStage('corpus', 'start')
        while (stageBuffer.length > 0) yield stageBuffer.shift()!
        // Summary-embedding signal (DocumentSummaryIndex, ADR-0003): embed the
        // theme so docs that are ABOUT it but share no literal token still
        // surface. Best-effort + lazy — needs the embedder up AND docs with
        // summary embeddings; otherwise searchDocumentsByTheme falls back to
        // the title/summary ILIKE + chunk doc_aggs signals. NOT an LLM call.
        let themeEmbedding: number[] | null = null
        if (route.themeTokens.length > 0) {
          const embedder = this.registry.embedder()
          if (embedder.isReady()) {
            try {
              const vecs = await embedder.embed([route.themeTokens.join(' ')])
              const v = vecs[0]
              if (v && v.length > 0) themeEmbedding = Array.from(v)
            } catch {
              /* fall back to literal matching */
            }
          }
        }
        let corpusDocs: CorpusDoc[]
        try {
          corpusDocs = await this.db
            .documents()
            .searchDocumentsByTheme(workspaceId, route.themeTokens, {
              activeDocumentIds: opts.activeDocumentIds ?? null,
              themeEmbedding,
            })
        } catch (err) {
          yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
          return
        }
        emitStage('corpus', 'done', `${corpusDocs.length} docs`)
        while (stageBuffer.length > 0) yield stageBuffer.shift()!

        if (corpusDocs.length === 0) {
          const message = REFUSAL_TEXT[language]
          yield { type: 'refusal', reason: 'no_hits', message, suggestions: [] }
          yield { type: 'done', full_text: message, citations: [] }
          return
        }

        // Citations must mirror renderCorpusAnswer's list EXACTLY: it slices to
        // CORPUS_LIST_MAX first, THEN drops markers for chunk-less docs. Doing
        // filter-then-slice here would pull a doc from past the cut into the
        // citation set whose marker appears nowhere in the rendered text.
        const maxHits = Math.max(1, ...corpusDocs.map((d) => d.chunkHits))
        const citations = corpusDocs
          .slice(0, CORPUS_LIST_MAX)
          .filter((d) => d.firstChunkId != null)
          .map((d) => ({
            doc_id: d.id,
            chunk_id: d.firstChunkId!,
            score: d.chunkHits / maxHits,
          }))
        for (const c of citations) {
          yield { type: 'citation', ...c }
        }
        const text = renderCorpusAnswer(language, route.intent, route.themeTokens, corpusDocs, {
          scoped: (opts.activeDocumentIds?.length ?? 0) > 0,
        })
        yield { type: 'token', text, count: 1 }
        yield { type: 'done', full_text: text, citations }
        return
      }

      // ---- doc_summary gates + summary fetch/generation ----
      // On success the summary becomes an uncited Context preamble (Option A
      // of ADR-0003 — the citation contract stays chunk-bound) and the chunk
      // search below narrows to the target doc as a citation top-up. Every
      // failure path falls through to plain retrieval — and the route 'done'
      // detail reports the OUTCOME of these gates , not the resolution alone ,
      // so the pipeline strip never claims a summary route that was abandoned.
      let routeDetail = '→ retrieval'
      let routeDoneEmitted = false
      if (route.kind === 'doc_summary') {
        const target = await this.db.documents().getDocument(route.documentId)
        const llm = this.registry.llm()
        const cached = Boolean(target?.summary && target.summary.trim().length > 0)
        // Window estimate mirrors SummarizationService's packContentWindows
        // budget math but works off the documents row (no chunk load) — it
        // only gates the CPU fallback , a rough token count is enough.
        const ctxTokensForGen = llm.contextWindowTokens() || DEFAULT_CONTEXT_TOKENS
        const genBudget = Math.max(
          1000,
          ctxTokensForGen - SUMMARY_PROMPT_RESERVE_TOKENS - SUMMARY_MAX_TOKENS,
        )
        const estWindows = Math.ceil((target?.tokenCount ?? 0) / genBudget)
        // isCpuInference is optional on the provider contract; unknown (Ollama)
        // counts as not-CPU — same semantics as LlamaService's gpuLabel check.
        const cpuInference = llm.isCpuInference?.() ?? false
        // Status + workspace gate: the title-match path only ever sees 'ready'
        // docs of this workspace (listDocumentTitles) , but the single-pin
        // shortcut returns an unvalidated id. Summarizing a mid-index or
        // failed doc would CACHE a partial-content summary that survives
        // until the next reindex; a foreign-workspace id must not leak its
        // summary into this chat either.
        const eligible =
          target != null && target.status === 'ready' && target.workspaceId === workspaceId
        if (!eligible) {
          routeDetail = '→ retrieval (doc not ready)'
        } else if (!cached && cpuInference && estWindows > CPU_SUMMARY_MAX_WINDOWS) {
          // Cache miss on a long doc with CPU inference: map-reduce before the
          // first token would be minutes of silence. The Library "Summarize"
          // action stays the way to warm the cache explicitly.
          routeDetail = '→ retrieval (cpu guard)'
        } else {
          routeDetail = '→ summary'
          emitStage('route', 'done', routeDetail)
          routeDoneEmitted = true
          emitStage('summarize', 'start')
          while (stageBuffer.length > 0) yield stageBuffer.shift()!
          try {
            const res = await this.summarization.summarize(
              route.documentId,
              abortSignal ? { abortSignal } : {},
            )
            summaryInfo = { title: target.title, summary: res.summary }
            summaryDocId = route.documentId
            emitStage('summarize', 'done', res.cached ? 'cached' : 'generated')
          } catch {
            // SummarizationError (model_not_ready / no_content / failed) — the
            // retrieval pipeline still answers. Aborts stop the stream.
            if (abortSignal?.aborted) return
            emitStage('summarize', 'done', 'failed — retrieval fallback')
          }
          while (stageBuffer.length > 0) yield stageBuffer.shift()!
        }
      }
      if (!routeDoneEmitted) {
        emitStage('route', 'done', routeDetail)
        while (stageBuffer.length > 0) yield stageBuffer.shift()!
      }
    }

    // ---- 0.5 contextualize the retrieval query against prior turns ----
    // The LLM still sees the user's literal question in the prompt; only the
    // text fed to BM25/dense/rerank is rewritten. Failures fall back to the
    // raw query so a flaky LLM never blocks an answer. Skipped on the summary
    // route — the target doc is already resolved , and the top-up search is
    // pinned to it anyway , so the rewrite LLM pass would buy nothing.
    let retrievalQuery = query
    if (
      summaryDocId == null &&
      opts.contextualize === true &&
      opts.history &&
      opts.history.length > 0
    ) {
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
      // Summary route: the chunk search is a citation top-up within the
      // resolved doc — pin it there and cap the depth (the summary preamble
      // is the primary context; opts.topK sizes the chunk pipeline , not this).
      if (summaryDocId != null) {
        searchOpts.activeDocumentIds = [summaryDocId]
        searchOpts.multiQuery = false
      }
      const effectiveTopK = summaryDocId != null ? SUMMARY_ROUTE_TOP_K : topK
      // Race the search promise against a short tick so we can drain the
      // stageBuffer mid-flight — RetrievalService emits its stage events from
      // inside the same awaited call, and without interleaving the renderer
      // wouldn't see them until search() resolved.
      const searchPromise = this.retrieval
        .search(workspaceId, retrievalQuery, effectiveTopK, searchOpts)
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

    // ---- 2. early refusal (below threshold) ----
    // Caller-overridden refusalThreshold short-circuits here so we don't pay
    // for the pinned-doc fetch + packing on a turn that's definitely going to
    // refuse. The "no context at all" case is checked AFTER packing instead,
    // so pinned-but-empty workspaces refuse cleanly instead of letting the
    // model hallucinate from a (none) Context block. Skipped entirely on the
    // summary route: the cached summary IS the evidence , and a resolved doc
    // whose chunks don't match the query phrasing must still get its summary
    // answered (doc-pinned zero-hit fallback , ADR-0003).
    const topScore = hits[0]?.score ?? 0
    if (summaryInfo == null && hits.length > 0 && topScore < threshold) {
      const message = REFUSAL_TEXT[language]
      const suggestions = uniqueByDoc(hits, 3).map((h) => ({
        doc_id: h.document_id,
        title: h.document_title,
        score: h.score,
      }))
      yield { type: 'refusal', reason: 'below_threshold', message, suggestions }
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
    // Stable-content-first fill order (ADR-0003): the pinned reserve and the
    // summary preamble are budgeted up front — RAG chunk top-ups absorb the
    // overflow , never the other way around. The preamble is budgeted with
    // the hasExcerpts=true wording (the longer of the two variants differs
    // by a handful of tokens — CONTEXT_PACK_MARGIN absorbs the delta); the
    // final wording is picked after packing , once we know whether any
    // excerpt blocks survived.
    const preambleForBudget = summaryInfo
      ? buildSummaryPreamble(language, summaryInfo.title, summaryInfo.summary, true)
      : null
    const totalBudget =
      ctxTokens -
      answerMaxTokens(ctxTokens) -
      estimateTokens(buildSystemPrompt(language)) -
      estimateHistoryTokens(opts.history) -
      estimateTokens(query) -
      (preambleForBudget ? estimateTokens(preambleForBudget) : 0) -
      CONTEXT_PACK_MARGIN_TOKENS

    // Reserve a slice of the budget for pinned-doc chunks so they're guaranteed
    // a seat; RAG hits compete for the remainder. With no pinned docs the
    // packer collapses to the previous behaviour (RAG gets everything).
    const pinnedBudget = pinnedBudgetTokens(totalBudget, pinnedDocs.length)
    const ragBudget = totalBudget - pinnedBudget

    const pinnedHits: RetrievalHit[] = []
    if (pinnedDocs.length > 0 && pinnedBudget > 0) {
      // Per-doc fair share. The Math.max(1, …) gives the "keep at least one"
      // guarantee even on tight budgets with many pinned docs; packHitsToBudget
      // itself also keeps the top hit when its argument is below one chunk's
      // cost, so combined this never drops a pinned doc entirely.
      const perDocBudget = Math.max(1, Math.floor(pinnedBudget / pinnedDocs.length))
      // Parallelize the per-doc fetches (separately try/catch'd so one corrupt
      // chunks row degrades that doc only, not the whole turn).
      const perDocResults = await Promise.all(
        pinnedDocs.map(async (doc) => {
          try {
            const chunks = await docsRepo.listChunksForDocument(doc.id)
            if (chunks.length === 0) return []
            // Top-of-document chunks are the natural "summary" stand-in for a
            // small model — coherent and ordered, beats a random sample.
            return packHitsToBudget(chunksToPinnedHits(chunks, doc), perDocBudget, language)
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              `[qa] failed to load pinned doc ${doc.id}:`,
              err instanceof Error ? err.message : err,
            )
            return []
          }
        }),
      )
      for (const list of perDocResults) pinnedHits.push(...list)
    }
    const packedRagHits = packHitsToBudget(hits, ragBudget, language)
    // Pinned first: they lead the prompt (buildPrompt renders them as the
    // opening section), which both gives them early-context weight on small
    // models AND keeps the [system][pinned] token prefix stable across turns
    // so the worker's sequence alignment reuses its KV state instead of
    // re-prefilling pinned content every question. fedHits is the combined
    // view for citations + the post-pack refusal check; the provider receives
    // the two lists separately via ask(query, packedRagHits, { pinnedHits }).
    const fedHits = [...pinnedHits, ...packedRagHits]
    // Final preamble wording: hasExcerpts when ANY citable block (pinned or
    // RAG) made it into the prompt — only the truly block-free prompt gets
    // the "answer uncited" variant.
    const summaryPreamble = summaryInfo
      ? buildSummaryPreamble(language, summaryInfo.title, summaryInfo.summary, fedHits.length > 0)
      : null

    // ---- 2.7 post-pack refusal ----
    // If NOTHING made it through — no RAG hits AND no pinned doc had usable
    // chunks (status pending/failed/empty) — refuse explicitly. Without this
    // the prompt would carry "Context: (none)" and we'd be relying on the
    // model's system-prompt instruction to refuse, which small local models
    // don't reliably honour. The summary route is exempt: its preamble IS the
    // context , the prompt is never empty.
    if (summaryPreamble == null && fedHits.length === 0) {
      const message = REFUSAL_TEXT[language]
      const suggestions = uniqueByDoc(hits, 3).map((h) => ({
        doc_id: h.document_id,
        title: h.document_title,
        score: h.score,
      }))
      yield { type: 'refusal', reason: 'no_hits', message, suggestions }
      yield { type: 'done', full_text: message, citations: [] }
      return
    }

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
      if (pinnedHits.length > 0) askOpts.pinnedHits = pinnedHits
      if (summaryPreamble) askOpts.contextPreamble = summaryPreamble
      if (opts.history) askOpts.conversationHistory = opts.history
      // Forward the server-side cancel signal so chat:cancel tears down the
      // worker generation (the longest LLM call) — not just the contextualize
      // step. LlamaService.askWithModel wires this to llmAbort(streamId).
      if (abortSignal) askOpts.abortSignal = abortSignal
      // Bind the provider to this turn's language before streaming. Awaited so
      // the bundled worker's system prompt is in place before llmAsk (it holds
      // the prompt as session state). No-op when the language is unchanged.
      await this.registry.llm().setLanguage(language)
      const askPromise = this.registry.llm().ask(query, packedRagHits, askOpts)
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

// Of the available context budget, this fraction is reserved for pinned-doc
// chunks (force-into-context). RAG hits compete for the remainder. 40% gives
// a single pinned doc enough room on a tight 8K window without crowding out
// retrieved hits, and shrinks per-doc if the user pins many.
const PINNED_BUDGET_FRAC = 0.4

// Absolute ceiling on the pinned share. Prefill cost scales linearly with
// prompt tokens and nothing is KV-reused across turns (history precedes the
// Context block, so the prefix changes every turn) — every pinned token is
// re-prefilled on every question. On the real profile windows a pure fraction
// explodes: 40% of a 32K budget is ~9.5K tokens, of 131K it's ~39K — tens of
// seconds of prefill per turn. 4K tokens (~14K chars, roughly the first 7–10
// pages) keeps pinning useful while bounding the per-turn cost; tight 8K
// windows stay under the cap and are unaffected.
export const PINNED_BUDGET_MAX_TOKENS = 4096

/** Token budget reserved for pinned-doc chunks. Pure helper, exported for
 *  tests; QAService.answer is the only production caller. */
export function pinnedBudgetTokens(totalBudget: number, pinnedCount: number): number {
  if (pinnedCount === 0 || totalBudget <= 0) return 0
  return Math.min(Math.floor(totalBudget * PINNED_BUDGET_FRAC), PINNED_BUDGET_MAX_TOKENS)
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

/** Convert a pinned document's chunks (snake_case ChunkRow) into the camel-ish
 *  RetrievalHit shape buildPrompt expects. Score is a synthetic 1.0 — pinned
 *  chunks aren't ranked; the packer treats them in ordinal order. */
function chunksToPinnedHits(
  chunks: ChunkRow[],
  doc: Pick<Document, 'id' | 'title'>,
): RetrievalHit[] {
  return chunks.map((c) => ({
    chunk_id: c.id,
    document_id: c.document_id,
    document_title: doc.title,
    ordinal: c.ordinal,
    page_from: c.page_from,
    page_to: c.page_to,
    heading_path: c.heading_path,
    text: c.text,
    score: 1,
    origin: 'whole_doc',
    language: c.language,
  }))
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

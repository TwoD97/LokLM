import type { ChunkRow } from '../../db/types'
import type { WorkspaceDbFacade } from '../storage/WorkspaceDbFacade'
import type { RetrievalService } from '../retrieval/RetrievalService'
import type { ProviderRegistry } from '../providers/Registry'
import type { AskOptions } from '../llm/LlamaService'
import type { WsDocument as Document } from '../../db/sqlite/WorkspaceDb'
import type { SummarizationService } from '../summarize/SummarizationService'
import type { RetrievalHit, StreamEvent, AnswerOptions, StageName } from '../../../shared/documents'
import { DEFAULT_CONTEXT_TOKENS, REFUSAL_TEXT } from '../llm/prompt'
import { planAnswerContext } from './contextBudget'
export { pinnedBudgetTokens, PINNED_BUDGET_MAX_TOKENS } from './contextBudget'
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
import {
  planEvidenceAssessment,
  parseEvidenceAssessment,
  renderUnresolvedEvidence,
} from './evidenceAssessment'

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
    private readonly db: WorkspaceDbFacade,
    private readonly retrieval: RetrievalService,
    private readonly registry: ProviderRegistry,
    private readonly summarization: SummarizationService,
    /** True when the workspace is a 'codebase' (and the tier allows it) — same
     *  resolver RetrievalService gets. Drives the code-aware topK floor and the
     *  CODE system-prompt section. Optional: tests omit it → document mode. */
    private readonly isCodebaseWorkspace?: (workspaceId: number) => Promise<boolean>,
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
    if (abortSignal?.aborted) return
    // Pinned docs are workspace-scoped "force into context" — fetched up-front
    // so the refusal path can skip "no hits" when pinned content alone could
    // answer the question, and so the packer can reserve budget for them.
    // Document/chunk ids are local to each workspace. Keep every later read
    // pinned to this turn even if the user switches libraries during retrieval.
    const docsRepo = await this.db.documentsFor(workspaceId)
    if (abortSignal?.aborted) return
    const pinnedDocs = await docsRepo.listPinned(workspaceId)
    if (abortSignal?.aborted) return
    // Codebase workspaces (ADR-0006): floor topK at the broad tier (the k=3
    // sweep was prose-calibrated; a class spans several disjoint code chunks)
    // and flip the LLM's system prompt into code mode below.
    const codebaseWorkspace = this.isCodebaseWorkspace
      ? await this.isCodebaseWorkspace(workspaceId).catch(() => false)
      : false
    const topK = opts.topK ?? adaptiveTopK(query, codebaseWorkspace)
    const threshold = opts.refusalThreshold ?? DEFAULT_REFUSAL_THRESHOLD
    // Answer language: forced when the caller set opts.language ('de'/'en'),
    // otherwise auto — detect it from the query (Auto mode). detectResponseLanguage
    // runs eld on every prompt (its isReliable() gates trust), so short German
    // prompts like "Fasse Kapitel 3 zusammen" classify correctly instead of
    // defaulting to English. opts.fallbackLanguage (the user's UI language) is
    // used only for the genuinely ambiguous tail eld can't score.
    const language = opts.language ?? (await detectResponseLanguage(query, opts.fallbackLanguage))
    if (abortSignal?.aborted) return

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
        getDocuments: () => docsRepo.listDocumentTitles(workspaceId),
        // Exactly one workspace-pinned doc = the implied subject of "fasse
        // das zusammen" — but only as last resort behind title matching.
        pinnedFallbackDocumentId: pinnedDocs.length === 1 ? pinnedDocs[0]!.id : null,
      })
      if (abortSignal?.aborted) return

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
              // A freshly indexed library normally has no lazy summaries yet.
              // Avoid parking chat/loading the embedder for a vector that no
              // ready document in this source scope could consume.
              const hasVectors = await docsRepo.hasSummaryEmbeddings(opts.activeDocumentIds ?? null)
              if (abortSignal?.aborted) return
              if (hasVectors) {
                const texts = [route.themeTokens.join(' ')]
                const vecs = embedder.embedQuery
                  ? await embedder.embedQuery(texts, { codebase: false })
                  : await embedder.embed(texts)
                const v = vecs[0]
                if (v && v.length > 0) themeEmbedding = Array.from(v)
              }
            } catch {
              /* fall back to literal matching */
            }
          }
        }
        if (abortSignal?.aborted) return
        let corpusDocs: CorpusDoc[]
        try {
          corpusDocs = await docsRepo.searchDocumentsByTheme(workspaceId, route.themeTokens, {
            activeDocumentIds: opts.activeDocumentIds ?? null,
            themeEmbedding,
          })
        } catch (err) {
          if (abortSignal?.aborted) return
          yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
          return
        }
        if (abortSignal?.aborted) return
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
        const target = await docsRepo.getDocument(route.documentId)
        if (abortSignal?.aborted) return
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
            const res = await this.summarization.summarize(route.documentId, {
              workspaceId,
              ...(abortSignal ? { abortSignal } : {}),
            })
            if (abortSignal?.aborted) return
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
      // Lite / iGPU: the LLM rewrite is a SECOND full prefill+generation per
      // follow-up turn — minutes on a weak iGPU. Instead, gate enrichment on a
      // cheap BM25 signal (contextualizeBySignal): if the bare query anchors in
      // the corpus on its own, keep it; if not, prepend the recent questions.
      // Corpus-keyed, not phrasing-keyed — no regex zoo, and the reranker +
      // relevance floor clean any over-enrichment (see contextualize-signal.test).
      let contextDetail = 'unchanged'
      if (opts.contextualizeHeuristicOnly) {
        const sig = await contextualizeBySignal(opts.history, query, (q) =>
          this.retrieval.probeBm25Top(workspaceId, q),
        )
        retrievalQuery = sig.query
        contextDetail = sig.enriched
          ? `enriched (bm25 bare=${sig.bareScore.toFixed(2)} enr=${sig.enrichedScore.toFixed(2)})`
          : `standalone (bm25 bare=${sig.bareScore.toFixed(2)} enr=${sig.enrichedScore.toFixed(2)})`
      } else {
        retrievalQuery = await contextualizeQuery(
          this.registry.llm(),
          opts.history,
          query,
          abortSignal ? { abortSignal } : {},
        )
        contextDetail = retrievalQuery === query ? 'unchanged' : 'rewritten'
      }
      if (abortSignal?.aborted) return
      emitStage('contextualize', 'done', contextDetail)
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
      if (abortSignal) searchOpts.abortSignal = abortSignal
      if (opts.rerank !== undefined) searchOpts.rerank = opts.rerank
      if (opts.multiQuery !== undefined) searchOpts.multiQuery = opts.multiQuery
      if (opts.cpuOptimized !== undefined) searchOpts.cpuOptimized = opts.cpuOptimized
      if (opts.relevanceFloor !== undefined) searchOpts.relevanceFloor = opts.relevanceFloor
      if (opts.wholeDocFallback !== undefined) searchOpts.wholeDocFallback = opts.wholeDocFallback
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
            if (abortSignal?.aborted) return
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
      if (abortSignal?.aborted) return
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

    // Pack before publishing citations, so every displayed source is actually
    // supplied to generation. One planner owns all context allocations.
    const pinnedGroups = await Promise.all(
      pinnedDocs.map(async (doc) => {
        try {
          return chunksToPinnedHits(await docsRepo.listChunksForDocument(doc.id), doc)
        } catch (err) {
          console.warn('[qa] failed to load pinned doc ' + doc.id + ':', err)
          return []
        }
      }),
    )
    if (abortSignal?.aborted) return
    // Retrieval may have parked chat and freed its context. Load the answering
    // provider only once evidence is ready, then budget against the context it
    // actually obtained under current memory pressure, not its previous load.
    const answeringLlm = this.registry.llm()
    let contextTokens = answeringLlm.contextWindowTokens()
    const hasEvidence =
      hits.length > 0 || pinnedGroups.some((group) => group.length > 0) || summaryInfo != null
    if (hasEvidence && answeringLlm.prepareContext) {
      try {
        contextTokens = await answeringLlm.prepareContext(abortSignal ? { abortSignal } : {})
      } catch (error) {
        if (abortSignal?.aborted) return
        yield { type: 'error', message: error instanceof Error ? error.message : String(error) }
        return
      }
      if (abortSignal?.aborted) return
    }
    const contextPlan = planAnswerContext({
      contextTokens,
      question: query,
      language,
      codebase: codebaseWorkspace,
      ...(opts.history ? { history: opts.history } : {}),
      hits,
      pinnedGroups,
      summary: summaryInfo,
    })
    if (!contextPlan.fits) {
      yield {
        type: 'error',
        message:
          language === 'de'
            ? 'Die Frage passt nicht in das Kontextfenster des Modells. Bitte kürze sie oder teile sie in mehrere Fragen auf.'
            : 'The question does not fit the model context. Please shorten it or split it into several questions.',
      }
      return
    }
    const { pinnedHits, hits: packedRagHits, contextPreamble: summaryPreamble } = contextPlan
    const fedHits = [...pinnedHits, ...packedRagHits]

    // ---- 2.7 post-pack refusal ----
    // If NOTHING made it through — no RAG hits AND no pinned doc had usable
    // chunks (status pending/failed/empty) — refuse explicitly. Without this
    // the prompt would carry "Context: (none)" and we'd be relying on the
    // model's system-prompt instruction to refuse, which small local models
    // don't reliably honour. The summary route is exempt: its preamble IS the
    // context , the prompt is never empty.
    if (summaryPreamble == null && fedHits.length === 0) {
      const sourcesFound =
        hits.length > 0 || pinnedGroups.some((group) => group.length > 0) || summaryInfo != null
      const message = sourcesFound
        ? language === 'de'
          ? 'Quellen wurden gefunden, aber ihre Textabschnitte passen nicht in das Kontextfenster dieses Modells. Verwende ein größeres Kontextfenster oder indexiere die Dokumente mit kleineren Abschnitten erneut.'
          : 'Sources were found, but their excerpts do not fit this model’s context window. Use a larger context window or reindex the documents with smaller sections.'
        : REFUSAL_TEXT[language]
      const suggestions = uniqueByDoc(hits, 3).map((h) => ({
        doc_id: h.document_id,
        title: h.document_title,
        score: h.score,
      }))
      yield {
        type: 'refusal',
        reason: sourcesFound ? 'context_limit' : 'no_hits',
        message,
        suggestions,
      }
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

    // Counts cover the selected prompt, including headers and history.
    // No document text is written to diagnostics.
    console.log('[qa] context:', {
      window: contextPlan.contextTokens,
      promptEstimate: contextPlan.promptTokens,
      outputLimit: contextPlan.maxTokens,
      fedHits: fedHits.length,
      pinned: pinnedHits.length,
      rag: packedRagHits.length,
      historyTurns: contextPlan.history.length,
      summaryOmitted: contextPlan.summaryOmitted,
    })

    // Experimental, bounded comparison of the exact original passages that
    // survived packing. A copied quote proves presence, not truth or authority.
    // Only an unresolved comparison bypasses generation: a later generation
    // must not silently choose one of the alternatives the assessment found.
    // Summary/history evidence needs a separate coverage design, so this first
    // experiment applies only to standalone questions over original excerpts.
    if (process.env['LOKLM_EVIDENCE_ASSESSMENT'] === '1') {
      const assessmentPlan =
        summaryPreamble == null && contextPlan.history.length === 0
          ? planEvidenceAssessment(query, fedHits, contextPlan.contextTokens)
          : null
      console.log('[qa] evidence coverage:', {
        planned: assessmentPlan != null,
        passages: fedHits.length,
        documents: new Set(fedHits.map((hit) => hit.document_id)).size,
      })
      if (assessmentPlan) {
        emitStage('evidence', 'start')
        while (stageBuffer.length > 0) yield stageBuffer.shift()!
        try {
          const raw = await answeringLlm.generateRaw(assessmentPlan.prompt, {
            systemPrompt: assessmentPlan.systemPrompt,
            jsonSchema: assessmentPlan.jsonSchema,
            maxTokens: assessmentPlan.maxTokens,
            plannedContextTokens: contextPlan.contextTokens,
            noThink: true,
            temperature: 0,
            requireComplete: true,
            ...(abortSignal ? { abortSignal } : {}),
          })
          if (abortSignal?.aborted) return
          const assessment = parseEvidenceAssessment(raw, fedHits)
          if (!assessment) throw new Error('Incomplete source comparison')
          console.log('[qa] evidence assessment:', { relation: assessment.relation })
          emitStage('evidence', 'done')
          while (stageBuffer.length > 0) yield stageBuffer.shift()!
          if (abortSignal?.aborted) return
          if (assessment.relation === 'unresolved') {
            const comparison = renderUnresolvedEvidence(assessment, language)
            if (!comparison) throw new Error('Missing source comparison')
            yield { type: 'token', text: comparison, count: 0 }
            if (abortSignal?.aborted) return
            yield { type: 'done', full_text: comparison, citations }
            return
          }
        } catch {
          if (abortSignal?.aborted) return
          // Do not print model output / private source text from parse errors.
          // A failed comparison must not quietly become a confident answer.
          yield {
            type: 'error',
            message:
              language === 'de'
                ? 'Der Quellenvergleich konnte nicht abgeschlossen werden. Bitte versuche es erneut oder grenze die Quellenauswahl ein.'
                : 'The source comparison could not be completed. Please retry or narrow the source selection.',
          }
          return
        }
      }
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
    // The iterator owns the producer: a consumer can close it without firing
    // chat:cancel (for example after its output channel disconnects).
    const generationController = new AbortController()
    const generationSignal = abortSignal
      ? AbortSignal.any([abortSignal, generationController.signal])
      : generationController.signal
    let acceptingChunks = true
    let generationFinished = false
    const queue: Array<{ text: string; count: number }> = []
    const collector = (text: string, count: number): void => {
      if (!acceptingChunks || generationSignal.aborted) return
      queue.push({ text, count })
    }

    let collectedFull = ''
    let prefillClosed = false
    try {
      const askOpts: AskOptions = {
        onChunk: collector,
        maxTokens: contextPlan.maxTokens,
        plannedContextTokens: contextPlan.contextTokens,
      }
      if (pinnedHits.length > 0) askOpts.pinnedHits = pinnedHits
      if (summaryPreamble) askOpts.contextPreamble = summaryPreamble
      if (contextPlan.history.length) askOpts.conversationHistory = contextPlan.history
      // Forward the server-side cancel signal so chat:cancel tears down the
      // worker generation (the longest LLM call) — not just the contextualize
      // step. LlamaService.askWithModel wires this to llmAbort(streamId).
      askOpts.abortSignal = generationSignal
      // Bind the provider to this turn's language before streaming. Awaited so
      // the bundled worker's system prompt is in place before llmAsk (it holds
      // the prompt as session state). No-op when the language is unchanged.
      await answeringLlm.setLanguage(language)
      // Same contract for the codebase prompt mode (CODE section) — no-op when
      // unchanged, unknown providers stay in document mode.
      await answeringLlm.setCodebaseMode?.(codebaseWorkspace)
      if (generationSignal.aborted) return
      // Observe failure before the first yield. A provider may emit a chunk
      // synchronously and reject while the consumer is paused or already gone.
      const askPromise = Promise.resolve()
        .then(() => {
          generationSignal.throwIfAborted()
          return answeringLlm.ask(query, packedRagHits, askOpts)
        })
        .then(
          (value) => {
            generationFinished = true
            return { ok: true as const, value }
          },
          (error: unknown) => {
            generationFinished = true
            return { ok: false as const, error }
          },
        )
      // drain the queue while ask is still running
      while (true) {
        if (generationSignal.aborted) return
        if (queue.length > 0) {
          if (!prefillClosed) {
            emitStage('prefill', 'done')
            prefillClosed = true
            while (stageBuffer.length > 0) {
              if (generationSignal.aborted) return
              yield stageBuffer.shift()!
            }
          }
          while (queue.length > 0) {
            if (generationSignal.aborted) return
            const next = queue.shift()!
            yield { type: 'token', text: next.text, count: next.count }
          }
        }
        const settled = await Promise.race([askPromise, sleep(15)])
        if (settled !== SLEEP_SENTINEL) {
          if (!settled.ok) throw settled.error
          collectedFull = settled.value
          break
        }
      }
      // flush any final buffered chunks the ask() resolution raced past
      if (!prefillClosed && queue.length > 0) {
        emitStage('prefill', 'done')
        prefillClosed = true
        while (stageBuffer.length > 0) {
          if (generationSignal.aborted) return
          yield stageBuffer.shift()!
        }
      }
      while (queue.length > 0) {
        if (generationSignal.aborted) return
        const next = queue.shift()!
        yield { type: 'token', text: next.text, count: next.count }
      }
    } catch (err) {
      // A provider can accept a final chunk and reject before the next queue
      // drain. Preserve that partial answer as a failed turn, while cancellation
      // (including vault locking) must never publish the queued private tail.
      if (abortSignal?.aborted) return
      if (!prefillClosed && queue.length > 0) {
        emitStage('prefill', 'done')
        prefillClosed = true
        while (stageBuffer.length > 0) {
          if (abortSignal?.aborted) return
          yield stageBuffer.shift()!
        }
      }
      while (queue.length > 0) {
        if (abortSignal?.aborted) return
        const next = queue.shift()!
        yield { type: 'token', text: next.text, count: next.count }
      }
      if (abortSignal?.aborted) return
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
      return
    } finally {
      acceptingChunks = false
      queue.length = 0
      if (!generationFinished) generationController.abort()
    }

    if (generationSignal.aborted) return
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
// Signal-gated contextualizer (contextualizeBySignal). How many recent USER
// questions to fold into the enriched probe — 2 covers a two-way comparison
// ("difference between the last two things"). The ratio is how much better the
// enriched query must retrieve than the bare one to count as "the context added
// an anchor the query lacked" — tuned on tests/unit/contextualize-signal.test.ts
// so a standalone topic-switch with its own anchor stays bare while a relational
// follow-up enriches.
const CONTEXT_ENRICH_TURNS = 2
// 2.0 tuned on the battery: genuine follow-ups score ≥2.45× (bare comparison ∞,
// "Vorteile?"/meta ∞, named comparison 2.45), while a standalone topic-switch
// whose prior subjects happen to co-occur in one doc tops out at ~1.7× — so 2.0
// keeps it bare. Erring slightly low is safe anyway: the reranker + relevance
// floor drop a wrongly-prepended subject, so a false enrich costs nothing.
const CONTEXT_SIGNAL_RATIO = 2.0

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

// Pure meta-continuation follow-ups ("genauer?", "mehr", "warum?", "more",
// "elaborate") carry no topic of their own — re-embedding them retrieves noise
// (e.g. "genauer" → "Genauigkeit" → unrelated accuracy docs). Detected so the
// retrieval query can be anchored on the prior question instead, deterministically.
const META_FOLLOWUP_PATTERNS: RegExp[] = [
  /^(genauer|ausf[üu]hrlicher|detaillierter|pr[äa]ziser|mehr|weiter|warum|wieso|weshalb|und|erkl[äa]r\w*|zusammenfass\w*|fasse|k[üu]rzer|einfacher|nochmal|beispiel\w*)\b/i,
  /^(more|elaborate|continue|go ?on|expand|why|details?|in more detail|tell me more|again|summar(y|ise|ize)|recap|simpler|shorter|examples?)\b/i,
]
function isPureMetaFollowup(query: string): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 3) return false
  return META_FOLLOWUP_PATTERNS.some((re) => re.test(query.trim()))
}

// Anaphora / continuation markers (DE/EN). A SHORT follow-up that opens with a
// conjunction, leans on a bare pronoun ("und bei JavaScript?", "was ist damit
// gemeint?", "why is that"), elides its subject via a German reflexive ("wie
// unterscheidet SICH vom Compiler?"), or names only the NEW operand of a
// comparison ("Unterschied zum Compiler?", "vs the compiler") almost always
// refers to the prior turn's topic — prepend the previous question so retrieval
// still has the subject. The ≤8-word gate at the call site keeps a fully
// self-contained comparison ("was ist der Unterschied zwischen X und Y?") out of
// this path, so broadening the vocabulary here can't hijack a standalone query.
const FOLLOWUP_ANAPHORA: RegExp[] = [
  // Leading conjunction — the follow-up grammatically continues the prior turn.
  /^(und|aber|oder|auch|sowie|and|but|or|also|plus)\b/i,
  // "what / how about X" — the canonical English topic-shift-on-same-thread form.
  /^(what|how)\s+about\b/i,
  // Explicit anaphora — a pronoun / demonstrative pointing back at the prior topic.
  // Includes the bare personal pronouns (er/sie/es/ihn/ihm/ihnen) a follow-up
  // uses in place of restating the subject ("wie schnell ist er?").
  /\b(das|es|dies|diese[rs]?|dazu|daf[üu]r|dabei|davon|daran|dar[üu]ber|hierzu|deren|dessen|damit|er|sie|ihn|ihm|ihnen)\b/i,
  /\b(it|its|that|this|these|those|them|their|theirs|one|ones)\b/i,
  // German reflexive — "(wie) unterscheidet SICH vom X" elides the subject (the
  // prior topic); the reflexive pronoun IS the back-reference.
  /\bsich\b/i,
  // Comparison / relation vocabulary (DE/EN). A short "how does it differ from /
  // compare to / relate to X" names only the new operand and drops the prior one.
  /\b(untersch(eid|ied)\w*|vergleich\w*|verglichen|gegen[üu]ber|gegenteil|verh[äa]ltnis|zusammenhang|beziehung|stattdessen)\b/i,
  /\b(difference|differs?|different|compared?|comparison|versus|vs|relationship|relation|opposite|contrast|than)\b/i,
]

// A BARE comparison follow-up ("Was ist der Unterschied?", "wie unterscheiden
// sie sich?", "how do they differ?") names NO operand — it asks about the
// difference between the prior TWO subjects, so prepending only the most recent
// one feeds retrieval half the comparison (the reported "Interpreter vs Compiler →
// only Compiler" bug). COMPARISON_VOCAB flags the comparison intent;
// NAMED_COMPARISON_OPERAND flags that the follow-up already supplies one operand
// ("Unterschied zum Assembler?", "vom Compiler") — in which case the single prior
// subject is the OTHER operand and one prepend is correct.
const COMPARISON_VOCAB =
  /\b(untersch(eid|ied)\w*|vergleich\w*|verglichen|gegen[üu]ber|gegenteil|difference|differs?|different|compared?|comparison|contrast)\b/i
const NAMED_COMPARISON_OPERAND =
  /\b(zum|zur|zwischen|vom|von|gegen[üu]ber|als|to|from|with|than|between|vs\.?|versus)\b\s+\S/i

// A short follow-up that is itself a self-contained definitional question carries
// its OWN subject and must NOT be treated as a back-reference: "was ist Rust?"
// after "was ist ein Interpreter?" is a topic switch, not a follow-up about the
// interpreter. Used to exempt such questions from the bare-fragment rule below.
const STANDALONE_DEFINITIONAL =
  /^(was (ist|sind|war|waren)|wer (ist|sind|war)|what(?:'s| is| are| was| were)|who(?:'s| is| are)|define|definiere)\b/i

/**
 * NOTE (0.6.3): superseded in the production lite path by
 * {@link contextualizeBySignal} (a corpus-keyed BM25 gate, ADR-0008) — this
 * phrasing-keyed regex classifier is retained, exported, and unit-tested as the
 * reference / fallback, but is no longer wired into {@link QAService.answer}.
 *
 * Pure, LLM-free contextualizer for follow-up turns. The lite / iGPU path used
 * this in place of {@link contextualizeQuery} so a follow-up costs ZERO extra
 * generation. Rules, cheapest-first:
 *   1. Pure meta ("genauer?", "mehr", "more") → the prior USER question verbatim
 *      (the follow-up carries no topic of its own).
 *   2. Short anaphoric / comparison ("und bei X?", "warum das?", "wie
 *      unterscheidet sich vom Compiler?") → prior question + the follow-up, so
 *      retrieval sees both the subject and the new angle. A BARE comparison that
 *      names no operand ("Was ist der Unterschied?") references the prior TWO
 *      subjects, so both prior questions are prepended.
 *   3. Bare fragment ("Vorteile?", "Geschwindigkeit?", "wie schnell?") → prior
 *      question + the fragment, unless the fragment is a self-contained
 *      definitional question ("was ist Rust?").
 *   4. Otherwise → standalone; return the query unchanged.
 * The bias is deliberately toward contextualizing SHORT follow-ups: a wrongly
 * prepended subject is cheap (the reranker + relevance floor drop the off-topic
 * chunks), whereas a missed back-reference feeds the model pure noise. Long,
 * self-contained questions (>8 words, or a definitional opener) are left alone.
 * Only USER turns are consulted (assistant answers can be wrong/drifted — same
 * rule the LLM rewriter follows). Exported for unit tests.
 */
export function heuristicContextualizeQuery(
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
  query: string,
): string {
  if (history.length === 0) return query
  const userTurns = history.filter((m) => m.role === 'user')
  const lastUser = userTurns.length > 0 ? userTurns[userTurns.length - 1]!.content.trim() : null
  if (!lastUser) return query
  const trimmed = query.trim()
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 0) return query
  // Rule 1 — bare meta ("genauer?", "mehr", "warum?") → anchor on the prior
  // question. The ≤2-word gate is stricter than isPureMetaFollowup's ≤3 on
  // purpose: a 3-word "und bei JavaScript?" opens with a meta trigger ("und") but
  // carries a NEW topic, so it must fall through to the concat rules below —
  // anchoring would drop "JavaScript" and re-retrieve the old question.
  if (words.length <= 2 && isPureMetaFollowup(trimmed)) return lastUser
  // Rule 2 — short anaphoric / continuation / comparison follow-up with new
  // content → prepend the prior question so retrieval sees both the subject and
  // the new angle. ≤8 words keeps a fully self-contained comparison out.
  if (words.length <= 8 && FOLLOWUP_ANAPHORA.some((re) => re.test(trimmed))) {
    // A BARE comparison ("Was ist der Unterschied?") refers to the prior TWO
    // subjects — prepend both so retrieval sees both operands, not just the last.
    if (
      userTurns.length >= 2 &&
      COMPARISON_VOCAB.test(trimmed) &&
      !NAMED_COMPARISON_OPERAND.test(trimmed)
    ) {
      const prev = userTurns[userTurns.length - 2]!.content.trim()
      return prev === lastUser ? `${lastUser} ${trimmed}` : `${prev} ${lastUser} ${trimmed}`
    }
    return `${lastUser} ${trimmed}`
  }
  // Rule 3 — a bare fragment (≤3 words) names an attribute of the prior topic
  // without restating it ("Vorteile?", "wie schnell?"). Prepend the prior
  // question unless the fragment is itself a self-contained definitional question
  // ("was ist Rust?"), which is a genuine topic switch.
  if (words.length <= 3 && !STANDALONE_DEFINITIONAL.test(trimmed)) {
    return `${lastUser} ${trimmed}`
  }
  // Rule 4 — standalone.
  return query
}

/** Decision returned by {@link contextualizeBySignal}, exposed so the caller can
 *  log it (the `contextualize` stage detail) and tests can assert it. */
export interface SignalContextualization {
  /** The query to actually retrieve with (bare or enriched). */
  query: string
  /** True when prior turns were prepended. */
  enriched: boolean
  bareScore: number
  enrichedScore: number
}

/**
 * Signal-gated contextualizer (lite / no-LLM path, candidate replacement for the
 * regex {@link heuristicContextualizeQuery}). Instead of classifying the query's
 * PHRASING (the brittle "is it a comparison? anaphoric? bare fragment?" rules),
 * it asks the CORPUS: does the bare query retrieve anything on its own?
 *
 *   bare      = the query as typed
 *   enriched  = the last `enrichTurns` USER questions + the query
 *   probe(q)  = top BM25 score for q (FTS5, CPU, ~ms — no GPU, no rerank)
 *
 * If the enriched query out-retrieves the bare one by ≥ `ratioThreshold`, the
 * prior context supplied an anchor the bare query lacked (a follow-up) → use
 * enriched. Otherwise the bare query already had its own anchor (standalone) →
 * use it. Corpus-keyed, not phrasing-keyed: "Was ist der Unterschied?" (no
 * standalone anchor) enriches; "Was ist Rekursion?" (its own anchor) does not —
 * with no per-pattern code. Over-enrichment is SAFE because the downstream
 * reranker + relevance floor (ADR-0008) drop whichever prepended subject is
 * off-topic, so the gate can lean toward enriching.
 *
 * Known limitation (measured, see contextualize-signal.test.ts): a standalone
 * question about a topic ABSENT from the corpus still enriches (bare anchors
 * nothing, the prior subjects do), yielding a tangential answer instead of a
 * clean refusal. Acceptable: that query fails either way, and it is rare in a
 * "ask about my indexed docs" flow.
 *
 * Only USER turns are consulted (assistant answers can be wrong/drifted — same
 * rule both other contextualizers follow). Pure + probe-injected → unit-testable
 * against a mock corpus without a DB.
 */
export async function contextualizeBySignal(
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
  query: string,
  probe: (q: string) => number | Promise<number>,
  opts: { enrichTurns?: number; ratioThreshold?: number } = {},
): Promise<SignalContextualization> {
  const trimmed = query.trim()
  const userTurns = history.filter((m) => m.role === 'user')
  if (userTurns.length === 0) {
    return { query: trimmed, enriched: false, bareScore: 0, enrichedScore: 0 }
  }
  // Form guard BEFORE the probe: a clean definitional opener ("Was ist ein X?",
  // "What is X?") that names no comparison is a STANDALONE topic question — never
  // enrich it. The BM25 ratio alone gets this wrong when X doesn't anchor in the
  // corpus — a different spelling ("kompiler" vs "Compiler"), a rare/new or
  // absent topic — because then the bare probe scores ~0 while the prior subject
  // inflates the enriched probe, and the gate drags the prior topic back in
  // (observed live: "Was ist ein kompiler?" after "…interpreter?" enriched). A
  // bare comparison ("Was ist der Unterschied?") is definitional in form too but
  // names a relational head (COMPARISON_VOCAB), so it falls through to the probe
  // and still enriches. This is the one form the corpus signal can't disambiguate.
  if (STANDALONE_DEFINITIONAL.test(trimmed) && !COMPARISON_VOCAB.test(trimmed)) {
    return { query: trimmed, enriched: false, bareScore: 0, enrichedScore: 0 }
  }
  const enrichTurns = opts.enrichTurns ?? CONTEXT_ENRICH_TURNS
  const ratioThreshold = opts.ratioThreshold ?? CONTEXT_SIGNAL_RATIO
  // Last N user questions, most-recent-last, de-duplicated (a repeated question
  // adds no new subject). These are the candidate operands for a comparison and
  // the topical anchor for an anaphoric follow-up.
  const subjects = userTurns
    .slice(-enrichTurns)
    .map((m) => m.content.trim())
    .filter((s, i, a) => a.indexOf(s) === i)
  const enrichedQuery = `${subjects.join(' ')} ${trimmed}`.replace(/\s+/g, ' ').trim()
  // Two cheap BM25 probes in parallel (the probe may be sync in tests).
  const [bareScore, enrichedScore] = await Promise.all([probe(trimmed), probe(enrichedQuery)])
  // Ratio, not absolute: BM25 scores are corpus-dependent, but "enrichment beats
  // bare by ≥ X" is self-calibrating. The epsilon makes a bare query that anchors
  // NOTHING (score 0) always enrich when the context anchors something.
  const enriched = enrichedScore > Math.max(bareScore, 1e-6) * ratioThreshold
  return {
    query: enriched ? enrichedQuery : trimmed,
    enriched,
    bareScore,
    enrichedScore,
  }
}

/**
 * Rewrite a follow-up question into a standalone search query using prior
 * conversation turns. Returns the original `query` unchanged if the LLM is
 * unavailable, the rewrite errors, or the rewrite comes back empty/too long.
 *
 * Two robustness rules learned the hard way:
 *   1. A pure meta follow-up ("genauer?", "more") is anchored on the most recent
 *      USER question deterministically — no LLM, no re-embedding the bare word.
 *   2. Only USER turns feed the rewrite. Assistant answers can be wrong/drifted
 *      (a bad RAG turn), and including them poisons the next rewrite — the exact
 *      "each turn makes it worse" failure. Resolving references needs the prior
 *      QUESTIONS, not the answers.
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
  if (history.length === 0) return query
  const userTurns = history.filter((m) => m.role === 'user')
  const lastUser = userTurns.length > 0 ? userTurns[userTurns.length - 1]!.content.trim() : null
  // Rule 1: deterministic anchor for a bare meta follow-up.
  if (lastUser && isPureMetaFollowup(query)) return lastUser
  if (!llama.isReady() || userTurns.length === 0) return query
  // Rule 2: user questions only — never feed assistant answers to the rewrite.
  const recent = userTurns.slice(-CONTEXTUALIZE_MAX_TURNS)
  const lines = recent.map((m) => {
    const text =
      m.content.length > CONTEXTUALIZE_PER_TURN_CHARS
        ? m.content.slice(0, CONTEXTUALIZE_PER_TURN_CHARS) + '…'
        : m.content
    return `User: ${text}`
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

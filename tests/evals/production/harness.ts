import type { ChunkRow, ChunkSearchOptions, SearchHit } from '../../../src/main/db/types'
import {
  RetrievalService,
  type RetrievalHit,
  type RetrievalOptions,
} from '../../../src/main/services/retrieval/RetrievalService'
import { QAService } from '../../../src/main/services/qa/QAService'
import { ProviderRegistry } from '../../../src/main/services/providers/Registry'
import type {
  LlmProvider,
  EmbedderProvider,
  RerankerProvider,
} from '../../../src/main/services/providers/types'
import type { WorkspaceDbFacade } from '../../../src/main/services/storage/WorkspaceDbFacade'
import type { SummarizationService } from '../../../src/main/services/summarize/SummarizationService'
import type { AskOptions } from '../../../src/main/services/llm/LlamaService'
import {
  answerMaxTokens,
  buildPrompt,
  buildSystemPrompt,
  estimateTokens,
  CONTEXT_PACK_MARGIN_TOKENS,
} from '../../../src/main/services/llm/prompt'
import type { StreamEvent, ModelStatus, RefusalReason } from '../../../src/shared/documents'
import { CASES, CORPUS, type ProductionCase } from './fixtures'

export interface ProductionResult {
  id: string
  contextTokens: number
  language: 'de' | 'en'
  category: ProductionCase['category']
  retrieved: Array<{ id: number; origin: string; chars: number }>
  fed: Array<{ id: number; chars: number }>
  citationIds: number[]
  requiredEvidenceCoverage: number | null
  promptTokens: number
  generationTokens: number
  outputLimitProvided: boolean
  historyCharsBefore: number
  historyCharsAfter: number
  framingMarginTokens: number
  estimatedTotalTokens: number
  contextFits: boolean
  sourceTextUnchanged: boolean
  citationEvidenceMatches: boolean
  refused: boolean
  refusalReason: RefusalReason | null
  refusalMessage: string | null
  expectedRefusal: boolean
  refusalMatches: boolean
  generationCalls: number
  errors: string[]
  checksPassed: boolean
  knownLimitation: string | null
}

/** Only index I/O and inference are fixtures; fusion, expansion, packing and streaming use production classes. */
export async function runProductionCase(
  testCase: ProductionCase,
  contextTokens: number,
): Promise<ProductionResult> {
  const byId = new Map(CORPUS.map((hit) => [hit.chunk_id, hit]))
  const asChunk = (hit: SearchHit): ChunkRow => ({
    id: hit.chunk_id,
    document_id: hit.document_id,
    ordinal: hit.ordinal,
    text: hit.text,
    token_count: null,
    page_from: hit.page_from,
    page_to: hit.page_to,
    heading_path: hit.heading_path,
    language: hit.language,
  })
  const arm = (
    scores: Array<[number, number]>,
    limit: number,
    opts: ChunkSearchOptions,
  ): SearchHit[] =>
    scores
      .filter(
        ([id]) =>
          !opts.activeDocumentIds?.length ||
          opts.activeDocumentIds.includes(byId.get(id)!.document_id),
      )
      .slice(0, limit)
      .map(([id, score]) => ({ ...byId.get(id)!, score }))
  const documents = {
    listPinned: async () =>
      (testCase.pinnedDocumentIds ?? []).map((id) => ({
        id,
        title: CORPUS.find((hit) => hit.document_id === id)!.document_title,
      })),
    searchChunks: async (
      _workspaceId: number,
      _query: string,
      limit: number,
      opts: ChunkSearchOptions,
    ) => arm(testCase.lexical, limit, opts),
    searchChunksByVector: async (
      _workspaceId: number,
      _vector: number[],
      limit: number,
      opts: ChunkSearchOptions,
    ) => arm(testCase.dense, limit, opts),
    listChunksForDocument: async (id: number) =>
      CORPUS.filter((h) => h.document_id === id).map(asChunk),
    getChunkCounts: async (ids: number[]) =>
      new Map(ids.map((id) => [id, CORPUS.filter((h) => h.document_id === id).length])),
    getNeighbourChunks: async (
      seeds: Array<{ documentId: number; ordinal: number }>,
      radius: number,
    ) =>
      CORPUS.filter((h) =>
        seeds.some(
          (seed) =>
            h.document_id === seed.documentId && Math.abs(h.ordinal - seed.ordinal) <= radius,
        ),
      ).map(asChunk),
  }
  const db = { documents: () => documents } as unknown as WorkspaceDbFacade
  let fed: RetrievalHit[] = []
  let prompt = ''
  let generationTokens = 0
  let generationCalls = 0
  let outputLimitProvided = false
  let historyCharsAfter = 0
  let selectedLanguage = testCase.language
  const llm: LlmProvider = {
    ask: async (question, hits, opts: AskOptions) => {
      generationCalls++
      outputLimitProvided = typeof opts.maxTokens === 'number' && opts.maxTokens > 0
      historyCharsAfter = (opts.conversationHistory ?? []).reduce(
        (sum, message) => sum + message.content.length,
        0,
      )
      fed = [...(opts.pinnedHits ?? []), ...hits].map((hit) => ({ ...hit }))
      prompt = buildPrompt(
        question,
        hits,
        opts.conversationHistory,
        selectedLanguage,
        opts.pinnedHits,
        opts.contextPreamble,
      )
      generationTokens =
        'maxTokens' in opts && typeof opts.maxTokens === 'number'
          ? opts.maxTokens
          : answerMaxTokens(contextTokens)
      const answer = `SYNTHETIC INFERENCE: received evidence ${fed.map((h) => `[doc:${h.document_id}, chunk:${h.chunk_id}]`).join(' ')}`
      opts.onChunk?.(answer, 1)
      return answer
    },
    generateRaw: async () => {
      throw new Error('Unexpected generation outside answer stage')
    },
    generateTitle: async () => null,
    contextWindowTokens: () => contextTokens,
    isCpuInference: () => false,
    isReady: () => true,
    getStatus: () => ({ ready: true, message: null, identity: 'fixture:deterministic' }),
    getModelStatus: () => ({ state: 'ready', gpu: 'cuda' }) as ModelStatus,
    setLanguage: async (language) => {
      selectedLanguage = language
    },
  }
  const embedder: EmbedderProvider = {
    embed: async (texts) => texts.map(() => new Float32Array([1, 0])),
    embedQuery: async (texts) => texts.map(() => new Float32Array([1, 0])),
    dimension: () => 2,
    identity: () => 'fixture:embedding',
    isReady: () => true,
    ensureReady: async () => {},
  }
  const reranker: RerankerProvider = {
    isReady: () => false,
    ensureReady: async () => {},
    rerank: async () => {
      throw new Error('Reranker must remain disabled')
    },
  }
  const registry = new ProviderRegistry({
    llm: { bundled: llm, ollama: null },
    embedder: { bundled: embedder, ollama: null },
    reranker: { bundled: reranker, ollama: null },
  })
  let retrieved: RetrievalHit[] = []
  class RecordingRetrieval extends RetrievalService {
    override async search(
      workspaceId: number,
      query: string,
      topK: number,
      opts: RetrievalOptions = {},
    ): Promise<RetrievalHit[]> {
      const hits = await super.search(workspaceId, query, topK, {
        ...opts,
        titleBoostFactor: 1,
        shortChunkPenalty: 1,
        recencyBoostFactor: 1,
        languageMatchBoostFactor: 1,
        documentDiversity: false,
        decomposeQuestions: false,
        neighbourRadius: testCase.neighbourRadius ?? 0,
      })
      retrieved = hits.map((hit) => ({ ...hit }))
      return hits
    }
  }
  const retrieval = new RecordingRetrieval(db, registry)
  const summaries = {
    summarize: async () => {
      throw new Error('Unexpected summary route')
    },
  } as unknown as SummarizationService
  const qa = new QAService(db, retrieval, registry, summaries)
  const events: StreamEvent[] = []
  for await (const event of qa.answer(1, testCase.question, {
    topK: 5,
    language: testCase.language,
    rerank: false,
    multiQuery: false,
    contextualize: false,
    routing: false,
    wholeDocFallback: false,
    ...(testCase.history ? { history: testCase.history } : {}),
  }))
    events.push(event)
  const citationIds = events.flatMap((event) => (event.type === 'citation' ? [event.chunk_id] : []))
  const refused = events.some((event) => event.type === 'refusal')
  const refusal = events.find((event) => event.type === 'refusal')
  const errors = events.flatMap((event) => (event.type === 'error' ? [event.message] : []))
  const requiredEvidenceCoverage = testCase.required.length
    ? testCase.required.filter((gold) =>
        fed.some((hit) => hit.chunk_id === gold.chunkId && hit.text.includes(gold.text)),
      ).length / testCase.required.length
    : null
  const promptTokens = generationCalls
    ? estimateTokens(buildSystemPrompt(selectedLanguage, 'thorough')) + estimateTokens(prompt)
    : 0
  const framingMarginTokens = generationCalls ? CONTEXT_PACK_MARGIN_TOKENS : 0
  const estimatedTotalTokens = promptTokens + generationTokens + framingMarginTokens
  const contextFits = estimatedTotalTokens <= contextTokens
  const sourceTextUnchanged = fed.every((hit) => byId.get(hit.chunk_id)?.text === hit.text)
  const citationEvidenceMatches =
    JSON.stringify(citationIds) === JSON.stringify(fed.map((hit) => hit.chunk_id)) &&
    events.some(
      (event) =>
        event.type === 'done' &&
        JSON.stringify(event.citations.map((citation) => citation.chunk_id)) ===
          JSON.stringify(citationIds),
    )
  const refusalMatches = refused === testCase.shouldRefuse && (!refused || generationCalls === 0)
  return {
    id: testCase.id,
    contextTokens,
    language: testCase.language,
    category: testCase.category,
    retrieved: retrieved.map((hit) => ({
      id: hit.chunk_id,
      origin: hit.origin ?? 'primary',
      chars: hit.text.length,
    })),
    fed: fed.map((hit) => ({ id: hit.chunk_id, chars: hit.text.length })),
    citationIds,
    requiredEvidenceCoverage,
    promptTokens,
    generationTokens,
    outputLimitProvided,
    historyCharsBefore: (testCase.history ?? []).reduce(
      (sum, message) => sum + message.content.length,
      0,
    ),
    historyCharsAfter,
    framingMarginTokens,
    estimatedTotalTokens,
    contextFits,
    sourceTextUnchanged,
    citationEvidenceMatches,
    refused,
    refusalReason: refusal?.reason ?? null,
    refusalMessage: refusal?.message ?? null,
    expectedRefusal: testCase.shouldRefuse,
    refusalMatches,
    generationCalls,
    errors,
    checksPassed:
      contextFits &&
      (!generationCalls || outputLimitProvided) &&
      sourceTextUnchanged &&
      citationEvidenceMatches &&
      refusalMatches &&
      (requiredEvidenceCoverage === null || requiredEvidenceCoverage === 1) &&
      errors.length === 0,
    knownLimitation: testCase.knownLimitation ?? null,
  }
}

export async function runProductionMatrix(): Promise<ProductionResult[]> {
  const results: ProductionResult[] = []
  for (const context of [4096, 8192])
    for (const testCase of CASES) results.push(await runProductionCase(testCase, context))
  return results
}

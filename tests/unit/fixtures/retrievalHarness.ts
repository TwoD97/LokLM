import { vi, type Mock } from 'vitest'
import type { SearchHit } from '@main/db/types'
import type { ProviderRegistry } from '@main/services/providers/Registry'
import type { WorkspaceDbFacade } from '@main/services/storage/WorkspaceDbFacade'
import { RetrievalService, type VectorSearchFn } from '@main/services/retrieval/RetrievalService'
import type {
  EmbedderProvider,
  LlmProvider,
  RerankerProvider,
} from '@main/services/providers/types'

export function hit(id: number, score = 0.8, patch: Partial<SearchHit> = {}): SearchHit {
  return {
    chunk_id: id,
    document_id: id,
    document_title: `Reference ${id}`,
    ordinal: 0,
    page_from: 1,
    page_to: 1,
    heading_path: null,
    language: 'en',
    text: `Passage ${id} with supporting evidence. `.repeat(12),
    score,
    ...patch,
  }
}

export const FLAT = {
  cpuOptimized: true,
  multiQuery: false,
  rerank: false,
  wholeDocFallback: false,
  documentDiversity: false,
  neighbourRadius: 0,
  titleBoostFactor: 1,
  shortChunkPenalty: 1,
  recencyBoostFactor: 1,
  languageMatchBoostFactor: 1,
}

export function retrievalHarness(
  options: {
    codebase?: boolean
    translate?: (query: string, opts?: { abortSignal?: AbortSignal }) => Promise<string | null>
  } = {},
) {
  const lexical: Mock<ReturnType<WorkspaceDbFacade['documents']>['searchChunks']> = vi
    .fn()
    .mockResolvedValue([])
  const dense: Mock<VectorSearchFn> = vi.fn().mockResolvedValue([])
  const generate: Mock<LlmProvider['generateRaw']> = vi
    .fn()
    .mockResolvedValue('First alternative query\nSecond alternative query')
  const embed: Mock<NonNullable<EmbedderProvider['embedQuery']>> = vi
    .fn()
    .mockResolvedValue([new Float32Array([1, 0])])
  const rank: Mock<RerankerProvider['rerank']> = vi.fn().mockResolvedValue([])
  const cpu: Mock<() => boolean> = vi.fn().mockReturnValue(false)
  const rerankerReady: Mock<() => boolean> = vi.fn().mockReturnValue(false)
  const db = { documents: () => ({ searchChunks: lexical }) } as unknown as WorkspaceDbFacade
  const llm = {
    isReady: () => true,
    isCpuInference: cpu,
    generateRaw: generate,
    getModelStatus: () => ({ state: 'ready', source: 'ollama', gpu: null }),
  }
  const embedder = { isReady: () => true, identity: () => 'bundled:bge-m3', embedQuery: embed }
  const registry = {
    llm: () => llm,
    embedder: () => embedder,
    reranker: () => ({ isReady: rerankerReady, rerank: rank }),
  } as unknown as ProviderRegistry
  const service = new RetrievalService(
    db,
    registry,
    dense,
    undefined,
    async () => options.codebase ?? false,
    options.translate,
  )
  return {
    service,
    lexical,
    dense,
    generate,
    embed,
    rank,
    cpu,
    rerankerReady,
    llm,
    embedder,
    registry,
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

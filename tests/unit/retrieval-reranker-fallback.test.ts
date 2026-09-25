import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchHit } from '@main/db/types'
import type { ProviderRegistry } from '@main/services/providers/Registry'
import { RetrievalService } from '@main/services/retrieval/RetrievalService'
import type { WorkspaceDbFacade } from '@main/services/storage/WorkspaceDbFacade'

const { traces } = vi.hoisted(() => ({ traces: [] as Array<Record<string, unknown>> }))
vi.mock('@main/services/retrieval/trace', () => ({
  retrievalTrace: (build: () => Record<string, unknown>) => traces.push(build()),
}))

function hit(id: number, score: number): SearchHit {
  return {
    chunk_id: id,
    document_id: id,
    document_title: `Reference ${id}`,
    ordinal: 0,
    page_from: 1,
    page_to: 1,
    heading_path: null,
    language: 'en',
    score,
    text: `Passage ${id}. `.repeat(30),
  }
}

function retrieval(ready: boolean, rank = vi.fn().mockResolvedValue([0.9, 0.5, 0.1])) {
  const db = {
    documents: () => ({
      searchChunks: vi.fn().mockResolvedValue([hit(1, 9), hit(2, 5)]),
      searchChunksByVector: vi.fn().mockResolvedValue([hit(3, 0.1)]),
    }),
  } as unknown as WorkspaceDbFacade
  const registry = {
    llm: () => ({ isReady: () => false }),
    embedder: () => ({
      isReady: () => true,
      identity: () => 'bundled:bge-m3',
      embed: vi.fn().mockResolvedValue([new Float32Array([1, 0])]),
    }),
    reranker: () => ({ isReady: () => ready, rerank: rank }),
  } as unknown as ProviderRegistry
  return { service: new RetrievalService(db, registry), rank }
}

const options = {
  rerank: true,
  multiQuery: false,
  wholeDocFallback: false,
  documentDiversity: false,
  neighbourRadius: 0,
  relevanceFloor: 0.2,
}

afterEach(() => {
  traces.length = 0
  vi.restoreAllMocks()
})

describe('retrieval reranker fallback', () => {
  it('uses balanced fusion and removes weak dense-only hits when reranking is unavailable', async () => {
    const { service, rank } = retrieval(false)
    const stages = vi.fn()
    const actual = await service.search(1, 'needle', 5, { ...options, onStage: stages })
    const expected = await service.search(1, 'needle', 5, { ...options, rerank: false })

    expect(actual.map((item) => item.chunk_id)).toEqual([1, 2])
    expect(actual).toEqual(expected)
    expect(actual[0]!.score).toBeCloseTo(1 / 61)
    expect(rank).not.toHaveBeenCalled()
    expect(stages.mock.calls.some(([stage]) => stage === 'rerank')).toBe(false)
    expect(traces[0]).toMatchObject({ rerank: false, flooredOut: 1 })
  })

  it.each(['throws', 'missing scores', 'invalid scores'] as const)(
    'preserves the complete hybrid fallback when reranking returns %s',
    async (failure) => {
      const rank = vi.fn()
      if (failure === 'throws') rank.mockRejectedValue(new Error('GPU model unavailable'))
      else rank.mockResolvedValue(failure === 'missing scores' ? [0.9] : [0.9, NaN, 0.1])
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { service } = retrieval(true, rank)
      const stages = vi.fn()

      const actual = await service.search(1, 'needle', 5, { ...options, onStage: stages })
      const expected = await service.search(1, 'needle', 5, { ...options, rerank: false })

      expect(actual).toEqual(expected)
      expect(actual.map((item) => item.chunk_id)).toEqual([1, 2])
      expect(stages).toHaveBeenCalledWith('rerank', 'done', 'hybrid fallback')
      expect(traces[0]).toMatchObject({ rerank: false, flooredOut: 1 })
    },
  )

  it('applies the cross-encoder floor only after valid scoring', async () => {
    const rank = vi
      .fn()
      .mockImplementation(async (_query: string, passages: string[]) =>
        passages.map((text) => (text.startsWith('Passage 2.') ? 0.85 : 0.1)),
      )
    const { service } = retrieval(true, rank)
    const stages = vi.fn()
    const actual = await service.search(1, 'needle', 5, { ...options, onStage: stages })

    expect(actual.map((item) => item.chunk_id)).toEqual([2])
    expect(actual[0]!.score).toBeCloseTo(0.85)
    expect(stages).toHaveBeenCalledWith('rerank', 'done', '3 reranked')
    expect(traces[0]).toMatchObject({ rerank: true })
  })
})

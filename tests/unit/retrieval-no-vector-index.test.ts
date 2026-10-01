import { describe, expect, it, vi } from 'vitest'
import { RetrievalService } from '@main/services/retrieval/RetrievalService'
import { FLAT, hit } from './fixtures/retrievalHarness'

describe('retrieval without a vector index', () => {
  it('returns lexical evidence without computing a useless query embedding', async () => {
    const lexical = vi.fn(async () => [hit(1)])
    const embed = vi.fn(async () => [new Float32Array([1, 0])])
    const registry = {
      embedder: () => ({ identity: () => 'fixture', isReady: () => true, embed }),
      llm: () => ({ isReady: () => false }),
      reranker: () => ({ isReady: () => false }),
    }
    const service = new RetrievalService(
      { documents: () => ({ searchChunks: lexical }) } as never,
      registry as never,
    )
    expect(
      (await service.search(3, 'source evidence', 4, FLAT)).map((item) => item.chunk_id),
    ).toEqual([1])
    expect(lexical).toHaveBeenCalledOnce()
    expect(embed).not.toHaveBeenCalled()
  })
})

import { describe, it, expect } from 'vitest'
import { matrixConfigs } from '../evals/pipeline/configs'

describe('matrixConfigs', () => {
  it('builds the full cartesian product with unique config names', async () => {
    const cfgs = await matrixConfigs()
    // 6 embedders × (1 skip + 2 rerankers) × 1 chunker = 18
    // (chunker axis = 1 ; sweep doesn't re-chunk, so chunk-size comparison
    //  runs as separate per-size dataset runs, not as an in-run axis)
    expect(cfgs.length).toBe(18)
    const names = cfgs.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    for (const c of cfgs) {
      expect(c.embedder).toBeTruthy()
      expect(c.reranker).toBeTruthy()
      expect(c.chunker).toBeTruthy()
    }
    // all configs share ONE LlmBridge instance — sweep dedups warm() by llm
    // identity, so the under-test LLM loads once, not 18×.
    expect(new Set(cfgs.map((c) => c.llm)).size).toBe(1)
  })

  it('gives every embedder a unique name (embedding-cache-key safety)', async () => {
    const cfgs = await matrixConfigs()
    const embNames = new Set(cfgs.map((c) => c.embedder.name))
    expect(embNames.size).toBe(6)
  })

  it('builds 10 configs for the code matrix (5 embedders × 2 rerankers)', async () => {
    // Set env vars to point at the code packs
    const prevEmb = process.env.LOKLM_EMBEDDER_PACK
    const prevRr = process.env.LOKLM_RERANKER_PACK
    process.env.LOKLM_EMBEDDER_PACK = 'embedder-pack-code.json'
    process.env.LOKLM_RERANKER_PACK = 'reranker-pack-code.json'
    try {
      const cfgs = await matrixConfigs()
      // 5 embedders × (1 skip + 1 reranker) × 1 chunker = 10
      expect(cfgs.length).toBe(10)
      const names = cfgs.map((c) => c.name)
      expect(new Set(names).size).toBe(names.length)
      const embNames = new Set(cfgs.map((c) => c.embedder.name))
      expect(embNames.size).toBe(5)
    } finally {
      // Restore env vars
      if (prevEmb === undefined) {
        delete process.env.LOKLM_EMBEDDER_PACK
      } else {
        process.env.LOKLM_EMBEDDER_PACK = prevEmb
      }
      if (prevRr === undefined) {
        delete process.env.LOKLM_RERANKER_PACK
      } else {
        process.env.LOKLM_RERANKER_PACK = prevRr
      }
    }
  })
})

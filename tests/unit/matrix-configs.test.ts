import { describe, it, expect } from 'vitest'
import { matrixConfigs } from '../evals/pipeline/configs'

describe('matrixConfigs', () => {
  it('builds the full cartesian product with unique config names', async () => {
    const cfgs = await matrixConfigs()
    // 8 embedders × (1 skip + 2 rerankers) × 1 chunker = 24
    // (chunker axis = 1 ; sweep doesn't re-chunk, so chunk-size comparison
    //  runs as separate per-size dataset runs, not as an in-run axis)
    expect(cfgs.length).toBe(24)
    const names = cfgs.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    for (const c of cfgs) {
      expect(c.embedder).toBeTruthy()
      expect(c.reranker).toBeTruthy()
      expect(c.chunker).toBeTruthy()
    }
    // all configs share ONE LlmBridge instance — sweep dedups warm() by llm
    // identity, so the under-test LLM loads once, not 24×.
    expect(new Set(cfgs.map((c) => c.llm)).size).toBe(1)
  })

  it('gives every embedder a unique name (embedding-cache-key safety)', async () => {
    const cfgs = await matrixConfigs()
    const embNames = new Set(cfgs.map((c) => c.embedder.name))
    expect(embNames.size).toBe(8)
  })
})

import { describe, it, expect } from 'vitest'
import { matrixConfigs } from '../evals/pipeline/configs'

describe('matrixConfigs', () => {
  it('builds the full cartesian product with unique config names', async () => {
    const cfgs = await matrixConfigs()
    // 7 embedders × (1 skip + 2 rerankers) × 3 chunkers = 63
    expect(cfgs.length).toBe(63)
    const names = cfgs.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    for (const c of cfgs) {
      expect(c.embedder).toBeTruthy()
      expect(c.reranker).toBeTruthy()
      expect(c.chunker).toBeTruthy()
    }
  })

  it('gives every embedder a unique name (embedding-cache-key safety)', async () => {
    const cfgs = await matrixConfigs()
    const embNames = new Set(cfgs.map((c) => c.embedder.name))
    expect(embNames.size).toBe(7)
  })
})

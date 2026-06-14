import { describe, it, expect } from 'vitest'
import { parseShard, selectShard, buildMatrixManifest } from '../evals/answer/matrix-manifest'

describe('parseShard', () => {
  it('parses "1/4" into {index:1,total:4}', () => {
    expect(parseShard('1/4')).toEqual({ index: 1, total: 4 })
  })
  it('rejects malformed / out-of-range', () => {
    expect(() => parseShard('4/4')).toThrow()
    expect(() => parseShard('x/3')).toThrow()
    expect(() => parseShard('1')).toThrow()
    expect(() => parseShard('-1/3')).toThrow()
  })
})

describe('selectShard', () => {
  const models = ['a', 'b', 'c', 'd', 'e']
  it('returns a disjoint round-robin slice', () => {
    expect(selectShard(models, 0, 2)).toEqual(['a', 'c', 'e'])
    expect(selectShard(models, 1, 2)).toEqual(['b', 'd'])
  })
  it('union of all shards == full set, no overlap', () => {
    const n = 3
    const all = [0, 1, 2].flatMap((i) => selectShard(models, i, n))
    expect(all.sort()).toEqual([...models].sort())
  })
  it('total=1 returns everything', () => {
    expect(selectShard(models, 0, 1)).toEqual(models)
  })
})

describe('buildMatrixManifest', () => {
  const input = {
    embedders: [{ label: 'bge-m3' }, { label: 'e5-large' }],
    rerankers: [{ label: 'bge-reranker-v2-m3' }, { label: 'jina-reranker-v2' }],
    chunkers: ['fixed-256-32', 'fixed-512-64', 'fixed-1024-128'],
    models: [{ label: 'qwen3-4b' }, { label: 'gemma-4-E4B' }],
    dataset: {
      path: 'lap.json',
      numChunks: 2322,
      numQuestions: 163,
      numRefusal: 15,
      langs: { de: 163 },
    },
    secondsPerRun: 20,
  }

  it('computes retrievalConfigs, cells and runs', () => {
    const m = buildMatrixManifest(input)
    expect(m.retrievalConfigs).toBe(18) // 2 emb × (1 skip + 2 rr) × 3 chunk
    expect(m.cells).toBe(36) // × 2 models
    expect(m.runs).toBe(36 * 163)
  })

  it('reflects a shard in the model count', () => {
    const m = buildMatrixManifest({
      ...input,
      models: [{ label: 'qwen3-4b' }],
      shard: { index: 0, total: 2 },
    })
    expect(m.cells).toBe(18 * 1)
    expect(m.markdown).toContain('Shard 0/2')
  })

  it('markdown lists every embedder, reranker, model and the dataset', () => {
    const md = buildMatrixManifest(input).markdown
    expect(md).toContain('bge-m3')
    expect(md).toContain('e5-large')
    expect(md).toContain('jina-reranker-v2')
    expect(md).toContain('SkipReranker')
    expect(md).toContain('gemma-4-E4B')
    expect(md).toContain('2322')
    expect(md).toContain('163')
  })
})

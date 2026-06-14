import { describe, it, expect } from 'vitest'
import { parseShard, selectShard } from '../evals/answer/matrix-manifest'

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

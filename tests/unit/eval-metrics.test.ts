import { describe, it, expect } from 'vitest'
import {
  recallAtK,
  recallRequiredAtK,
  mrr,
  ndcgAtK,
  summarize,
  type RankedResult,
} from '../evals/metrics'

const single = (chunkIds: string[], expected: string): RankedResult => ({ chunkIds, expected })
const multi = (chunkIds: string[], expected: string, required: string[]): RankedResult => ({
  chunkIds,
  expected,
  required,
})

describe('recallAtK (single-relevant)', () => {
  it('returns 0 on empty input', () => {
    expect(recallAtK([], 5)).toBe(0)
  })

  it('hits when expected is in top-K', () => {
    expect(recallAtK([single(['a', 'b', 'c'], 'b')], 5)).toBe(1)
  })

  it('misses when expected is past top-K', () => {
    expect(recallAtK([single(['a', 'b', 'c', 'd'], 'd')], 2)).toBe(0)
  })

  it('averages hits across queries', () => {
    expect(
      recallAtK([single(['a', 'b'], 'a'), single(['x', 'y'], 'z'), single(['p', 'q'], 'q')], 2),
    ).toBeCloseTo(2 / 3, 5)
  })
})

describe('recallRequiredAtK (multi-relevant)', () => {
  it('falls back to [expected] when required is absent (identical to recall@K)', () => {
    const results: RankedResult[] = [single(['a', 'b'], 'b'), single(['x', 'y'], 'z')]
    expect(recallRequiredAtK(results, 2)).toBe(recallAtK(results, 2))
  })

  it('full hit: all required in top-K', () => {
    expect(recallRequiredAtK([multi(['a', 'b', 'c'], 'a', ['a', 'b', 'c'])], 3)).toBe(1)
  })

  it('partial hit: 3 of 4 required in top-K', () => {
    // required=[A,B,C,D] , top-5=[A,X,C,Y,B] → {A,C,B} hit → 3/4 = 0.75
    expect(
      recallRequiredAtK([multi(['A', 'X', 'C', 'Y', 'B'], 'A', ['A', 'B', 'C', 'D'])], 5),
    ).toBeCloseTo(0.75, 5)
  })

  it('zero hit: none of required in top-K', () => {
    expect(recallRequiredAtK([multi(['x', 'y', 'z'], 'a', ['a', 'b', 'c'])], 3)).toBe(0)
  })

  it('K bounds the visible window', () => {
    // required=[a,b] , full result=[a,c,b] , K=2 → only a hit → 1/2 = 0.5
    expect(recallRequiredAtK([multi(['a', 'c', 'b'], 'a', ['a', 'b'])], 2)).toBeCloseTo(0.5, 5)
  })

  it('averages per-query coverage across the batch', () => {
    const results: RankedResult[] = [
      multi(['a', 'b'], 'a', ['a', 'b']), // 2/2 = 1.0
      multi(['x', 'y', 'z'], 'z', ['z', 'q']), // 1/2 = 0.5
      multi(['p', 'q', 'r'], 'p', ['a', 'b']), // 0/2 = 0
    ]
    expect(recallRequiredAtK(results, 5)).toBeCloseTo((1 + 0.5 + 0) / 3, 5)
  })

  it('skips queries with empty required set rather than dividing by zero', () => {
    // edge case: required=[] is malformed but shouldn't crash
    const results: RankedResult[] = [
      { chunkIds: ['a', 'b'], expected: 'a', required: [] },
      multi(['a', 'b'], 'a', ['a']),
    ]
    // first query contributes 0 (skipped) , second contributes 1.0 , mean over 2 = 0.5
    // chosen behavior: divide by total query count , not by non-empty count
    expect(recallRequiredAtK(results, 5)).toBeCloseTo(0.5, 5)
  })
})

describe('mrr (single-relevant)', () => {
  it('returns 1 for rank-1 hits, 0.5 for rank-2', () => {
    expect(mrr([single(['a', 'b'], 'a'), single(['a', 'b'], 'b')])).toBeCloseTo(0.75, 5)
  })

  it('returns 0 when expected is missing', () => {
    expect(mrr([single(['a', 'b'], 'z')])).toBe(0)
  })
})

describe('ndcgAtK (single-relevant)', () => {
  it('rank-1 hit gives nDCG=1', () => {
    expect(ndcgAtK([single(['a', 'b'], 'a')], 5)).toBe(1)
  })

  it('rank-2 hit gives 1/log2(3)', () => {
    expect(ndcgAtK([single(['a', 'b'], 'b')], 5)).toBeCloseTo(1 / Math.log2(3), 5)
  })

  it('miss in top-K gives 0', () => {
    expect(ndcgAtK([single(['a', 'b', 'c'], 'z')], 5)).toBe(0)
  })
})

describe('summarize', () => {
  it('reports all metrics including new recallRequired fields', () => {
    const r = summarize('test', [
      multi(['a', 'b', 'c'], 'a', ['a', 'b']),
      single(['x', 'y', 'z'], 'z'),
    ])
    expect(r.config).toBe('test')
    expect(r.numQueries).toBe(2)
    expect(r.recallAt5).toBeCloseTo(1, 5)
    expect(r.recallRequiredAt5).toBeCloseTo((1 + 1) / 2, 5) // both fully covered at K=5
    expect(r.recallRequiredAt10).toBeCloseTo((1 + 1) / 2, 5)
    expect(r.recallRequiredAt12).toBeCloseTo((1 + 1) / 2, 5)
  })
})

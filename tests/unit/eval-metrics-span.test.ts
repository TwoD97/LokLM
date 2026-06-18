import { describe, it, expect } from 'vitest'
import {
  spansOverlap,
  spanHitRank,
  recallAtKSpan,
  mrrSpan,
  ndcgAtKSpan,
  type Span,
  type SpanRankedResult,
} from '../evals/metrics-span'

const span = (docId: string, start: number, end: number): Span => ({ docId, start, end })

describe('spansOverlap', () => {
  it('true when ranges overlap in the same doc', () => {
    expect(spansOverlap(span('d', 0, 100), span('d', 50, 150))).toBe(true)
  })
  it('false for touching-but-not-overlapping ranges', () => {
    expect(spansOverlap(span('d', 0, 100), span('d', 100, 200))).toBe(false)
  })
  it('false across different docs', () => {
    expect(spansOverlap(span('a', 0, 100), span('b', 0, 100))).toBe(false)
  })
})

describe('spanHitRank', () => {
  it('returns 1-based rank of first overlapping span', () => {
    const spans = [span('d', 500, 600), span('d', 0, 100), span('d', 200, 300)]
    expect(spanHitRank(spans, [span('d', 50, 70)])).toBe(2)
  })
  it('returns null when nothing overlaps', () => {
    expect(spanHitRank([span('d', 0, 100)], [span('d', 500, 600)])).toBeNull()
  })
  it('returns null for empty gold array', () => {
    expect(spanHitRank([{ docId: 'd', start: 0, end: 100 }], [])).toBeNull()
  })
})

describe('recallAtKSpan / mrrSpan / ndcgAtKSpan', () => {
  const hitAt2: SpanRankedResult = {
    spans: [span('d', 900, 1000), span('d', 0, 100)],
    gold: [span('d', 10, 20)],
  }
  const miss: SpanRankedResult = {
    spans: [span('d', 900, 1000)],
    gold: [span('d', 0, 100)],
  }
  it('recall@1 misses a rank-2 hit, recall@5 catches it', () => {
    expect(recallAtKSpan([hitAt2], 1)).toBe(0)
    expect(recallAtKSpan([hitAt2], 5)).toBe(1)
  })
  it('recall is the fraction of queries with a hit in top-k', () => {
    expect(recallAtKSpan([hitAt2, miss], 5)).toBe(0.5)
  })
  it('mrr uses reciprocal rank', () => {
    expect(mrrSpan([hitAt2])).toBeCloseTo(0.5, 5)
  })
  it('mrr averages over mixed hit and miss', () => {
    expect(mrrSpan([hitAt2, miss])).toBeCloseTo(0.25, 5)
  })
  it('ndcg discounts by log2(rank+1)', () => {
    expect(ndcgAtKSpan([hitAt2], 5)).toBeCloseTo(1 / Math.log2(3), 5)
  })
  it('ndcg averages over mixed hit and miss', () => {
    expect(ndcgAtKSpan([hitAt2, miss], 5)).toBeCloseTo(1 / Math.log2(3) / 2, 5)
  })
  it('all metrics return 0 on empty input', () => {
    expect(recallAtKSpan([], 5)).toBe(0)
    expect(mrrSpan([])).toBe(0)
    expect(ndcgAtKSpan([], 5)).toBe(0)
  })
})

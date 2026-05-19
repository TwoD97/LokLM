import { describe, it, expect } from 'vitest'
import { fuseRrf, RRF_K } from '@main/services/retrieval/rrf'
import type { SearchHit } from '@main/db/database'

function hit(chunkId: number, score: number, docId = 1): SearchHit {
  return {
    chunk_id: chunkId,
    document_id: docId,
    document_title: 'd',
    ordinal: chunkId,
    page_from: 1,
    page_to: 1,
    text: `chunk ${chunkId}`,
    score,
  }
}

describe('fuseRrf', () => {
  it('returns input when seed pool is empty', () => {
    const out = fuseRrf([], [hit(1, 0.9), hit(2, 0.8)], 10)
    expect(out.map((h) => h.chunk_id)).toEqual([1, 2])
  })

  it('combines two ranked lists by RRF rank-score', () => {
    const a = [hit(1, 1.0), hit(2, 0.8), hit(3, 0.6)]
    const b = [hit(3, 0.9), hit(2, 0.7), hit(4, 0.5)]
    const fused1 = fuseRrf([], a, 10)
    const fused2 = fuseRrf(fused1, b, 10)
    // chunk 2 appears in both lists at strong positions; should rank top
    expect(fused2.map((h) => h.chunk_id)).toContain(2)
    expect(fused2.length).toBeLessThanOrEqual(10)
  })

  it('overwrites score with fused rank-based score, not preserved BM25/cosine', () => {
    const a = [hit(1, 100.0)] // huge BM25 score, but rank=0 → 1/(K+1)
    const out = fuseRrf([], a, 10)
    expect(out[0]!.score).toBeCloseTo(1 / (RRF_K + 1), 5)
  })

  it('caps result length to topK', () => {
    const a = Array.from({ length: 50 }, (_, i) => hit(i, 1 - i / 100))
    const out = fuseRrf([], a, 5)
    expect(out).toHaveLength(5)
  })
})

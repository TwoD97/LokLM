import { describe, it, expect } from 'vitest'
import { fuseRrf, RRF_K } from '@main/services/retrieval/rrf'
import type { SearchHit } from '@main/db/types'

function hit(chunkId: number, score: number, docId = 1): SearchHit {
  return {
    chunk_id: chunkId,
    document_id: docId,
    document_title: 'd',
    ordinal: chunkId,
    page_from: 1,
    page_to: 1,
    heading_path: null,
    text: `chunk ${chunkId}`,
    score,
    language: null,
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

  it('weight scales a list contribution by the given factor', () => {
    // A rank-0 hit fused with weight 2 earns twice the increment of weight 1.
    const out1 = fuseRrf([], [hit(1, 0.5)], 10, 1)
    const out2 = fuseRrf([], [hit(1, 0.5)], 10, 2)
    expect(out1[0]!.score).toBeCloseTo(1 / (RRF_K + 1), 5)
    expect(out2[0]!.score).toBeCloseTo(2 / (RRF_K + 1), 5)
  })

  it('up-weighting BM25 keeps a strong lexical hit ahead of dense-only noise', () => {
    // The interpreter-query failure in miniature: chunk 1 is BM25's rank-0
    // match (the real definition); chunks 2-4 are dense-only noise that never
    // appears in the lexical list. Even-weight fusion lets the three dense hits
    // accumulate and bury chunk 1; a BM25 lean keeps it on top.
    const bm25 = [hit(1, 12.0)]
    const dense = [hit(2, 0.51), hit(3, 0.5), hit(1, 0.49)]
    const even = fuseRrf(fuseRrf([], bm25, 10, 1), dense, 10)
    const leaned = fuseRrf(fuseRrf([], bm25, 10, 2), dense, 10)
    // Under the lean, chunk 1 is the top result; the dense noise sits below it.
    expect(leaned[0]!.chunk_id).toBe(1)
    // Sanity: the lean raised chunk 1's standing vs even fusion.
    const rank = (out: SearchHit[]): number => out.findIndex((h) => h.chunk_id === 1)
    expect(rank(leaned)).toBeLessThanOrEqual(rank(even))
  })
})

import type { SearchHit } from '@main/db/database'

export const RRF_K = 60

/**
 * Reciprocal Rank Fusion. Each list is treated as a ranking; a hit's RRF
 * score is the sum of 1 / (k + rank) across the lists it appears in. The
 * caller seeds with `seed` (the running pool from previous variants) and
 * fuses in `next` (one new ranked list). Same hit can appear in both — its
 * scores add. Returns the top `cap` hits sorted by fused score desc.
 */
export function fuseRrf(seed: SearchHit[], next: SearchHit[], cap: number): SearchHit[] {
  const scores = new Map<number, { hit: SearchHit; score: number }>()
  for (const entry of seed) {
    scores.set(entry.chunk_id, { hit: entry, score: entry.score })
  }
  for (let i = 0; i < next.length; i++) {
    const hit = next[i]!
    const inc = 1 / (RRF_K + i + 1)
    const existing = scores.get(hit.chunk_id)
    if (existing) existing.score += inc
    else scores.set(hit.chunk_id, { hit, score: inc })
  }
  const fused = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
  // overwrite the underlying-source score with the fused score so downstream
  // consumers (heuristics, rerank) see RRF-scale numbers, not BM25/cosine.
  return fused.map(({ hit, score }) => ({ ...hit, score }))
}

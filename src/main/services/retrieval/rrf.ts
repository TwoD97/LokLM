import type { SearchHit } from '@main/db/types'

export const RRF_K = 60

/**
 * Reciprocal Rank Fusion. Each list is treated as a ranking; a hit's RRF
 * score is the sum of `weight` / (k + rank) across the lists it appears in.
 * The caller seeds with `seed` (the running pool from previous variants) and
 * fuses in `next` (one new ranked list). Same hit can appear in both — its
 * scores add. Returns the top `cap` hits sorted by fused score desc.
 *
 * `weight` (default 1) scales this list's contribution. Use it to lean the
 * fusion toward the retriever that's actually discriminating on a given corpus:
 * on short keyword queries the dense embedder's cosine scores can collapse to a
 * narrow band (every chunk ~0.5) and drag topically-adjacent noise into the top
 * slate, while BM25 still separates a literal-term match by a wide margin.
 * Up-weighting the lexical list keeps that high-confidence match from being
 * outvoted by collapsed dense ranks — especially when no reranker runs to clean
 * the pool afterwards.
 */
export function fuseRrf(
  seed: SearchHit[],
  next: SearchHit[],
  cap: number,
  weight = 1,
): SearchHit[] {
  const scores = new Map<number, { hit: SearchHit; score: number }>()
  for (const entry of seed) {
    scores.set(entry.chunk_id, { hit: entry, score: entry.score })
  }
  for (let i = 0; i < next.length; i++) {
    const hit = next[i]!
    const inc = weight / (RRF_K + i + 1)
    const existing = scores.get(hit.chunk_id)
    if (existing) {
      existing.score += inc
      existing.hit = mergeArmScores(existing.hit, hit)
    } else scores.set(hit.chunk_id, { hit, score: inc })
  }
  const fused = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
  // overwrite the underlying-source score with the fused score so downstream
  // consumers (heuristics, rerank) see RRF-scale numbers, not BM25/cosine.
  return fused.map(({ hit, score }) => ({ ...hit, score }))
}

/** A chunk found by BOTH arms (or by the same arm across variants) keeps the
 *  best of each arm's native score — the no-rerank relevance floor reads them
 *  after fusion has overwritten `score` with RRF ranks. */
function mergeArmScores(a: SearchHit, b: SearchHit): SearchHit {
  const bm25 = maxDefined(a.bm25Score, b.bm25Score)
  const cosine = maxDefined(a.cosineScore, b.cosineScore)
  if (bm25 === a.bm25Score && cosine === a.cosineScore) return a
  const merged = { ...a }
  if (bm25 !== undefined) merged.bm25Score = bm25
  if (cosine !== undefined) merged.cosineScore = cosine
  return merged
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

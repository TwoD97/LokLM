import type { SearchHit } from '@main/db/types'

export const RRF_K = 60

export interface RankedList {
  hits: readonly SearchHit[]
  weight?: number
}

/** Sum every bounded ranking before applying the final pool cap. Truncating a
 * running accumulator loses earlier contributions when a candidate reappears
 * in a later query variant. Stable summation and chunk-id ties make the result
 * independent of arm/variant arrival order. */
export function fuseRrfLists(lists: readonly RankedList[], cap: number): SearchHit[] {
  const candidates = new Map<number, { hit: SearchHit; contributions: number[] }>()
  for (const { hits, weight = 1 } of lists) {
    const seen = new Set<number>()
    for (let index = 0; index < hits.length; index++) {
      const hit = hits[index]!
      // A chunk gets one vote per ranking, even if an adapter repeats a row.
      if (seen.has(hit.chunk_id)) continue
      seen.add(hit.chunk_id)
      const contribution = weight / (RRF_K + index + 1)
      const candidate = candidates.get(hit.chunk_id)
      if (candidate) {
        candidate.contributions.push(contribution)
        candidate.hit = mergeArmScores(candidate.hit, hit)
      } else candidates.set(hit.chunk_id, { hit, contributions: [contribution] })
    }
  }
  return Array.from(candidates.values())
    .map(({ hit, contributions }) => ({
      ...hit,
      score: contributions.sort((a, b) => a - b).reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => b.score - a.score || a.chunk_id - b.chunk_id)
    .slice(0, Math.max(0, cap))
}

/**
 * Reciprocal Rank Fusion. Each list is treated as a ranking; a hit's RRF
 * score is the sum of `weight` / (k + rank) across the lists it appears in.
 * The caller seeds with `seed` (the running pool from previous variants) and
 * fuses in `next` (one new ranked list). Same hit can appear in both — its
 * scores add. Returns the top `cap` hits sorted by fused score desc.
 * Prefer fuseRrfLists for multiple arms/variants; repeatedly capping this
 * two-list helper cannot recover candidates discarded in an earlier call.
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

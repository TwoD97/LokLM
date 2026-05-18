// retrieval-metriken für die eval. alle erwarten dass jeder query genau einen
// ground-truth chunkId hat (single-relevant , wie aus generate-dataset).
//
// recall@k = anteil der queries bei denen die richtige antwort in den ersten k
//            ergebnissen drin ist.
// MRR      = mean reciprocal rank , 1/rank über alle queries gemittelt.
// nDCG@k   = normalized discounted cumulative gain auf k. für single-relevant
//            entartet das zu 1/log2(rank+1) wenn ground-truth in top-k , sonst 0.

export interface RankedResult {
  /** geordnet beste ergebnisse zuerst */
  chunkIds: string[]
  /** der korrekte chunkId aus dem dataset */
  expected: string
}

export function recallAtK(results: RankedResult[], k: number): number {
  if (results.length === 0) return 0
  let hits = 0
  for (const r of results) {
    if (r.chunkIds.slice(0, k).includes(r.expected)) hits++
  }
  return hits / results.length
}

export function mrr(results: RankedResult[]): number {
  if (results.length === 0) return 0
  let total = 0
  for (const r of results) {
    const rank = r.chunkIds.indexOf(r.expected) + 1
    if (rank > 0) total += 1 / rank
  }
  return total / results.length
}

export function ndcgAtK(results: RankedResult[], k: number): number {
  if (results.length === 0) return 0
  let total = 0
  for (const r of results) {
    const rank = r.chunkIds.slice(0, k).indexOf(r.expected) + 1
    if (rank > 0) total += 1 / Math.log2(rank + 1)
  }
  // single-relevant , ideal-DCG ist konstant 1/log2(2) = 1
  return total / results.length
}

export interface EvalReport {
  config: string
  numQueries: number
  recallAt1: number
  recallAt5: number
  recallAt10: number
  mrr: number
  ndcgAt10: number
}

export function summarize(configName: string, results: RankedResult[]): EvalReport {
  return {
    config: configName,
    numQueries: results.length,
    recallAt1: recallAtK(results, 1),
    recallAt5: recallAtK(results, 5),
    recallAt10: recallAtK(results, 10),
    mrr: mrr(results),
    ndcgAt10: ndcgAtK(results, 10),
  }
}

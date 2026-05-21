// retrieval-metriken für die eval.
//
// Single-Relevant (recallAtK, mrr, ndcgAtK):
//   Jede Query hat genau einen ground-truth chunkId. Klassische Faktoid-
//   Metriken , wie aus generate-dataset für die alten Datensätze.
//
// Multi-Relevant (recallRequiredAtK):
//   Jede Query hat ein Set von Chunks , die alle abgedeckt sein sollten ,
//   damit die Antwort vollständig ist. Wird für broad/summary-Fragen benutzt ,
//   bei denen ein einziger Chunk nicht reicht. Reduziert sich exakt auf
//   recall@K wenn |required|=1.
//
// recall@k         = anteil der queries bei denen die richtige antwort in den
//                    ersten k ergebnissen drin ist (single-relevant).
// recall_req@k     = mittlerer anteil der required-chunks , die in den ersten
//                    k ergebnissen landen (multi-relevant).
// MRR              = mean reciprocal rank , 1/rank über alle queries gemittelt.
// nDCG@k           = normalized discounted cumulative gain auf k.

export interface RankedResult {
  /** geordnet beste ergebnisse zuerst */
  chunkIds: string[]
  /** der korrekte chunkId aus dem dataset (single-relevant) */
  expected: string
  /** Multi-Relevant-Ground-Truth: alle Chunks , die in den Top-K stehen sollten.
   *  Fehlt → fallback auf [expected]. */
  required?: string[]
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

/**
 * Multi-Relevant recall: für jede Query der Anteil der `required`-Chunks ,
 * die in den ersten K Ergebnissen landen. Über alle Queries gemittelt. Wenn
 * `required` fehlt , wird auf `[expected]` zurückgefallen — dann ist die
 * Metrik identisch zu recall@K.
 *
 * Beispiel: required=[A,B,C,D] , top-K=[A,X,C,Y,B] → |{A,C,B}|/4 = 0.75
 */
export function recallRequiredAtK(results: RankedResult[], k: number): number {
  if (results.length === 0) return 0
  let total = 0
  for (const r of results) {
    const required = r.required ?? [r.expected]
    if (required.length === 0) continue
    const topK = new Set(r.chunkIds.slice(0, k))
    let hit = 0
    for (const id of required) {
      if (topK.has(id)) hit++
    }
    total += hit / required.length
  }
  return total / results.length
}

export interface EvalReport {
  config: string
  numQueries: number
  recallAt1: number
  recallAt5: number
  recallAt10: number
  /** Multi-Relevant: mittlere Abdeckung der required-Chunk-Sets in Top-K.
   *  Identisch zu recall@K wenn alle Queries single-relevant sind. */
  recallRequiredAt5: number
  recallRequiredAt10: number
  recallRequiredAt12: number
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
    recallRequiredAt5: recallRequiredAtK(results, 5),
    recallRequiredAt10: recallRequiredAtK(results, 10),
    recallRequiredAt12: recallRequiredAtK(results, 12),
    mrr: mrr(results),
    ndcgAt10: ndcgAtK(results, 10),
  }
}

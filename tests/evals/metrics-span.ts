// Span-basierte Retrieval-Metriken — chunker-unabhängiges Gegenstück zu
// metrics.ts. Ein Treffer zählt, wenn ein retrievter Chunk-Span einen Gold-Span
// überlappt (statt exaktem chunkId-Match). Voraussetzung für eine valide
// Chunker-Achse in der Matrix: dieselbe Gold-Wahrheit ist gegen jede
// Chunk-Größe bewertbar.

export interface Span {
  docId: string
  /** char-offset (inklusiv) im quell-dokument */
  start: number
  /** char-offset (exklusiv) im quell-dokument */
  end: number
}

export interface SpanRankedResult {
  /** retrievte chunk-spans, bestes ergebnis zuerst */
  spans: Span[]
  /** gold-spans der query; überlappung mit irgendeinem = treffer */
  gold: Span[]
}

/** Halb-offene Intervall-Überlappung im selben Dokument. Berührende Ränder
 *  ([0,100) und [100,200)) gelten NICHT als Überlappung. */
export function spansOverlap(a: Span, b: Span): boolean {
  return a.docId === b.docId && a.start < b.end && b.start < a.end
}

/** 1-basierter Rang des ersten retrievten Spans, der irgendeinen Gold-Span
 *  überlappt. null wenn keiner überlappt. */
export function spanHitRank(spans: Span[], gold: Span[]): number | null {
  for (let i = 0; i < spans.length; i++) {
    for (const g of gold) {
      if (spansOverlap(spans[i]!, g)) return i + 1
    }
  }
  return null
}

export function recallAtKSpan(results: SpanRankedResult[], k: number): number {
  if (results.length === 0) return 0
  let hits = 0
  for (const r of results) {
    const rank = spanHitRank(r.spans, r.gold)
    if (rank !== null && rank <= k) hits++
  }
  return hits / results.length
}

export function mrrSpan(results: SpanRankedResult[]): number {
  if (results.length === 0) return 0
  let total = 0
  for (const r of results) {
    const rank = spanHitRank(r.spans, r.gold)
    if (rank !== null) total += 1 / rank
  }
  return total / results.length
}

export function ndcgAtKSpan(results: SpanRankedResult[], k: number): number {
  if (results.length === 0) return 0
  let total = 0
  for (const r of results) {
    const rank = spanHitRank(r.spans, r.gold)
    if (rank !== null && rank <= k) total += 1 / Math.log2(rank + 1)
  }
  // single-relevant ideal-DCG = 1/log2(2) = 1
  return total / results.length
}

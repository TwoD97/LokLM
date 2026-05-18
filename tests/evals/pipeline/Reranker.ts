// reranker-interface , nimmt eine query + kandidaten-chunks und liefert eine
// neue ordnung mit scores. cross-encoder (z.B. bge-reranker-base) wäre die
// echte impl , platzhalter hier ist identity (no-op).

export interface RankInput {
  text: string
  /** vorberechneter score aus dem ersten retrieval-schritt */
  initialScore: number
}

export interface RankedItem {
  text: string
  /** finaler score nach reranking */
  score: number
  /** position davor , für debugging */
  initialIndex: number
}

export interface Reranker {
  readonly name: string
  rerank(query: string, items: RankInput[]): Promise<RankedItem[]>
}

/** kein reranker , gibt die input-reihenfolge zurück. nützlich als baseline. */
export class NoopReranker implements Reranker {
  readonly name = 'noop'
  async rerank(_query: string, items: RankInput[]): Promise<RankedItem[]> {
    return items.map((it, i) => ({ text: it.text, score: it.initialScore, initialIndex: i }))
  }
}

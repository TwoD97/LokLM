// matrix-manifest , reine Helfer für den Matrix-Lauf:
//  - parseShard / selectShard : deterministische, disjunkte Modell-Aufteilung
//    über mehrere Pods (round-robin per Index).
//  - buildMatrixManifest : Pre-Run-Zusammenfassung (kommt in Task 2).
// Bewusst ohne Modell-/GPU-Abhängigkeit, damit unit-testbar.

export interface Shard {
  index: number
  total: number
}

/** Parse "i/n" (0-based index, i < n). Wirft bei Unsinn. */
export function parseShard(s: string): Shard {
  const m = /^(\d+)\/(\d+)$/.exec(s.trim())
  if (!m) throw new Error(`--shard muss "i/n" sein (z.B. 0/4) , war: ${s}`)
  const index = Number(m[1])
  const total = Number(m[2])
  if (total < 1) throw new Error(`--shard total muss >= 1 sein , war: ${total}`)
  if (index < 0 || index >= total)
    throw new Error(`--shard index muss 0..${total - 1} sein , war: ${index}`)
  return { index, total }
}

/** Round-robin-Slice: Pod `index` bekommt jedes `total`-te Element. Union aller
 *  Shards == Eingabe , keine Überlappung. */
export function selectShard<T>(items: T[], index: number, total: number): T[] {
  return items.filter((_, i) => i % total === index)
}

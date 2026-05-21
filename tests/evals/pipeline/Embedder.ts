// embedder-interface , liefert für einen text einen vektor.
// platzhalter , bis ein echter embedder (transformers.js , ollama-embed , ...)
// in src/main/services/ landet. dann hier eine bridge bauen die genau diese
// impl wraps , statt einen eigenen embedder zu pflegen.

export interface Embedder {
  readonly name: string
  /** dimension des output-vektors , konstant pro modell */
  readonly dim: number
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}

/**
 * deterministischer fake-embedder für scaffold-tests. nimmt einen char-hash
 * und projiziert auf `dim`-dimensionen. nicht aussagekräftig , aber lässt
 * den runner ohne externes modell laufen.
 */
export class FakeEmbedder implements Embedder {
  readonly name: string
  constructor(
    readonly dim = 64,
    name = 'fake-hash',
  ) {
    this.name = `${name}:${dim}`
  }

  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(this.dim).fill(0)
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      v[c % this.dim] = (v[c % this.dim] ?? 0) + 1
    }
    // l2-normalize
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
    return v.map((x) => x / norm)
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)))
  }
}

/** Accepts either `number[]` or `Float32Array`. Bridges that return raw
 *  Float32 from node-llama-cpp can skip the Array.from copy and feed the
 *  typed array straight in — the loop is identical, but the typed-array
 *  path is a ~4× memory win for the chunkVecs cache and the indexed access
 *  is hot-path-friendlier in V8.
 *
 *  Assumes l2-normalized inputs (every Embedder in this folder normalizes)
 *  so we compute a plain dot product rather than `dot / (|a| * |b|)`. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error('vector dim mismatch')
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
  }
  return dot
}

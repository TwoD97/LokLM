// Lightweight in-memory BM25 for the code-retrieval eval — the lexical track.
//
// Production runs BM25 via SQLite FTS5 (chunks_fts, tokenize='unicode61'). We
// can't drive encrypted SQLite headlessly without a full workspace, so this
// mirrors FTS5 closely enough to reproduce the SAME failure mode: the default
// tokenizer indexes chunk TEXT only and does NOT split camelCase, so the query
// token "auth" never matches the single token "authservice". That is exactly
// why the lexical track is blind to symbol names today.
//
// Two tokenizers:
//   tokenizeFts  — unicode61-like: lowercase, split on non-alphanumeric, NO
//                  camelCase split. The production-faithful baseline.
//   tokenizeCode — additionally splits camelCase / snake_case and is used by the
//                  symbol-FTS ablation (fix #4): index text + heading_path so
//                  "auth" -> ["auth"] matches "AuthService" -> [...,"auth"].

/** unicode61-ish: alphanumeric runs, lowercased. "AuthService" -> ["authservice"]. */
export function tokenizeFts(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length > 0)
}

/** Split a single raw (original-case) token on camelCase + letter/digit
 *  boundaries. "AuthService" -> ["auth","service"], "f32ToBlob" -> ["f32","to","blob"]. */
function splitCamel(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0)
}

/** Emits the whole lowercased token PLUS its camel/snake parts, so a query word
 *  ("auth") hits a compound symbol ("AuthService"). */
export function tokenizeCode(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[^A-Za-z0-9]+/u).filter((t) => t.length > 0)) {
    out.push(raw.toLowerCase())
    const parts = splitCamel(raw)
    if (parts.length > 1) out.push(...parts)
  }
  return out
}

export interface Bm25Doc {
  id: number
  text: string
}

interface Posting {
  docId: number
  tf: number
}

const K1 = 1.2
const B = 0.75

export class Bm25Index {
  private readonly idf = new Map<string, number>()
  private readonly postings = new Map<string, Posting[]>()
  private readonly docLen = new Map<number, number>()
  private avgdl = 0
  private readonly n: number
  private readonly tokenize: (t: string) => string[]

  constructor(docs: Bm25Doc[], tokenize: (t: string) => string[]) {
    this.tokenize = tokenize
    this.n = docs.length
    let totalLen = 0
    const df = new Map<string, number>()
    for (const doc of docs) {
      const toks = tokenize(doc.text)
      this.docLen.set(doc.id, toks.length)
      totalLen += toks.length
      const tf = new Map<string, number>()
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
      for (const [term, count] of tf) {
        const arr = this.postings.get(term) ?? []
        arr.push({ docId: doc.id, tf: count })
        this.postings.set(term, arr)
        df.set(term, (df.get(term) ?? 0) + 1)
      }
    }
    this.avgdl = this.n > 0 ? totalLen / this.n : 0
    for (const [term, dft] of df) {
      // Robertson/Sparck-Jones idf with the +1 smoothing FTS5/bm25 uses, so
      // every matched term contributes a non-negative weight.
      this.idf.set(term, Math.log(1 + (this.n - dft + 0.5) / (dft + 0.5)))
    }
  }

  search(query: string, topN: number): Array<{ id: number; score: number }> {
    const qTerms = new Set(this.tokenize(query))
    const acc = new Map<number, number>()
    for (const term of qTerms) {
      const idf = this.idf.get(term)
      const postings = this.postings.get(term)
      if (idf === undefined || !postings) continue
      for (const { docId, tf } of postings) {
        const dl = this.docLen.get(docId) ?? 0
        const denom = tf + K1 * (1 - B + (B * dl) / (this.avgdl || 1))
        const score = idf * ((tf * (K1 + 1)) / (denom || 1))
        acc.set(docId, (acc.get(docId) ?? 0) + score)
      }
    }
    return [...acc.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
  }
}

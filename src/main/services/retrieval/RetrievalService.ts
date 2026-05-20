import type { ChunkRow, Database, SearchHit } from '../../db/database'
import type { ProviderRegistry } from '../providers/Registry'
import { fuseRrf } from './rrf'
import { applyTitleBoost, applyShortChunkPenalty, applyRecencyBoost } from './heuristics'

export interface RetrievalHit {
  chunk_id: number
  document_id: number
  document_title: string
  ordinal: number
  page_from: number | null
  page_to: number | null
  /** Hierarchical heading breadcrumb for markdown chunks. Null for PDFs and
   *  unstructured text. Renderer formats as "§ A › B" for citations. */
  heading_path: string[] | null
  text: string
  score: number
  /** Why this hit ended up in the result set — useful for the renderer to
   *  visually distinguish "primary match" from "expanded neighbour" etc. */
  origin?: 'primary' | 'neighbour' | 'whole_doc'
}

export interface RetrievalOptions {
  /** Send the user query through the LLM to generate 2 paraphrased variants
   *  before retrieving; RRF-fuse all variants. Big recall lift on
   *  conversational queries; ~1–2 extra LLM passes per chat turn. */
  multiQuery?: boolean
  /** Cross-encoder rerank the fused candidate pool using bge-reranker-v2-m3
   *  (or any *reranker*.gguf in models/). Big precision lift, adds ~200–600 ms
   *  per call depending on candidate count. */
  rerank?: boolean
  /** Cap how many chunks a single document may contribute to top-K.
   *  Default true: fixes the "one dense doc monopolises retrieval" problem
   *  (e.g. user asks about their *Wochenbuch* but a long *Strom-und-Spannung*
   *  PDF wins every reranker slot). Round-robin selection: top-1 from each
   *  doc, then top-2, etc. */
  documentDiversity?: boolean
  /** When a primary hit comes from a "small" document (≤ wholeDocThreshold
   *  chunks), include the *entire* document in the result rather than a
   *  single chunk. Fixes "summarize this short note"-style queries. */
  wholeDocFallback?: boolean
  wholeDocThreshold?: number
  /** Include ±neighbourRadius chunks around each primary hit so the model
   *  sees the surrounding paragraph, not just an isolated sentence. */
  neighbourRadius?: number
  /** NotebookLM-style source focus. When non-empty, retrieval is constrained
   *  to these document_ids. Empty/null = workspace-wide (default). */
  activeDocumentIds?: number[] | null
  /** Per-document cap on the candidate pool returned by BM25 and dense,
   *  enforced at SQL via ROW_NUMBER(). Stops a content-dense doc from
   *  starving smaller docs of representation BEFORE the reranker even sees
   *  them. Default 6; set 0 to disable. */
  perDocCandidateCap?: number
  /** Multiplicative score boost (>1.0) for chunks whose document title shares
   *  a non-stopword token with the query. Cheap; helps "summarize my
   *  TudosaDenys_Wochenbuch" land on the right doc. */
  titleBoostFactor?: number
  /** Multiplicative score penalty (<1.0) for chunks below `shortChunkMinChars`.
   *  Targets cover pages / TOC stubs that win on keyword density but carry
   *  no usable content. Default 0.7 below 200 chars. */
  shortChunkPenalty?: number
  shortChunkMinChars?: number
  /** Multiplicative score boost for chunks whose document was added in the
   *  last `recencyBoostWindowMs`. Captures the "I just uploaded this and
   *  asked about it" UX without requiring an explicit focus. Default 1.10
   *  over 10 minutes. Set factor to 1.0 to disable. */
  recencyBoostFactor?: number
  recencyBoostWindowMs?: number
}

/**
 * Hybrid retrieval pipeline. Stages, in order:
 *   0. Multi-query expansion       → 1–3 query variants
 *   1. Per-variant BM25 + dense    → RRF-fused candidate pool
 *   2. Cross-encoder rerank        → top-K precision pass
 *   3. Whole-doc / neighbour expand → broaden the surviving hits
 *
 * Each stage is optional (controlled by RetrievalOptions); the default
 * behaviour is the legacy single-query BM25+dense+RRF that the original
 * RetrievalService implemented. Stages 0 and 2 silently degrade if the
 * required model (LLM or reranker) isn't loaded.
 */
const FANOUT = 4
const MAX_CANDIDATES = 64
const DEFAULT_WHOLE_DOC_THRESHOLD = 8
const DEFAULT_PER_DOC_CAP = 6
const DEFAULT_TITLE_BOOST = 1.25
const DEFAULT_SHORT_CHUNK_PENALTY = 0.7
const DEFAULT_SHORT_CHUNK_MIN_CHARS = 200
const DEFAULT_RECENCY_BOOST = 1.1
const DEFAULT_RECENCY_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

export class RetrievalService {
  constructor(
    private readonly db: Database,
    private readonly registry: ProviderRegistry,
  ) {}

  async search(
    workspaceId: number,
    query: string,
    topK: number,
    opts: RetrievalOptions = {},
  ): Promise<RetrievalHit[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    const activeIds =
      opts.activeDocumentIds && opts.activeDocumentIds.length > 0 ? opts.activeDocumentIds : null
    const perDocCap =
      opts.perDocCandidateCap === undefined
        ? DEFAULT_PER_DOC_CAP
        : Math.max(0, opts.perDocCandidateCap)

    // ------- 0. multi-query expansion -------
    const queries = await this.maybeExpandQueries(trimmed, opts.multiQuery === true)

    // ------- 1. retrieve & RRF-fuse across variants -------
    // candidateK is the per-list ceiling. With the per-doc cap branch active
    // the SQL will pull at most `perDocCap` chunks per doc up to this global
    // ceiling — so a workspace with 10 docs can present up to 60 candidates
    // even when 1 doc would have dominated the global top-50.
    const candidateK = Math.min(MAX_CANDIDATES, Math.max(topK * FANOUT, topK))
    const searchOpts: { activeDocumentIds: number[] | null; perDocK?: number } = {
      activeDocumentIds: activeIds,
      ...(perDocCap > 0 ? { perDocK: perDocCap } : {}),
    }
    let pool: SearchHit[] = []
    for (const q of queries) {
      const [bm25, vector] = await this.retrieveSingle(workspaceId, q, candidateK, searchOpts)
      pool = fuseRrf(pool, bm25, candidateK)
      pool = fuseRrf(pool, vector, candidateK)
    }

    // ------- 1b. score adjustments BEFORE rerank -------
    // We mutate the fused RRF score (not the underlying SQL scores) so the
    // adjustments only influence ordering for the rerank candidate slate and
    // any fallback non-rerank path. The reranker, when on, reassigns scores
    // wholesale at stage 2, which is the intended behaviour: cross-encoder
    // similarity is more trustworthy than these heuristics.
    pool = applyTitleBoost(pool, trimmed, opts.titleBoostFactor ?? DEFAULT_TITLE_BOOST)
    pool = applyShortChunkPenalty(
      pool,
      opts.shortChunkPenalty ?? DEFAULT_SHORT_CHUNK_PENALTY,
      opts.shortChunkMinChars ?? DEFAULT_SHORT_CHUNK_MIN_CHARS,
    )
    pool = applyRecencyBoost(
      pool,
      opts.recencyBoostFactor ?? DEFAULT_RECENCY_BOOST,
      opts.recencyBoostWindowMs ?? DEFAULT_RECENCY_WINDOW_MS,
    )
    pool.sort((a, b) => b.score - a.score)

    // ------- 2. rerank (or fall back to fused order) -------
    // We rerank the *whole* candidate pool, not just the first topK, so the
    // diversification step below has reranked-quality candidates from every
    // document represented in the pool — not just whichever happened to win
    // the first K post-rerank slots.
    const reranked = await this.maybeRerank(trimmed, pool, opts.rerank === true)

    // ------- 2b. re-apply the same heuristics to the rerank output -------
    // Cross-encoder scores live on a different scale, but the heuristics still
    // express "I'd rather see a 600-char paragraph from a fresh doc than a
    // 90-char cover line" — so they belong on whatever score we use to rank.
    let postRank = reranked
    if (opts.rerank === true) {
      postRank = applyTitleBoost(postRank, trimmed, opts.titleBoostFactor ?? DEFAULT_TITLE_BOOST)
      postRank = applyShortChunkPenalty(
        postRank,
        opts.shortChunkPenalty ?? DEFAULT_SHORT_CHUNK_PENALTY,
        opts.shortChunkMinChars ?? DEFAULT_SHORT_CHUNK_MIN_CHARS,
      )
      postRank = applyRecencyBoost(
        postRank,
        opts.recencyBoostFactor ?? DEFAULT_RECENCY_BOOST,
        opts.recencyBoostWindowMs ?? DEFAULT_RECENCY_WINDOW_MS,
      )
      postRank = postRank.slice().sort((a, b) => b.score - a.score)
    }

    // ------- 2c. document diversification (round-robin) -------
    // Without this, a single content-rich doc can take all 8 top-K slots
    // even when the user's query was clearly about a different (smaller)
    // doc in the workspace.
    const ranked =
      opts.documentDiversity === false
        ? postRank.slice(0, topK)
        : diversifyByDocument(postRank, topK)

    // ------- 3. whole-doc + neighbour expansion -------
    let withWhole = ranked.map<HitWithOrigin>((h) => ({ hit: h, origin: 'primary' }))
    if (opts.wholeDocFallback !== false) {
      withWhole = await this.expandSmallDocs(
        withWhole,
        opts.wholeDocThreshold ?? DEFAULT_WHOLE_DOC_THRESHOLD,
      )
    }
    if ((opts.neighbourRadius ?? 0) > 0) {
      withWhole = await this.expandNeighbours(withWhole, opts.neighbourRadius!)
    }

    return withWhole.map(toHit)
  }

  // -------------------------------------------------------------------------
  // Stage helpers
  // -------------------------------------------------------------------------

  private async retrieveSingle(
    workspaceId: number,
    q: string,
    candidateK: number,
    searchOpts: { activeDocumentIds: number[] | null; perDocK?: number },
  ): Promise<[SearchHit[], SearchHit[]]> {
    const bm25Promise = this.db.documents().searchChunks(workspaceId, q, candidateK, searchOpts)
    // The provider contract throws on failure (no embedder model on disk,
    // Ollama unreachable, etc.) where the old EmbeddingService returned null.
    // Wrap in try/catch to preserve the user-visible "no embedder → BM25-only"
    // soft-fail behaviour.
    const vectorPromise: Promise<SearchHit[]> = (async () => {
      const embedder = this.registry.embedder()
      if (!embedder.isReady()) return []
      try {
        const vecs = await embedder.embed([q])
        const vec = vecs[0]
        if (!vec || vec.length === 0) return []
        // searchChunksByVector expects number[]; convert from the provider's
        // Float32Array. Array.from on a typed array materialises a plain Array.
        return this.db
          .documents()
          .searchChunksByVector(workspaceId, Array.from(vec), candidateK, searchOpts)
      } catch {
        return []
      }
    })()
    return Promise.all([bm25Promise, vectorPromise])
  }

  private async maybeExpandQueries(query: string, enabled: boolean): Promise<string[]> {
    const llm = this.registry.llm()
    if (!enabled || !llm.isReady()) return [query]
    try {
      const prompt =
        `Produce 2 paraphrases of the user's search query that retain the original meaning ` +
        `but use different vocabulary so a keyword index can find them. Output strictly two ` +
        `lines, one paraphrase per line, no preamble.\n\nQuery: ${query}\n\nParaphrases:`
      const raw = await llm.generateRaw(prompt, {})
      const lines = raw
        .split(/\r?\n/)
        .map((s) => s.replace(/^[-*\d.\s]+/, '').trim())
        .filter((s) => s.length > 3 && s.length < 240)
      // Always keep the original query first; cap variants at 2 to bound cost.
      return [query, ...lines.slice(0, 2)]
    } catch {
      return [query]
    }
  }

  private async maybeRerank(
    query: string,
    hits: SearchHit[],
    enabled: boolean,
  ): Promise<SearchHit[]> {
    const reranker = this.registry.reranker()
    if (!enabled || !reranker.isReady() || hits.length === 0) {
      return hits
    }
    const docs = hits.map((h) => h.text)
    // The provider contract throws when the underlying reranker fails or the
    // model isn't available (used to return null). Preserve the silent
    // soft-fail to RRF order by catching and returning the input hits.
    let scores: number[]
    try {
      scores = await reranker.rerank(query, docs)
    } catch {
      return hits
    }
    if (scores.length !== hits.length) return hits
    // Pair, sort by reranker score descending, write the score back so the
    // downstream UI can show the model's confidence on each chip.
    return hits.map((h, i) => ({ ...h, score: scores[i]! })).sort((a, b) => b.score - a.score)
  }

  private async expandSmallDocs(
    items: HitWithOrigin[],
    threshold: number,
  ): Promise<HitWithOrigin[]> {
    if (items.length === 0) return items
    const docIds = Array.from(new Set(items.map((it) => it.hit.document_id)))
    const counts = await this.db.documents().getChunkCounts(docIds)
    // Only expand the doc-ids whose primary chunk was a top hit AND whose
    // total chunk count is below the threshold. Larger docs get the chunk
    // they got from the ranker, no expansion.
    const expandIds = new Set<number>()
    for (const it of items) {
      if (it.origin !== 'primary') continue
      const total = counts.get(it.hit.document_id) ?? Infinity
      if (total <= threshold) expandIds.add(it.hit.document_id)
    }
    if (expandIds.size === 0) return items

    // Build a fast existing-id set so we don't double-include the primary.
    const seen = new Set(items.map((it) => it.hit.chunk_id))
    const additions: HitWithOrigin[] = []
    for (const docId of expandIds) {
      const docChunks = await this.db.documents().listChunksForDocument(docId)
      const sample = items.find((it) => it.hit.document_id === docId)?.hit
      const title = sample?.document_title ?? ''
      for (const c of docChunks) {
        if (seen.has(c.id)) continue
        seen.add(c.id)
        additions.push({
          hit: chunkToSearchHit(c, title, 0),
          origin: 'whole_doc',
        })
      }
    }
    // Splice each addition right after its same-doc primary so the model
    // reads the doc in order.
    return interleaveByDocument(items, additions)
  }

  private async expandNeighbours(items: HitWithOrigin[], radius: number): Promise<HitWithOrigin[]> {
    if (items.length === 0) return items
    const seeds = items
      .filter((it) => it.origin === 'primary')
      .map((it) => ({ documentId: it.hit.document_id, ordinal: it.hit.ordinal }))
    if (seeds.length === 0) return items
    const neighbours = await this.db.documents().getNeighbourChunks(seeds, radius)
    const seen = new Set(items.map((it) => it.hit.chunk_id))
    const titlesByDoc = new Map<number, string>()
    for (const it of items) {
      titlesByDoc.set(it.hit.document_id, it.hit.document_title)
    }
    const additions: HitWithOrigin[] = []
    for (const c of neighbours) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      additions.push({
        hit: chunkToSearchHit(c, titlesByDoc.get(c.document_id) ?? '', 0),
        origin: 'neighbour',
      })
    }
    return interleaveByDocument(items, additions)
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (testable, no I/O)
// ---------------------------------------------------------------------------

interface HitWithOrigin {
  hit: SearchHit
  origin: 'primary' | 'neighbour' | 'whole_doc'
}

/**
 * Round-robin diversification by document_id. Preserves in-document score
 * order (the input is assumed already sorted) but interleaves across docs
 * so no single document monopolises top-K.
 *
 * Example with topK=8 and a candidate pool of:
 *   docA: [a1, a2, a3, a4, a5, a6, a7, a8]   (reranker scored every chunk well)
 *   docB: [b1, b2]                            (only 2 chunks)
 *   docC: [c1, c2, c3]
 *
 * Output: [a1, b1, c1, a2, b2, c2, a3, c3]   — every doc represented before
 * any doc gets a second slot. After every doc has been seen, the loop fills
 * the remaining slots score-best-first across remaining chunks.
 *
 * Exported for testability.
 */
export function diversifyByDocument(hits: SearchHit[], topK: number): SearchHit[] {
  if (hits.length <= topK) return hits.slice()
  const byDoc = new Map<number, SearchHit[]>()
  for (const h of hits) {
    const arr = byDoc.get(h.document_id) ?? []
    arr.push(h)
    byDoc.set(h.document_id, arr)
  }
  const out: SearchHit[] = []
  // Pass through docs in their FIRST-appearance order to preserve the
  // overall reranker preference between documents.
  const docOrder = Array.from(byDoc.keys())
  while (out.length < topK) {
    let added = false
    for (const docId of docOrder) {
      const arr = byDoc.get(docId)!
      if (arr.length === 0) continue
      out.push(arr.shift()!)
      added = true
      if (out.length >= topK) break
    }
    if (!added) break
  }
  return out
}

/**
 * Trim a hit list to fit a character budget — used by the chat IPC to keep
 * the retrieval context block well under the model's window.
 *
 * Drops are tiered, in priority of "most expendable first":
 *   1. neighbour-origin hits  (added for surrounding-paragraph context)
 *   2. whole_doc-origin hits  (added by the small-doc fallback)
 *   3. lowest-ranked primary hits
 *
 * The remaining order is preserved so interleaving stays intact.
 */
export function trimToCharBudget(hits: RetrievalHit[], maxChars: number): RetrievalHit[] {
  const total = (h: RetrievalHit[]): number => h.reduce((n, x) => n + x.text.length, 0)
  if (total(hits) <= maxChars) return hits

  // Phase 1 — drop neighbours from the back forward.
  let working = [...hits]
  for (let i = working.length - 1; i >= 0 && total(working) > maxChars; i--) {
    if (working[i]!.origin === 'neighbour') working.splice(i, 1)
  }
  if (total(working) <= maxChars) return working

  // Phase 2 — drop whole_doc additions from the back forward.
  for (let i = working.length - 1; i >= 0 && total(working) > maxChars; i--) {
    if (working[i]!.origin === 'whole_doc') working.splice(i, 1)
  }
  if (total(working) <= maxChars) return working

  // Phase 3 — last resort: drop trailing primary hits. Always keep at least
  // the top-1 so the model has something to ground on.
  while (working.length > 1 && total(working) > maxChars) {
    working.pop()
  }
  return working
}

/**
 * Splice `additions` next to same-document items in `base` so the resulting
 * order interleaves whole-doc / neighbour chunks adjacent to their primary.
 * Stable: preserves the relative order of `base` and the ordinal order of
 * additions inside each document.
 */
function interleaveByDocument(base: HitWithOrigin[], additions: HitWithOrigin[]): HitWithOrigin[] {
  const byDoc = new Map<number, HitWithOrigin[]>()
  for (const a of additions) {
    const arr = byDoc.get(a.hit.document_id) ?? []
    arr.push(a)
    byDoc.set(a.hit.document_id, arr)
  }
  for (const arr of byDoc.values()) {
    arr.sort((x, y) => x.hit.ordinal - y.hit.ordinal)
  }
  const out: HitWithOrigin[] = []
  const inserted = new Set<number>()
  for (const item of base) {
    out.push(item)
    if (inserted.has(item.hit.document_id)) continue
    const docAdds = byDoc.get(item.hit.document_id)
    if (docAdds) {
      for (const a of docAdds) out.push(a)
      inserted.add(item.hit.document_id)
    }
  }
  return out
}

function chunkToSearchHit(c: ChunkRow, title: string, score: number): SearchHit {
  return {
    chunk_id: c.id,
    document_id: c.document_id,
    document_title: title,
    ordinal: c.ordinal,
    page_from: c.page_from,
    page_to: c.page_to,
    heading_path: c.heading_path,
    text: c.text,
    score,
  }
}

function toHit(item: HitWithOrigin): RetrievalHit {
  return {
    chunk_id: item.hit.chunk_id,
    document_id: item.hit.document_id,
    document_title: item.hit.document_title,
    ordinal: item.hit.ordinal,
    page_from: item.hit.page_from,
    page_to: item.hit.page_to,
    heading_path: item.hit.heading_path,
    text: item.hit.text,
    score: item.hit.score,
    origin: item.origin,
  }
}

// Faithful code-retrieval pipeline for the eval. Composes the REAL production
// pure cores so the ablations measure production behaviour, not a re-mock:
//   - fuseRrf                (src/main/services/retrieval/rrf.ts)
//   - applyCodeSymbolBoost / applyCodeFilenameBoost / ensureCodeShare /
//     extractCodeIdentifiers / isCodeHit / nonStopwordTokens (heuristics.ts)
//   - diversifyByDocument    (RetrievalService.ts)
// The only non-production piece is the BM25 stand-in (bm25.ts) for SQLite FTS5.
//
// Each Ablation field toggles exactly one candidate fix from the diagnosis
// (memory project_code_retrieval_nl_noise):
//   queryInstruction  -> fix #1 (handled at embed time by the runner; recorded here)
//   symbolFts         -> fix #4 (index heading_path + camelCase split)
//   codeFilenameBoost -> fix #2 precision (exact[prod] | substring | off)
//   codeShare         -> fix #2 recall    (off | intent[prod] | always[codebase])
//   dynamicK          -> fix #3 (score-gap cutoff instead of fixed K)
//   rerank/codeSymbolBoost mirror production defaults.

import type { SearchHit } from '../../../src/main/db/types'
import { fuseRrf } from '../../../src/main/services/retrieval/rrf'
import {
  applyCodeSymbolBoost,
  applyCodeFilenameBoost,
  applyRoleBoost,
  applyTrackPreference,
  ensureCodeShare,
  extractCodeIdentifiers,
  isCodeHit,
  nonStopwordTokens,
} from '../../../src/main/services/retrieval/heuristics'
import { diversifyByDocument } from '../../../src/main/services/retrieval/RetrievalService'
import { cosineSimilarity } from '../pipeline/Embedder'
import type { Reranker } from '../pipeline/Reranker'
import { Bm25Index, tokenizeFts, tokenizeCode } from './bm25'
import type { CodeChunk } from './types'

// Production defaults (RetrievalService.ts:169-172).
const CODE_SYMBOL_BOOST = 1.8
const CODE_DEFINE_BOOST = 1.4
const CODE_FILENAME_BOOST = 1.3
const CODE_MIN_FRACTION = 0.4
const ROLE_NONSOURCE_PENALTY = 0.5
const ROLE_TEST_BOOST = 1.5
const DOC_PENALTY = 0.5

export interface Ablation {
  name: string
  queryInstruction: boolean
  symbolFts: boolean
  codeSymbolBoost: boolean
  codeFilenameBoost: 'exact' | 'substring' | 'off'
  codeShare: 'off' | 'intent' | 'always'
  dynamicK: boolean
  rerank: boolean
  /** ADR-0006: prefer source over test/eval/example code (role-aware boost) */
  roleBoost: boolean
  /** ADR-0006: prefer code over docs on code-intent queries (track preference) */
  docPenalty: boolean
}

export interface PipelineCtx {
  /** index-aligned with the corpus chunks; chunk_id === array index */
  hits: SearchHit[]
  /** index-aligned corpus embeddings (raw, no query prefix — matches prod passages) */
  vecs: Array<number[] | Float32Array>
  bm25Text: Bm25Index
  bm25Code: Bm25Index
  reranker: Reranker
  candidateK: number
  finalK: number
}

/** Build the index-aligned SearchHit[] + BM25 indexes from a corpus. chunk_id is
 *  the array index; document_id groups chunks by file (so diversifyByDocument and
 *  ensureCodeShare behave exactly as in production). */
export function buildContext(
  chunks: CodeChunk[],
  vecs: Array<number[] | Float32Array>,
  reranker: Reranker,
  opts: { candidateK?: number; finalK?: number } = {},
): Omit<PipelineCtx, 'reranker'> & { reranker: Reranker } {
  const fileId = new Map<string, number>()
  const hits: SearchHit[] = chunks.map((c, i) => {
    if (!fileId.has(c.file)) fileId.set(c.file, fileId.size)
    return {
      chunk_id: i,
      document_id: fileId.get(c.file)!,
      document_title: c.file,
      ordinal: c.ordinal,
      page_from: c.pageFrom,
      page_to: c.pageTo,
      heading_path: c.headingPath,
      text: c.text,
      score: 0,
      language: null,
    }
  })
  // Text-only (prod-faithful) vs text+heading_path with camelCase split (fix #4).
  const bm25Text = new Bm25Index(
    chunks.map((c, i) => ({ id: i, text: c.text })),
    tokenizeFts,
  )
  const bm25Code = new Bm25Index(
    chunks.map((c, i) => ({ id: i, text: `${(c.headingPath ?? []).join(' ')}\n${c.text}` })),
    tokenizeCode,
  )
  return {
    hits,
    vecs,
    bm25Text,
    bm25Code,
    reranker,
    candidateK: opts.candidateK ?? 40,
    finalK: opts.finalK ?? 10,
  }
}

/** Substring/prefix variant of applyCodeFilenameBoost (fix #2). The prod version
 *  requires a query token to EQUAL the file stem; this boosts when a query token
 *  is a substring of the stem (or vice-versa), so "auth" boosts AuthService.ts. */
function applyCodeFilenameBoostSubstring(
  hits: SearchHit[],
  query: string,
  factor: number,
): SearchHit[] {
  const terms = new Set<string>([...nonStopwordTokens(query), ...extractCodeIdentifiers(query)])
  const usable = [...terms].filter((t) => t.length >= 3)
  if (usable.length === 0) return hits
  return hits.map((h) => {
    if (!isCodeHit(h)) return h
    const stem =
      (h.heading_path?.[0] ?? '')
        .toLowerCase()
        .replace(/\.[^.]+$/, '')
        .split('/')
        .pop() ?? ''
    if (!stem) return h
    const hit = usable.some((t) => stem.includes(t) || t.includes(stem))
    return hit ? { ...h, score: h.score * factor } : h
  })
}

/** Score-gap dynamic-K (fix #3): keep adding hits while the sigmoid-normalised
 *  score doesn't fall below `tau` of the previous; clamp to [minK, maxK]. Runs on
 *  the SORTED pool (monotonic) so the cut is well-defined before diversification. */
function dynamicCutCount(sorted: SearchHit[], minK: number, maxK: number, tau = 0.6): number {
  const n = Math.min(maxK, sorted.length)
  if (n <= minK) return n
  const norm = (s: number): number => 1 / (1 + Math.exp(-s))
  let k = minK
  for (let i = minK; i < n; i++) {
    const prev = norm(sorted[i - 1]!.score)
    const cur = norm(sorted[i]!.score)
    if (prev > 0 && cur < prev * tau) break
    k = i + 1
  }
  return Math.max(minK, Math.min(k, n))
}

/** Run one query through the ablation-configured pipeline. Returns the ordered
 *  chunk_ids (corpus indices) the user/LLM would see, best first. */
export async function runQuery(
  query: string,
  qVec: number[] | Float32Array,
  abl: Ablation,
  ctx: PipelineCtx,
): Promise<number[]> {
  // --- lexical + dense candidate lists ---
  const bm25 = (abl.symbolFts ? ctx.bm25Code : ctx.bm25Text).search(query, ctx.candidateK)
  const bm25Hits = bm25.map(({ id, score }) => ({ ...ctx.hits[id]!, score }))
  const denseHits = ctx.vecs
    .map((v, i) => ({ i, s: cosineSimilarity(qVec, v) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, ctx.candidateK)
    .map(({ i, s }) => ({ ...ctx.hits[i]!, score: s }))

  // --- RRF fuse (prod order: seed bm25, then dense) ---
  let pool = fuseRrf([], bm25Hits, ctx.candidateK)
  pool = fuseRrf(pool, denseHits, ctx.candidateK)

  // --- optional cross-encoder rerank over the whole pool ---
  if (abl.rerank && pool.length > 0) {
    const ranked = await ctx.reranker.rerank(
      query,
      pool.map((h) => ({ text: h.text, initialScore: h.score })),
    )
    pool = ranked.map((r) => ({ ...pool[r.initialIndex]!, score: r.score }))
  }

  // --- code-aware boosts (prod applies these on whatever score we rank on) ---
  if (abl.codeSymbolBoost) {
    pool = applyCodeSymbolBoost(pool, query, CODE_SYMBOL_BOOST, CODE_DEFINE_BOOST)
  }
  if (abl.codeFilenameBoost === 'exact') {
    pool = applyCodeFilenameBoost(pool, query, CODE_FILENAME_BOOST)
  } else if (abl.codeFilenameBoost === 'substring') {
    pool = applyCodeFilenameBoostSubstring(pool, query, CODE_FILENAME_BOOST)
  }
  if (abl.roleBoost) {
    pool = applyRoleBoost(pool, query, {
      nonSourcePenalty: ROLE_NONSOURCE_PENALTY,
      testBoost: ROLE_TEST_BOOST,
    })
  }
  if (abl.docPenalty) {
    pool = applyTrackPreference(pool, query, { docPenalty: DOC_PENALTY })
  }
  const sorted = pool.slice().sort((a, b) => b.score - a.score)

  // --- selection horizon (dynamic-K or fixed finalK) ---
  const k = abl.dynamicK ? dynamicCutCount(sorted, 2, ctx.finalK) : ctx.finalK

  // --- document diversification + code-share guarantee ---
  let selected = diversifyByDocument(sorted, k)
  const fireShare =
    abl.codeShare === 'always' ||
    (abl.codeShare === 'intent' && extractCodeIdentifiers(query).length > 0)
  if (fireShare) {
    selected = ensureCodeShare(selected, sorted, k, Math.max(1, Math.ceil(k * CODE_MIN_FRACTION)))
  }
  return selected.map((h) => h.chunk_id)
}

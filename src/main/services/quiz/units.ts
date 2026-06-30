// Context-aware quiz units, built in code from the chunks already stored in
// the DB — no LLM involved. A unit is a run of consecutive chunks that stays
// inside one top-level section and inside a token budget; each unit later
// becomes exactly one question-generation call. Both the unit size and the
// per-unit question target scale with the DOCUMENT's total size (see
// unitMaxTokens here and targetQuestionCount in prompts.ts): a short note gets
// fine-grained, dense coverage, while a whole book uses larger units (fewer LLM
// calls) and a thinner question density (a usable, not gigantic, deck).
// See docs/superpowers/specs/2026-06-11-quiz-chunk-generation-design.md.

import type { ChunkRow } from '../../db/types'
import { estimateTokens } from '../llm/prompt'

/** Unit size for a SHORT document — roughly one paragraph, so coverage is
 *  fine-grained (most units end up one chunk, since chunks are ~500 tokens). */
export const UNIT_TOKENS_MIN = 600
/** Unit size ceiling for a LARGE document — bigger units mean fewer units, and
 *  since each unit is one LLM call, this is what keeps generation time bounded
 *  on slow (e.g. iGPU) hardware. */
export const UNIT_TOKENS_MAX = 1600
/** Unit budget grows by one token per this many tokens of document, ramping
 *  from UNIT_TOKENS_MIN up to UNIT_TOKENS_MAX. */
const UNIT_GROWTH_TOKENS = 60
/** Units below this are merged into a neighbour — too thin to ask anything.
 *  Constant (not size-scaled): a starving fragment is starving at any doc size. */
export const UNIT_MIN_TOKENS = 120

/** Per-unit token budget for a document of `docTokens` total tokens: small docs
 *  get paragraph-sized units; large docs get proportionally bigger ones, capped
 *  at UNIT_TOKENS_MAX so the LLM-call count can't run away. */
export function unitMaxTokens(docTokens: number): number {
  const budget = UNIT_TOKENS_MIN + Math.max(0, docTokens) / UNIT_GROWTH_TOKENS
  return Math.round(Math.min(UNIT_TOKENS_MAX, budget))
}

export interface QuizUnitDoc {
  docId: number
  docTitle: string
  chunks: ChunkRow[]
}

export interface QuizUnit {
  docId: number
  docTitle: string
  /** Consecutive chunks composing this unit, ordinal order. */
  chunks: ChunkRow[]
  tokens: number
  /** Total tokens of the document this unit came from — drives the size-scaled
   *  question target (targetQuestionCount) at generation time. */
  docTokens: number
  /** Section heading (or doc title fallback) — stored as themeTitle. */
  title: string
}

// estimateTokens is only a fallback for chunks whose token_count is missing.
function chunkTokens(c: ChunkRow): number {
  return c.token_count ?? estimateTokens(c.text)
}

/** Build units for all documents. Units never span documents. */
export function buildUnits(docs: QuizUnitDoc[]): QuizUnit[] {
  const out: QuizUnit[] = []
  for (const d of docs) out.push(...buildUnitsForDoc(d))
  return out
}

interface Pack {
  chunks: ChunkRow[]
  tokens: number
}

function buildUnitsForDoc(d: QuizUnitDoc): QuizUnit[] {
  const chunks = d.chunks
    .filter((c) => c.text.trim().length > 0)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
  if (chunks.length === 0) return []

  // Unit size is derived from the WHOLE document's token count, so a big book
  // packs into larger units (fewer LLM calls) than a short note.
  const docTokens = chunks.reduce((sum, c) => sum + chunkTokens(c), 0)
  const maxTokens = unitMaxTokens(docTokens)

  // Pack consecutive chunks; a new unit starts on a top-level section change
  // or when the token budget would overflow. A null heading never forces a
  // boundary — PDFs without an outline pack by size alone.
  const packs: Pack[] = []
  let cur: ChunkRow[] = []
  let curTokens = 0
  let curSection: string | null = null
  for (const c of chunks) {
    const t = chunkTokens(c)
    const section = c.heading_path?.[0] ?? null
    const sectionChanged = section !== null && curSection !== null && section !== curSection
    if (cur.length > 0 && (sectionChanged || curTokens + t > maxTokens)) {
      packs.push({ chunks: cur, tokens: curTokens })
      cur = []
      curTokens = 0
    }
    cur.push(c)
    curTokens += t
    if (section !== null) curSection = section
  }
  if (cur.length > 0) packs.push({ chunks: cur, tokens: curTokens })

  return absorbSmall(packs).map((p) => toUnit(p, d, docTokens))
}

/** Merge under-sized packs into a neighbour (previous when possible, else
 *  next) so no question gets a starving context. May push a unit slightly
 *  past the unit budget — acceptable, bounded by UNIT_MIN_TOKENS. */
function absorbSmall(packs: Pack[]): Pack[] {
  const out = packs.slice()
  let i = 0
  while (out.length > 1 && i < out.length) {
    if (out[i]!.tokens >= UNIT_MIN_TOKENS) {
      i += 1
      continue
    }
    if (i > 0) {
      out[i - 1] = mergePacks(out[i - 1]!, out[i]!)
      out.splice(i, 1)
      i -= 1 // the merged pack may still be small — re-check it
    } else {
      out[0] = mergePacks(out[0]!, out[1]!)
      out.splice(1, 1)
    }
  }
  return out
}

function mergePacks(a: Pack, b: Pack): Pack {
  return { chunks: [...a.chunks, ...b.chunks], tokens: a.tokens + b.tokens }
}

function toUnit(p: Pack, d: QuizUnitDoc, docTokens: number): QuizUnit {
  // Title from the largest chunk's heading — after absorption the first chunk
  // can be a tiny merged-in leftover (cover page, preamble) whose heading
  // would misrepresent the unit.
  let largest = p.chunks[0]!
  for (const c of p.chunks) {
    if (chunkTokens(c) > chunkTokens(largest)) largest = c
  }
  const heading = largest.heading_path
  const title =
    heading && heading.length > 0 ? (heading[heading.length - 1] ?? d.docTitle) : d.docTitle
  return {
    docId: d.docId,
    docTitle: d.docTitle,
    chunks: p.chunks,
    tokens: p.tokens,
    docTokens,
    title,
  }
}

/** Full plan: every unit, in document order. No cap and no sampling — the
 *  deck covers all the material, and the per-unit question count is the
 *  model's call. Pure + cheap — also used for the create-dialog preview. */
export function planQuiz(docs: QuizUnitDoc[]): { units: QuizUnit[] } {
  return { units: buildUnits(docs) }
}

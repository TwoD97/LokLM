// Context-aware quiz units, built in code from the chunks already stored in
// the DB — no LLM involved. A unit is a run of consecutive chunks that stays
// inside one top-level section and inside a token budget; each unit later
// becomes exactly one question-generation call. See
// docs/superpowers/specs/2026-06-11-quiz-chunk-generation-design.md.

import type { ChunkRow } from '../../db/database'
import { estimateTokens } from '../llm/prompt'

/** Hard size cap per unit — keeps every generation prompt small and cheap. */
export const UNIT_MAX_TOKENS = 1800
/** Units below this are merged into a neighbour — too thin to ask anything. */
export const UNIT_MIN_TOKENS = 250
/** Units at/above this carry 2 questions; smaller ones carry 1. */
export const TWO_QUESTION_THRESHOLD = 900
/** Deck ceilings: bound worst-case generation time on big documents. */
export const MAX_QUESTIONS = 30
export const MAX_QUESTIONS_CPU = 10

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
  /** Questions to ask for this unit — sized by token count. */
  quota: 1 | 2
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
    if (cur.length > 0 && (sectionChanged || curTokens + t > UNIT_MAX_TOKENS)) {
      packs.push({ chunks: cur, tokens: curTokens })
      cur = []
      curTokens = 0
    }
    cur.push(c)
    curTokens += t
    if (section !== null) curSection = section
  }
  if (cur.length > 0) packs.push({ chunks: cur, tokens: curTokens })

  return absorbSmall(packs).map((p) => toUnit(p, d))
}

/** Merge under-sized packs into a neighbour (previous when possible, else
 *  next) so no question gets a starving context. May push a unit slightly
 *  past UNIT_MAX_TOKENS — acceptable, bounded by UNIT_MIN_TOKENS. */
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

function toUnit(p: Pack, d: QuizUnitDoc): QuizUnit {
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
    quota: p.tokens >= TWO_QUESTION_THRESHOLD ? 2 : 1,
    title,
  }
}

/** Enforce the deck cap. Under the cap: all units, untouched. Over it: split
 *  the unit list into k = min(n, cap) stride windows and keep the most
 *  token-dense unit of each window — deterministic, even coverage across the
 *  material (this structural spread is what replaces semantic dedup). If the
 *  picks' quotas still exceed the cap, demote quota-2 picks to 1 in ascending
 *  token order until they fit. */
export function selectUnits(units: QuizUnit[], cap: number): QuizUnit[] {
  const total = units.reduce((s, u) => s + u.quota, 0)
  if (total <= cap) return units

  const k = Math.min(units.length, cap)
  const picks: QuizUnit[] = []
  for (let i = 0; i < k; i += 1) {
    const start = Math.floor((i * units.length) / k)
    const end = Math.floor(((i + 1) * units.length) / k)
    let best = units[start]!
    for (let j = start + 1; j < end; j += 1) {
      if (units[j]!.tokens > best.tokens) best = units[j]!
    }
    picks.push(best)
  }

  let sum = picks.reduce((s, u) => s + u.quota, 0)
  if (sum <= cap) return picks
  const result = picks.map((u) => ({ ...u }))
  const demotable = result.filter((u) => u.quota === 2).sort((a, b) => a.tokens - b.tokens)
  for (const u of demotable) {
    if (sum <= cap) break
    u.quota = 1
    sum -= 1
  }
  return result
}

/** Full plan: build units from chunk stats, apply the cap, derive the deck's
 *  question count. Pure + cheap — also used for the create-dialog estimate. */
export function planQuiz(
  docs: QuizUnitDoc[],
  cap: number,
): { units: QuizUnit[]; questionCount: number } {
  const units = selectUnits(buildUnits(docs), cap)
  return { units, questionCount: units.reduce((s, u) => s + u.quota, 0) }
}

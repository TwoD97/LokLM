// Per-unit MCQ generation: ONE grammar-constrained call per quiz unit, with
// all quality enforcement in code (validation + normalized dedup). There is
// deliberately no retry and no embedding involvement — see
// docs/superpowers/specs/2026-06-11-quiz-chunk-generation-design.md.

import type { LlmProvider } from '../providers/types'
import type { QuizLanguage } from '../../../shared/quiz'
import type { AcceptedQuestion } from './types'
import type { QuizUnit } from './units'
import {
  buildUnitQuestionPrompt,
  QUESTION_LIST_SCHEMA,
  PER_QUESTION_TOKEN_BUDGET,
  PER_UNIT_MAX_QUESTIONS,
} from './prompts'
import { extractJsonObjects } from './jsonSalvage'

/** Slack on top of the per-question budgets so the array close bracket and
 *  whitespace never get clipped by maxTokens. */
const MAX_TOKENS_HEADROOM = 64

export interface GenerateQuestionsForUnitInput {
  language: QuizLanguage
  unit: QuizUnit
  /** Stems already accepted across the deck — duplicates (normalized exact
   *  match) are dropped. */
  acceptedStems: string[]
  abortSignal?: AbortSignal
}

/** Produce the questions for one unit in ONE call. The MODEL decides how many
 *  the material needs (coverage brief in the prompt), bounded only by the
 *  PER_UNIT_MAX_QUESTIONS anti-runaway ceiling. maxTokens covers the ceiling,
 *  but the grammar lets the model close the array early, so a one-idea unit
 *  costs one question's worth of decode, not eight. Bad or partially bad
 *  output yields whatever valid subset parsed (possibly empty). */
export async function generateQuestionsForUnit(
  llm: LlmProvider,
  input: GenerateQuestionsForUnitInput,
): Promise<Array<Omit<AcceptedQuestion, 'ordinal'>>> {
  const { unit, language, acceptedStems, abortSignal } = input
  if (unit.chunks.length === 0) return []

  // Full chunk text — units are budget-bounded at build time, so no slicing.
  const groundingBlock = unit.chunks
    .map((c) => `[chunk:${c.id}] ${c.text.replace(/\s+/g, ' ').trim()}`)
    .join('\n')
  const allowedChunkIds = new Set(unit.chunks.map((c) => c.id))

  const prompt = buildUnitQuestionPrompt({
    language,
    docTitle: unit.docTitle,
    unitTitle: unit.title,
    groundingBlock,
  })

  const raw = await llm.generateRaw(prompt, {
    jsonSchema: QUESTION_LIST_SCHEMA,
    maxTokens: PER_UNIT_MAX_QUESTIONS * PER_QUESTION_TOKEN_BUDGET + MAX_TOKENS_HEADROOM,
    noThink: true,
    ...(abortSignal ? { abortSignal } : {}),
  })
  const parsed = parseAndValidateArray(raw, allowedChunkIds)
  if (parsed.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[quiz] no valid questions for unit "${unit.title}"; raw: ${snippet(raw)}`)
    return []
  }

  // Stem dedup against the deck and within the batch — normalized exact
  // match, pure code. Cross-unit duplicates are already structurally unlikely
  // because every unit is distinct material.
  const seen = new Set(acceptedStems.map(normalizeForCompare))
  const out: Array<Omit<AcceptedQuestion, 'ordinal'>> = []
  for (const q of parsed) {
    if (out.length >= PER_UNIT_MAX_QUESTIONS) break
    const key = normalizeForCompare(q.stem)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      stem: q.stem,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      sourceChunkIds: q.sourceChunkIds,
      themeTitle: unit.title,
    })
  }
  return out
}

interface RawQuestion {
  stem: string
  options: string[]
  correctIndex: number
  explanation: string
  sourceChunkIds: number[]
}

/** Parse an ARRAY of MCQ objects and validate each item, dropping invalid ones.
 *  Tolerates leading/trailing prose, code fences, AND truncation: instead of
 *  one JSON.parse over the whole `[...]` slice (which throws — losing every
 *  question — when a slow model is cut off mid-array), we extract each top-level
 *  object by brace-matching and parse them independently. We stop at the first
 *  object that fails to parse (the truncated tail) but keep everything before
 *  it, so a response cut off after 3 complete questions still yields 3. */
export function parseAndValidateArray(raw: string, allowedChunkIds: Set<number>): RawQuestion[] {
  const cleaned = stripCodeFences(raw)
  const out: RawQuestion[] = []
  const rejections: string[] = []
  for (const objText of extractJsonObjects(cleaned)) {
    let item: unknown
    try {
      item = JSON.parse(objText)
    } catch {
      break // truncated tail — keep the valid prefix
    }
    const q = validateQuestion(item, allowedChunkIds, (reason) => {
      if (rejections.length < 5) rejections.push(reason)
    })
    if (q) out.push(q)
  }
  if (out.length === 0 && rejections.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[quiz] validateQuestion rejected all items: ${rejections.join(' | ')}`)
  }
  return out
}

/** Pull a single JSON object out of the LLM response and validate it. Returns
 *  null on any failure. Kept for the unit tests that exercise validation rules
 *  directly. */
export function parseAndValidate(raw: string, allowedChunkIds: Set<number>): RawQuestion | null {
  const cleaned = stripCodeFences(raw)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
  return validateQuestion(parsed, allowedChunkIds)
}

/** Canonical form for cheap textual duplicate checks: lowercase, punctuation
 *  stripped, whitespace collapsed. The code-side replacement for the old
 *  embedding-based stem dedup — exact-match on this form catches the case/
 *  punctuation rewordings a model actually produces, at zero model cost. */
export function normalizeForCompare(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Lazy correct answers a grounded MCQ must never have. Checked against the
 *  normalized correct option via startsWith so suffixes ("… are correct",
 *  "… Antworten") still match. EN + DE checked regardless of deck language. */
const LAZY_CORRECT_PATTERNS = [
  'all of the above',
  'none of the above',
  'all the above',
  'alle der oben genannten',
  'keine der oben genannten',
  'alle oben genannten',
  'alle genannten',
  'keine der genannten',
]

function isLazyCorrectOption(option: string): boolean {
  const norm = normalizeForCompare(option)
  return LAZY_CORRECT_PATTERNS.some((p) => norm.startsWith(p))
}

/** Validate one parsed MCQ object:
 *   - stem non-empty string
 *   - options: array of exactly 4 non-empty strings, distinct after
 *     normalization (case/punctuation rewordings count as duplicates)
 *   - correct_index ∈ [0, 3], and the correct option is a real answer, not an
 *     all/none-of-the-above cop-out
 *   - explanation non-empty
 *   - source_chunk_ids: integers drawn from allowedChunkIds, with a fallback to
 *     the first allowed id when none overlap
 *
 *  Returns null on any failure. */
function validateQuestion(
  parsed: unknown,
  allowedChunkIds: Set<number>,
  onReject?: (reason: string) => void,
): RawQuestion | null {
  const reject = (reason: string): null => {
    onReject?.(reason)
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return reject('not-object')
  const o = parsed as Record<string, unknown>
  const stem = typeof o.stem === 'string' ? o.stem.trim() : ''
  if (!stem) return reject('empty-stem')
  if (!Array.isArray(o.options)) return reject('options-not-array')
  if (o.options.length !== 4) return reject(`options-length=${o.options.length}`)
  const opts = o.options.map((x) => (typeof x === 'string' ? x.trim() : ''))
  if (opts.some((s) => s.length === 0)) return reject('empty-option')
  const normalized = new Set(opts.map(normalizeForCompare))
  if (normalized.size !== 4) return reject(`options-not-distinct=${normalized.size}`)
  const correctIndex = typeof o.correct_index === 'number' ? o.correct_index : NaN
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    return reject(`correct_index=${JSON.stringify(o.correct_index)}`)
  }
  if (isLazyCorrectOption(opts[correctIndex]!)) return reject('lazy-correct-option')
  const explanation =
    typeof o.explanation === 'string' && o.explanation.trim().length > 0 ? o.explanation.trim() : ''
  if (!explanation) return reject('empty-explanation')
  const rawIds = Array.isArray(o.source_chunk_ids) ? o.source_chunk_ids : []
  const ids: number[] = []
  for (const v of rawIds) {
    if (typeof v !== 'number' || !Number.isInteger(v)) continue
    if (!allowedChunkIds.has(v)) continue
    ids.push(v)
  }
  if (ids.length === 0) {
    // Fall back to the first allowed chunk so a forgetful model doesn't kill an
    // otherwise-valid question. We still record the citation so the chip can do
    // something useful.
    const first = allowedChunkIds.values().next().value
    if (typeof first !== 'number') return reject('no-fallback-chunk')
    ids.push(first)
  }
  return { stem, options: opts, correctIndex, explanation, sourceChunkIds: ids }
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^[^[{]*```(?:json)?\s*/i, '')
    .replace(/```[^`]*$/i, '')
    .trim()
}

/** First ~1000 chars of raw model output for actionable logs (one line). Long
 *  enough to capture a full short question (stem + 4 options + explanation +
 *  citation ids) so post-mortem reads aren't truncated mid-shape. */
function snippet(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  return oneLine.length > 1000 ? `${oneLine.slice(0, 1000)}…` : oneLine || '(empty)'
}

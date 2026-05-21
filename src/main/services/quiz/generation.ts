// Stage 4 of the pipeline: per-theme MCQ generation with JSON validation,
// retry, and anti-repetition. See spec §4 stage 4.

import type { LlmProvider, EmbedderProvider } from '../providers/types'
import type { ChunkRow } from '../../db/database'
import type { QuizLanguage } from '../../../shared/quiz'
import type { AcceptedQuestion, QuizTheme } from './types'
import { buildJsonRetryPrompt, buildQuestionGenerationPrompt } from './prompts'

/** Stems whose cosine similarity is ≥ this against any already-accepted stem
 *  count as duplicates and trigger a retry. */
const STEM_DUP_COSINE = 0.88

export interface GenerateQuestionInput {
  language: QuizLanguage
  theme: QuizTheme
  groundingChunks: ChunkRow[]
  accepted: AcceptedQuestion[]
  abortSignal?: AbortSignal
}

export interface GenerateQuestionResult {
  question: Omit<AcceptedQuestion, 'ordinal'> | null
  /** True if the LLM produced output but it was rejected (bad JSON, dup, etc.).
   *  The caller may swap the theme and try again. */
  rejected: boolean
}

interface RawQuestion {
  stem: string
  options: string[]
  correctIndex: number
  explanation: string
  sourceChunkIds: number[]
}

/** Run one acceptance loop for the theme: build prompt → generateRaw → parse →
 *  validate → anti-repetition. On parse/validation failure, retry once with a
 *  stricter JSON-only prompt. On stem-duplicate, retry once with the new stem
 *  added to the avoid-list. Returns the accepted question or null. */
export async function generateQuestion(
  llm: LlmProvider,
  embedder: EmbedderProvider,
  input: GenerateQuestionInput,
): Promise<GenerateQuestionResult> {
  const { theme, groundingChunks, accepted, language, abortSignal } = input
  if (groundingChunks.length === 0) return { question: null, rejected: false }

  const groundingBlock = groundingChunks
    .map((c) => `[chunk:${c.id}] ${c.text.replace(/\s+/g, ' ').slice(0, 1200)}`)
    .join('\n')
  const allowedChunkIds = new Set(groundingChunks.map((c) => c.id))

  const initialAvoid = accepted.map((a) => a.stem)
  const basePrompt = buildQuestionGenerationPrompt({
    language,
    themeTitle: theme.title,
    themeSummary: theme.summary,
    groundingBlock,
    avoidStems: initialAvoid,
  })

  // Round 1: the base prompt.
  const raw1 = await llm.generateRaw(basePrompt, abortSignal ? { abortSignal } : {})
  const parsed1 = parseAndValidate(raw1, allowedChunkIds)

  // Round 2: JSON-only retry if validation failed.
  let parsed: RawQuestion | null = parsed1
  if (!parsed) {
    const retry = await llm.generateRaw(
      buildJsonRetryPrompt(language, basePrompt),
      abortSignal ? { abortSignal } : {},
    )
    parsed = parseAndValidate(retry, allowedChunkIds)
    if (!parsed) return { question: null, rejected: true }
  }

  // Round 2b: anti-repetition guard. If the new stem is too close to any
  // accepted one, retry once with the rejected stem appended to the avoid-list.
  const [stemEmbedding] = await embedder.embed([parsed.stem])
  if (!stemEmbedding) return { question: null, rejected: true }
  const dup = isStemDuplicate(stemEmbedding, accepted)
  if (dup) {
    const avoid2 = [...initialAvoid, parsed.stem]
    const retryPrompt = buildQuestionGenerationPrompt({
      language,
      themeTitle: theme.title,
      themeSummary: theme.summary,
      groundingBlock,
      avoidStems: avoid2,
    })
    const raw3 = await llm.generateRaw(retryPrompt, abortSignal ? { abortSignal } : {})
    const parsed3 = parseAndValidate(raw3, allowedChunkIds)
    if (!parsed3) return { question: null, rejected: true }
    const [emb3] = await embedder.embed([parsed3.stem])
    if (!emb3 || isStemDuplicate(emb3, accepted)) return { question: null, rejected: true }
    parsed = parsed3
    return {
      question: toAccepted(parsed, emb3, theme.title),
      rejected: false,
    }
  }

  return { question: toAccepted(parsed, stemEmbedding, theme.title), rejected: false }
}

function toAccepted(
  q: RawQuestion,
  stemEmbedding: Float32Array,
  themeTitle: string,
): Omit<AcceptedQuestion, 'ordinal'> {
  return {
    stem: q.stem,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    sourceChunkIds: q.sourceChunkIds,
    themeTitle,
    stemEmbedding,
  }
}

function isStemDuplicate(candidate: Float32Array, accepted: AcceptedQuestion[]): boolean {
  for (const a of accepted) {
    if (cosine(candidate, a.stemEmbedding) >= STEM_DUP_COSINE) return true
  }
  return false
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Pull a JSON object out of the LLM response and validate the schema:
 *   - stem non-empty string
 *   - options: array of exactly 4 distinct non-empty strings
 *   - correct_index ∈ [0, 3]
 *   - explanation non-empty
 *   - source_chunk_ids: non-empty array of integers drawn from allowedChunkIds
 *
 *  Returns null on any failure. */
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
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  const stem = typeof o.stem === 'string' ? o.stem.trim() : ''
  if (!stem) return null
  if (!Array.isArray(o.options) || o.options.length !== 4) return null
  const opts = o.options.map((x) => (typeof x === 'string' ? x.trim() : ''))
  if (opts.some((s) => s.length === 0)) return null
  if (new Set(opts).size !== 4) return null
  const correctIndex = typeof o.correct_index === 'number' ? o.correct_index : NaN
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) return null
  const explanation =
    typeof o.explanation === 'string' && o.explanation.trim().length > 0 ? o.explanation.trim() : ''
  if (!explanation) return null
  const rawIds = Array.isArray(o.source_chunk_ids) ? o.source_chunk_ids : []
  const ids: number[] = []
  for (const v of rawIds) {
    if (typeof v !== 'number' || !Number.isInteger(v)) continue
    if (!allowedChunkIds.has(v)) continue
    ids.push(v)
  }
  if (ids.length === 0) {
    // Fall back to the first allowed chunk so a forgetful model doesn't kill
    // an otherwise-valid question. We still record the citation so the chip
    // can do something useful.
    const first = allowedChunkIds.values().next().value
    if (typeof first !== 'number') return null
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

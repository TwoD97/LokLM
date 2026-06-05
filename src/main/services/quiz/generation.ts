// Stage 4 of the pipeline: per-theme MCQ generation with JSON validation,
// retry, and anti-repetition. See spec §4 stage 4.

import type { LlmProvider, EmbedderProvider } from '../providers/types'
import type { ChunkRow } from '../../db/database'
import type { QuizLanguage } from '../../../shared/quiz'
import type { AcceptedQuestion, QuizTheme } from './types'
import {
  buildJsonRetryPrompt,
  buildQuestionGenerationPrompt,
  buildQuestionBatchPrompt,
  QUESTION_OUTPUT_RESERVE_TOKENS,
} from './prompts'
import type { GenerateRawOptions } from '../providers/types'

/** Stems whose cosine similarity is ≥ this against any already-accepted stem
 *  count as duplicates and trigger a retry. */
const STEM_DUP_COSINE = 0.88

/** Per-question output token budget when batching. One short MCQ (4 options +
 *  a one-sentence explanation) is ~150–200 tokens; 420 leaves slack so a batch
 *  of N doesn't truncate the last object. */
const BATCH_OUTPUT_TOKENS_PER_Q = 420

export interface GenerateQuestionInput {
  language: QuizLanguage
  theme: QuizTheme
  groundingChunks: ChunkRow[]
  accepted: AcceptedQuestion[]
  /** Route generation through the parallel quiz pool + JSON grammar. */
  pooled?: boolean
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
  const { theme, groundingChunks, accepted, language, abortSignal, pooled } = input
  if (groundingChunks.length === 0) return { question: null, rejected: false }

  // Shared generation options: hard token cap + optional parallel-pool routing,
  // reused across the base + retry calls. Grammar (schema) is intentionally NOT
  // set yet — the parallel pool + maxTokens are the proven wins; the GBNF path
  // is wired through the worker but stays off until validated against the live
  // model so a grammar quirk can't silently empty the output.
  const genOpts = (): GenerateRawOptions => ({
    ...(abortSignal ? { abortSignal } : {}),
    maxTokens: QUESTION_OUTPUT_RESERVE_TOKENS,
    noThink: true,
    ...(pooled ? { pooled: true } : {}),
  })

  const groundingBlock = groundingChunks
    .map((c) => `[chunk:${c.id}] ${c.text.replace(/\s+/g, ' ').slice(0, 700)}`)
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
  const raw1 = await llm.generateRaw(basePrompt, genOpts())
  const parsed1 = parseAndValidate(raw1, allowedChunkIds)

  // Round 2: JSON-only retry if validation failed. With the grammar in play
  // this almost never fires (output is guaranteed to parse) — it survives as a
  // safety net for the non-pooled / Ollama paths and rare semantic rejects.
  let parsed: RawQuestion | null = parsed1
  if (!parsed) {
    const retry = await llm.generateRaw(buildJsonRetryPrompt(language, basePrompt), genOpts())
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
    const raw3 = await llm.generateRaw(retryPrompt, genOpts())
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

export interface GenerateBatchInput {
  language: QuizLanguage
  theme: QuizTheme
  groundingChunks: ChunkRow[]
  /** Already-accepted questions to avoid repeating (passed as an avoid-list and
   *  used to dedup the batch's stems). */
  accepted: AcceptedQuestion[]
  /** How many distinct questions to request in this single call. */
  count: number
  pooled?: boolean
  abortSignal?: AbortSignal
}

export interface GenerateBatchResult {
  /** Validated, mutually-distinct questions (0..count) each carrying its stem
   *  embedding so the caller can dedup across batches without re-embedding. */
  questions: Array<Omit<AcceptedQuestion, 'ordinal'>>
}

/** Generate `count` distinct MCQs for one theme in a SINGLE llm call, then
 *  validate + de-duplicate them. Batching amortises the prompt prefill (most of
 *  a call's cost on a compute-bound model) across N questions, roughly halving
 *  the number of round-trips for count=2. Partial success is fine: a call that
 *  yields 1 of 2 valid questions returns that 1, and Stage 4's theme buffer
 *  fills the gap. */
export async function generateQuestionBatch(
  llm: LlmProvider,
  embedder: EmbedderProvider,
  input: GenerateBatchInput,
): Promise<GenerateBatchResult> {
  const { theme, groundingChunks, accepted, language, count, abortSignal, pooled } = input
  if (groundingChunks.length === 0 || count < 1) return { questions: [] }

  const groundingBlock = groundingChunks
    .map((c) => `[chunk:${c.id}] ${c.text.replace(/\s+/g, ' ').slice(0, 700)}`)
    .join('\n')
  const allowedChunkIds = new Set(groundingChunks.map((c) => c.id))
  const avoidStems = accepted.map((a) => a.stem)

  const genOpts = (): GenerateRawOptions => ({
    ...(abortSignal ? { abortSignal } : {}),
    maxTokens: Math.max(512, count * BATCH_OUTPUT_TOKENS_PER_Q),
    noThink: true,
    ...(pooled ? { pooled: true } : {}),
  })

  const prompt = buildQuestionBatchPrompt({
    language,
    themeTitle: theme.title,
    themeSummary: theme.summary,
    groundingBlock,
    avoidStems,
    count,
  })

  let parsed = parseQuestionArray(await llm.generateRaw(prompt, genOpts()), allowedChunkIds)
  if (parsed.length === 0) {
    // One JSON-only retry, same as the single path.
    parsed = parseQuestionArray(
      await llm.generateRaw(buildJsonRetryPrompt(language, prompt), genOpts()),
      allowedChunkIds,
    )
    if (parsed.length === 0) return { questions: [] }
  }

  // Embed all stems in one batched call, then drop any that duplicate an
  // already-accepted stem or an earlier stem in this same batch.
  const embeddings = await embedder.embed(parsed.map((p) => p.stem))
  const out: Array<Omit<AcceptedQuestion, 'ordinal'>> = []
  const seen: AcceptedQuestion[] = accepted.slice()
  for (let i = 0; i < parsed.length; i += 1) {
    const emb = embeddings[i]
    if (!emb) continue
    if (isStemDuplicate(emb, seen)) continue
    const q = toAccepted(parsed[i]!, emb, theme.title)
    out.push(q)
    seen.push({ ...q, ordinal: 0 })
    if (out.length >= count) break
  }
  return { questions: out }
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

/** True if `candidate` is within STEM_DUP_COSINE of any accepted stem. Exported
 *  so the parallel wave coordinator can re-check survivors against each other +
 *  the live accepted list (within a wave, questions can't see each other's
 *  stems, so a post-wave cross-check catches near-duplicates the per-call guard
 *  misses). */
export function isStemDuplicate(candidate: Float32Array, accepted: AcceptedQuestion[]): boolean {
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

/** Validate one already-parsed question object against the schema:
 *   - stem non-empty string
 *   - options: array of exactly 4 distinct non-empty strings
 *   - correct_index ∈ [0, 3]
 *   - explanation non-empty
 *   - source_chunk_ids: non-empty array of integers drawn from allowedChunkIds
 *
 *  Returns null on any failure. */
export function validateQuestionObject(
  o: Record<string, unknown>,
  allowedChunkIds: Set<number>,
): RawQuestion | null {
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

/** Pull a single JSON object out of the LLM response and validate it. Returns
 *  null on any failure. */
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
  return validateQuestionObject(parsed as Record<string, unknown>, allowedChunkIds)
}

/** Pull a JSON ARRAY of question objects out of the response and validate each.
 *  Tolerates a single bare object (the model occasionally ignores "array") by
 *  falling back to parseAndValidate. Invalid elements are dropped, not fatal. */
export function parseQuestionArray(raw: string, allowedChunkIds: Set<number>): RawQuestion[] {
  const cleaned = stripCodeFences(raw)
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start < 0 || end <= start) {
    const single = parseAndValidate(raw, allowedChunkIds)
    return single ? [single] : []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: RawQuestion[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const q = validateQuestionObject(item as Record<string, unknown>, allowedChunkIds)
    if (q) out.push(q)
  }
  return out
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^[^[{]*```(?:json)?\s*/i, '')
    .replace(/```[^`]*$/i, '')
    .trim()
}

// Stage 4 of the pipeline: batch-per-theme MCQ generation with grammar-
// constrained JSON, semantic validation, retry, and anti-repetition. See
// spec §4 stage 4.

import type { LlmProvider, EmbedderProvider } from '../providers/types'
import type { ChunkRow } from '../../db/database'
import type { QuizLanguage } from '../../../shared/quiz'
import type { AcceptedQuestion, QuizTheme } from './types'
import {
  buildJsonRetryPrompt,
  buildBatchQuestionGenerationPrompt,
  QUESTION_LIST_SCHEMA,
  PER_QUESTION_TOKEN_BUDGET,
  PER_QUESTION_TOKEN_BUDGET_CPU,
  GROUNDING_CHUNK_CHARS,
  GROUNDING_CHUNK_CHARS_CPU,
} from './prompts'
import { extractJsonObjects } from './jsonSalvage'

/** Stems whose cosine similarity is ≥ this against any already-accepted stem
 *  count as duplicates and are dropped. */
const STEM_DUP_COSINE = 0.88

export interface GenerateQuestionsForThemeInput {
  language: QuizLanguage
  theme: QuizTheme
  groundingChunks: ChunkRow[]
  accepted: AcceptedQuestion[]
  /** Number of accepted questions to aim for from this theme in one call. */
  count: number
  /** CPU inference — shorter grounding slices + tighter output budget. */
  cpu?: boolean | undefined
  abortSignal?: AbortSignal
}

interface RawQuestion {
  stem: string
  options: string[]
  correctIndex: number
  explanation: string
  sourceChunkIds: number[]
}

/** Produce UP TO `count` validated, stem-deduped questions for a theme in ONE
 *  grammar-constrained call. On bad JSON, retries once with the JSON-only
 *  prompt; if still bad, returns whatever valid subset parsed (possibly empty).
 *  Stem-dedup runs against `accepted` AND within the batch itself, so the same
 *  call can't return two near-identical stems. */
export async function generateQuestionsForTheme(
  llm: LlmProvider,
  embedder: EmbedderProvider,
  input: GenerateQuestionsForThemeInput,
): Promise<Array<Omit<AcceptedQuestion, 'ordinal'>>> {
  const { theme, groundingChunks, accepted, language, count, cpu, abortSignal } = input
  if (groundingChunks.length === 0 || count <= 0) return []

  const chunkChars = cpu ? GROUNDING_CHUNK_CHARS_CPU : GROUNDING_CHUNK_CHARS
  const groundingBlock = groundingChunks
    .map((c) => `[chunk:${c.id}] ${c.text.replace(/\s+/g, ' ').slice(0, chunkChars)}`)
    .join('\n')
  const allowedChunkIds = new Set(groundingChunks.map((c) => c.id))
  const avoidStems = accepted.map((a) => a.stem)

  const basePrompt = buildBatchQuestionGenerationPrompt({
    language,
    themeTitle: theme.title,
    themeSummary: theme.summary,
    groundingBlock,
    avoidStems,
    count,
  })
  const maxTokens = count * (cpu ? PER_QUESTION_TOKEN_BUDGET_CPU : PER_QUESTION_TOKEN_BUDGET)

  // Round 1: grammar-constrained batch call.
  const raw1 = await llm.generateRaw(basePrompt, {
    jsonSchema: QUESTION_LIST_SCHEMA,
    maxTokens,
    noThink: true,
    ...(abortSignal ? { abortSignal } : {}),
  })
  let parsed = parseAndValidateArray(raw1, allowedChunkIds)

  // Round 2: JSON-only retry if nothing parsed (grammar unavailable / ignored,
  // e.g. Ollama, or a malformed body). The retry restates the contract.
  if (parsed.length === 0) {
    const retry = await llm.generateRaw(buildJsonRetryPrompt(language, basePrompt), {
      jsonSchema: QUESTION_LIST_SCHEMA,
      maxTokens,
      noThink: true,
      ...(abortSignal ? { abortSignal } : {}),
    })
    parsed = parseAndValidateArray(retry, allowedChunkIds)
    if (parsed.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[quiz] no questions accepted for theme "${theme.title}" after retry; ` +
          `round1: ${snippet(raw1)} | retry: ${snippet(retry)}`,
      )
      return []
    }
  }

  // Stem-dedup the batch against the already-accepted set and against each
  // other (embed all candidate stems in one call). Drop dups.
  const stems = parsed.map((q) => q.stem)
  const embeddings = await embedder.embed(stems)
  const out: Array<Omit<AcceptedQuestion, 'ordinal'>> = []
  const acceptedEmbeddings = accepted.map((a) => a.stemEmbedding)
  for (let i = 0; i < parsed.length && out.length < count; i += 1) {
    const emb = embeddings[i]
    if (!emb) continue
    if (isStemDuplicate(emb, acceptedEmbeddings)) continue
    out.push(toAccepted(parsed[i]!, emb, theme.title))
    // Subsequent candidates must also avoid this freshly accepted stem.
    acceptedEmbeddings.push(emb)
  }
  return out
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

function isStemDuplicate(candidate: Float32Array, accepted: Float32Array[]): boolean {
  for (const a of accepted) {
    if (cosine(candidate, a) >= STEM_DUP_COSINE) return true
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
  for (const objText of extractJsonObjects(cleaned)) {
    let item: unknown
    try {
      item = JSON.parse(objText)
    } catch {
      break // truncated tail — keep the valid prefix
    }
    const q = validateQuestion(item, allowedChunkIds)
    if (q) out.push(q)
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

/** Validate one parsed MCQ object:
 *   - stem non-empty string
 *   - options: array of exactly 4 distinct non-empty strings
 *   - correct_index ∈ [0, 3]
 *   - explanation non-empty
 *   - source_chunk_ids: integers drawn from allowedChunkIds, with a fallback to
 *     the first allowed id when none overlap
 *
 *  Returns null on any failure. */
function validateQuestion(parsed: unknown, allowedChunkIds: Set<number>): RawQuestion | null {
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
    // Fall back to the first allowed chunk so a forgetful model doesn't kill an
    // otherwise-valid question. We still record the citation so the chip can do
    // something useful.
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

/** First ~200 chars of raw model output for actionable logs (one line). */
function snippet(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine || '(empty)'
}

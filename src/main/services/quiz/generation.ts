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
  buildDeckQuestionGenerationPrompt,
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

  // Round 2: JSON-only retry if nothing parsed. The retry restates the contract
  // and is meant for "grammar unavailable / ignored (e.g. Ollama) or malformed
  // body" — cases where the model would benefit from a more pointed prompt.
  //
  // On CPU we SKIP this retry: each retry is another 60-180s of decode and the
  // dominant CPU failure mode is content-level (e.g. options-not-distinct on a
  // 2B model couldn't come up with 4 distinct options once; it won't a second
  // time either, since the prompt is the same and noThink is on). Returning a
  // short deck quickly beats burning two minutes per theme on the same bad
  // pattern. The 'X of Y questions generated' warning still fires for the user.
  if (parsed.length === 0) {
    if (cpu) {
      // eslint-disable-next-line no-console
      console.warn(
        `[quiz] CPU: skipping JSON-retry for theme "${theme.title}" ` +
          `(round1: ${snippet(raw1)})`,
      )
      return []
    }
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

export interface GenerateAllQuestionsForDeckInput {
  language: QuizLanguage
  themes: QuizTheme[]
  /** themeId → grounding chunks for that theme. The deck-level call dedups
   *  these chunks across themes before stuffing them into a single prompt. */
  groundingByTheme: Map<string, ChunkRow[]>
  accepted: AcceptedQuestion[]
  /** Total questions to aim for across the WHOLE deck in this single call. */
  count: number
  abortSignal?: AbortSignal
}

/** CPU mega-batch path: ONE grammar-constrained call produces all deck
 *  questions across all themes. Replaces the per-theme loop ( N calls × ~65s
 *  prefill each ) with one call ( 1 × ~100s prefill ) , saving ~3-5 minutes
 *  on a 5-theme deck on a 2B model on CPU.
 *
 *  Trade-offs vs the per-theme call :
 *   - Theme attribution is heuristic ( source_chunk_ids → which theme owns
 *     that chunk ) rather than exact ; the UI loses a tiny bit of precision.
 *   - One bad call wastes more decode than one bad theme call.
 *   - The model has to plan all N questions in advance ; very small models
 *     might do this worse than per-theme.
 *
 *  Why no retry : same reasoning as the CPU branch in generateQuestionsForTheme
 *  — retry costs minutes and content-level failures repeat. */
export async function generateAllQuestionsForDeck(
  llm: LlmProvider,
  embedder: EmbedderProvider,
  input: GenerateAllQuestionsForDeckInput,
): Promise<Array<Omit<AcceptedQuestion, 'ordinal'>>> {
  const { themes, groundingByTheme, accepted, language, count, abortSignal } = input
  if (themes.length === 0 || count <= 0) return []

  // Format the theme list — used for both the prompt AND the post-hoc theme
  // attribution heuristic.
  const themeBlock = themes
    .map((t) => `- "${t.title}" (Gewicht/weight ${t.weight}): ${t.summary}`)
    .join('\n')

  // Dedup grounding chunks across themes ( two themes might share a window
  // chunk ). Preserves insertion order so chunks of higher-weight themes come
  // first — the model tends to over-weight the first chunks it sees.
  const seenChunkIds = new Set<number>()
  const allChunks: ChunkRow[] = []
  // Process themes in weight order so the model sees heavy themes' chunks first.
  const themesByWeight = [...themes].sort((a, b) => b.weight - a.weight)
  for (const theme of themesByWeight) {
    for (const chunk of groundingByTheme.get(theme.id) ?? []) {
      if (!seenChunkIds.has(chunk.id)) {
        seenChunkIds.add(chunk.id)
        allChunks.push(chunk)
      }
    }
  }
  if (allChunks.length === 0) return []

  // Map each chunk id → its owning theme(s) for post-hoc attribution.
  const chunkToTheme = new Map<number, QuizTheme>()
  for (const theme of themes) {
    for (const chunk of groundingByTheme.get(theme.id) ?? []) {
      if (!chunkToTheme.has(chunk.id)) chunkToTheme.set(chunk.id, theme)
    }
  }

  const groundingBlock = allChunks
    .map(
      (c) => `[chunk:${c.id}] ${c.text.replace(/\s+/g, ' ').slice(0, GROUNDING_CHUNK_CHARS_CPU)}`,
    )
    .join('\n')
  const allowedChunkIds = new Set(allChunks.map((c) => c.id))
  const avoidStems = accepted.map((a) => a.stem)

  const prompt = buildDeckQuestionGenerationPrompt({
    language,
    themeBlock,
    groundingBlock,
    avoidStems,
    count,
  })
  const maxTokens = count * PER_QUESTION_TOKEN_BUDGET_CPU

  const raw = await llm.generateRaw(prompt, {
    jsonSchema: QUESTION_LIST_SCHEMA,
    maxTokens,
    noThink: true,
    ...(abortSignal ? { abortSignal } : {}),
  })
  const parsed = parseAndValidateArray(raw, allowedChunkIds)
  if (parsed.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[quiz] deck mega-call produced no valid questions (round1: ${snippet(raw)})`)
    return []
  }

  // Stem-dedup as in the per-theme path.
  const stems = parsed.map((q) => q.stem)
  const embeddings = await embedder.embed(stems)
  const out: Array<Omit<AcceptedQuestion, 'ordinal'>> = []
  const acceptedEmbeddings = accepted.map((a) => a.stemEmbedding)
  for (let i = 0; i < parsed.length && out.length < count; i += 1) {
    const emb = embeddings[i]
    if (!emb) continue
    if (isStemDuplicate(emb, acceptedEmbeddings)) continue
    // Theme attribution heuristic: pick the theme that owns the question's
    // first cited chunk. Falls back to the heaviest theme if no overlap.
    const firstChunkId = parsed[i]!.sourceChunkIds[0]
    const owningTheme =
      (firstChunkId != null ? chunkToTheme.get(firstChunkId) : undefined) ?? themesByWeight[0]!
    out.push(toAccepted(parsed[i]!, emb, owningTheme.title))
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

/** Validate one parsed MCQ object:
 *   - stem non-empty string
 *   - options: array of exactly 4 distinct non-empty strings
 *   - correct_index ∈ [0, 3]
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
  if (new Set(opts).size !== 4) return reject(`options-not-distinct=${new Set(opts).size}`)
  const correctIndex = typeof o.correct_index === 'number' ? o.correct_index : NaN
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    return reject(`correct_index=${JSON.stringify(o.correct_index)}`)
  }
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

// Stage 1 + 2 of the quiz generation pipeline: per-doc theme extraction and
// cross-doc deduplication. See
// docs/superpowers/specs/2026-05-21-quiz-feature-design.md §4 stages 1–2.

import type { LlmProvider, EmbedderProvider } from '../providers/types'
import type { DocumentsRepo, ChunkRow } from '../../db/database'
import type { QuizLanguage } from '../../../shared/quiz'
import type { QuizTheme } from './types'
import {
  buildThemeExtractionPrompt,
  THEME_PROMPT_RESERVE_TOKENS,
  THEME_OUTPUT_RESERVE_TOKENS,
  FALLBACK_CONTEXT_TOKENS,
} from './prompts'

const DEDUP_COSINE_THRESHOLD = 0.85

/** Rough chars-per-token used to budget body inclusion without tiktoken. The
 *  exact ratio drifts with model + language; 3.5 chars/token is a conservative
 *  middle ground for de + en. We pad outputs by ~10 % to stay clear of the
 *  ceiling. */
const CHARS_PER_TOKEN = 3.5

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export interface ThemeExtractorDeps {
  llm: LlmProvider
  documents: DocumentsRepo
  /** Override the assumed LLM content budget (default FALLBACK_CONTEXT_TOKENS). */
  contextTokens?: number
}

export interface ExtractThemesForDocInput {
  docId: number
  docTitle: string
  /** All chunks for the doc, in ordinal order. */
  chunks: ChunkRow[]
  /** Language to use for the LLM prompt + theme strings. */
  language: QuizLanguage
  /** Approximate themes to request from the LLM. */
  targetCount: number
  /** Cancellation, plumbed through generateRaw. */
  abortSignal?: AbortSignal
}

/** Whole-doc-if-fits / outline-otherwise extraction. Returns themes anchored
 *  to a specific document; cross-doc dedup happens separately in
 *  dedupThemes(). */
export async function extractThemesForDocument(
  deps: ThemeExtractorDeps,
  input: ExtractThemesForDocInput,
): Promise<QuizTheme[]> {
  const { docId, docTitle, chunks, language, targetCount, abortSignal } = input
  if (chunks.length === 0) return []

  const contextTokens = deps.contextTokens ?? FALLBACK_CONTEXT_TOKENS
  const budget = Math.max(
    1000,
    contextTokens - THEME_PROMPT_RESERVE_TOKENS - THEME_OUTPUT_RESERVE_TOKENS,
  )

  const docTokens = chunks.reduce((sum, c) => sum + (c.token_count ?? estimateTokens(c.text)), 0)

  let body: string
  let bodyKind: 'whole-doc' | 'outline'
  let groundingByTheme: 'whole-doc' | 'retrieve-later'
  if (docTokens <= budget) {
    body = chunks.map((c) => c.text).join('\n\n')
    bodyKind = 'whole-doc'
    groundingByTheme = 'whole-doc'
  } else {
    body = buildOutline(chunks, budget)
    bodyKind = 'outline'
    groundingByTheme = 'retrieve-later'
  }

  const prompt = buildThemeExtractionPrompt({
    language,
    docTitle,
    body,
    bodyKind,
    targetCount,
  })
  // Theme extraction stays on the main chat session (large profile context), not
  // the quiz pool: a whole-doc prompt + a verbose theme list overruns the pool's
  // modest 8192-token context and the array gets truncated → 0 themes. It's only
  // 1–3 calls per quiz anyway; the pool's parallelism pays off on the questions.
  // `noThink` disables the model's reasoning segment (this model thinks despite
  // the `/no_think` hint), which is most of the per-call latency.
  const raw = await deps.llm.generateRaw(prompt, {
    ...(abortSignal ? { abortSignal } : {}),
    noThink: true,
  })
  const themes = parseThemeJson(raw)
  if (themes.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[quiz] 0 themes parsed for "${docTitle}" (${bodyKind}, ${raw.length} chars): ${raw.slice(0, 200).replace(/\s+/g, ' ')}`,
    )
    return []
  }

  // Whole-doc path: every theme is grounded in the full doc, so we attach all
  // chunk IDs to each theme. Generation will sub-retrieve from these later if
  // the LLM struggles to pick the right one. Outline path: we leave the array
  // empty and let generation call RetrievalService.search per-theme.
  const allChunkIds = chunks.map((c) => c.id)
  return themes.map((t, i) => ({
    id: `${docId}:${i}`,
    docId,
    title: t.title,
    summary: t.summary,
    weight: t.weight,
    groundingChunkIds: groundingByTheme === 'whole-doc' ? allChunkIds : [],
  }))
}

/** Trim text to roughly `tokenBudget` tokens worth of characters. Used by the
 *  outline path when even the heading list overruns the budget. */
function trimToTokenBudget(text: string, tokenBudget: number): string {
  const charBudget = Math.floor(tokenBudget * CHARS_PER_TOKEN)
  return text.length <= charBudget ? text : text.slice(0, charBudget) + '…'
}

function buildOutline(chunks: ChunkRow[], budget: number): string {
  // Prefer heading_path when available (markdown chunks); fall back to the
  // first sentence of each chunk. Keep it dense — we want as many entries as
  // fit so the LLM gets a real survey of the doc.
  const seenHeadings = new Set<string>()
  const lines: string[] = []
  for (const c of chunks) {
    if (Array.isArray(c.heading_path) && c.heading_path.length > 0) {
      const key = c.heading_path.join(' › ')
      if (!seenHeadings.has(key)) {
        seenHeadings.add(key)
        lines.push(`# ${key}`)
      }
    }
    const firstSentence = c.text.split(/[.!?\n]/, 1)[0]?.trim() ?? ''
    if (firstSentence.length > 0) {
      lines.push(`- ${firstSentence.slice(0, 200)}`)
    }
  }
  return trimToTokenBudget(lines.join('\n'), budget)
}

interface RawTheme {
  title: string
  summary: string
  weight: number
}

/** Pull a JSON array out of the model's response, tolerating leading/trailing
 *  prose and code fences. */
function parseThemeJson(raw: string): RawTheme[] {
  const cleaned = stripCodeFences(raw)
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: RawTheme[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    const summary = typeof o.summary === 'string' ? o.summary.trim() : ''
    const weight =
      typeof o.weight === 'number' && Number.isFinite(o.weight)
        ? Math.max(1, Math.round(o.weight))
        : 1
    if (!title || !summary) continue
    out.push({ title: title.slice(0, 200), summary: summary.slice(0, 500), weight })
  }
  return out
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^[^[{]*```(?:json)?\s*/i, '')
    .replace(/```[^`]*$/i, '')
    .trim()
}

/** Greedy cosine clustering. Themes with cosine ≥ DEDUP_COSINE_THRESHOLD are
 *  collapsed; the higher-weight survives, weights sum, groundingChunkIds union. */
export async function dedupThemes(
  embedder: EmbedderProvider,
  themes: QuizTheme[],
): Promise<QuizTheme[]> {
  if (themes.length <= 1) return themes.slice()
  const texts = themes.map((t) => `${t.title} — ${t.summary}`)
  const vectors = await embedder.embed(texts)
  if (vectors.length !== themes.length) return themes.slice()

  const survivors: Array<{ theme: QuizTheme; vector: Float32Array }> = []
  for (let i = 0; i < themes.length; i += 1) {
    const theme = themes[i]!
    const vec = vectors[i]!
    let mergedInto = -1
    for (let j = 0; j < survivors.length; j += 1) {
      const sim = cosine(vec, survivors[j]!.vector)
      if (sim >= DEDUP_COSINE_THRESHOLD) {
        mergedInto = j
        break
      }
    }
    if (mergedInto < 0) {
      survivors.push({
        theme: { ...theme, groundingChunkIds: [...theme.groundingChunkIds] },
        vector: vec,
      })
      continue
    }
    const target = survivors[mergedInto]!.theme
    target.weight += theme.weight
    if (theme.weight > target.weight - theme.weight) {
      // Adopt the better title/summary if the new theme had the heavier weight
      // pre-merge (i.e. the merged-in theme dominates by weight). Otherwise
      // keep the original survivor.
      target.title = theme.title
      target.summary = theme.summary
      target.docId = theme.docId
    }
    const seen = new Set(target.groundingChunkIds)
    for (const id of theme.groundingChunkIds) seen.add(id)
    target.groundingChunkIds = [...seen]
  }
  return survivors.map((s) => s.theme)
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

/** Largest-remainder allocation by weight. See spec §4 stage 3. */
export function allocateSlots(
  themes: QuizTheme[],
  total: number,
): Array<{ theme: QuizTheme; budget: number }> {
  if (themes.length === 0 || total <= 0) return []
  if (total <= themes.length) {
    return themes
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .slice(0, total)
      .map((theme) => ({ theme, budget: 1 }))
  }
  const totalWeight = themes.reduce((s, t) => s + t.weight, 0)
  if (totalWeight === 0) {
    // Degenerate: distribute evenly
    const base = Math.floor(total / themes.length)
    const remainder = total - base * themes.length
    return themes.map((theme, i) => ({ theme, budget: base + (i < remainder ? 1 : 0) }))
  }
  const ideal = themes.map((t) => (t.weight / totalWeight) * total)
  const floors = ideal.map((x) => Math.floor(x))
  let assigned = floors.reduce((s, x) => s + x, 0)
  // Each theme must get at least 1 — bump up zeroes by stealing from the most-
  // overshot themes if necessary.
  for (let i = 0; i < floors.length; i += 1) {
    if (floors[i]! === 0) {
      floors[i] = 1
      assigned += 1
    }
  }
  // Distribute remainder to themes with the largest fractional parts.
  let remaining = total - assigned
  if (remaining < 0) {
    // We over-allocated by forcing minimums; trim from the smallest fractional themes.
    const order = themes
      .map((_, i) => i)
      .sort((a, b) => ideal[a]! - Math.floor(ideal[a]!) - (ideal[b]! - Math.floor(ideal[b]!)))
    let i = 0
    while (remaining < 0 && i < order.length) {
      const idx = order[i]!
      if (floors[idx]! > 1) {
        floors[idx] = floors[idx]! - 1
        remaining += 1
      }
      i += 1
    }
  } else if (remaining > 0) {
    const order = themes
      .map((_, i) => i)
      .sort((a, b) => ideal[b]! - Math.floor(ideal[b]!) - (ideal[a]! - Math.floor(ideal[a]!)))
    for (let i = 0; i < order.length && remaining > 0; i += 1) {
      floors[order[i]!] = floors[order[i]!]! + 1
      remaining -= 1
    }
  }
  return themes.map((theme, i) => ({ theme, budget: floors[i]! }))
}

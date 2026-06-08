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
  THEME_EXTRACTION_MAX_TOKENS,
  THEME_EXTRACTION_MAX_TOKENS_CPU,
  THEME_LIST_SCHEMA,
  FALLBACK_CONTEXT_TOKENS,
} from './prompts'
import { extractJsonObjects } from './jsonSalvage'

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
  /** Override the live LLM content budget. When unset we probe
   *  llm.contextWindowTokens() and fall back to FALLBACK_CONTEXT_TOKENS. */
  contextTokens?: number
}

export interface ExtractThemesForDocInput {
  docId: number
  docTitle: string
  /** All chunks for the doc, in ordinal order. */
  chunks: ChunkRow[]
  /** Language to use for the LLM prompt + theme strings. */
  language: QuizLanguage
  /** Approximate themes to request from the LLM (across all windows). */
  targetCount: number
  /** CPU inference — applies hard work-caps (fewer windows, tighter output
   *  budget) so a slow run finishes instead of timing out. */
  cpu?: boolean | undefined
  /** Cancellation, plumbed through generateRaw. */
  abortSignal?: AbortSignal
}

/** On CPU we sample at most this many windows (evenly spaced) instead of
 *  extracting from the whole doc, trading coverage for finishing. */
const CPU_MAX_WINDOWS = 2

/** A consecutive run of chunks whose combined text fits one extraction call. */
interface ChunkWindow {
  chunks: ChunkRow[]
  tokens: number
}

/** Pack chunks (ordinal order) into consecutive windows that each fit `budget`.
 *  A doc that fits the budget becomes exactly one window — the same single call
 *  as before, now correctly bounded by the live context window. */
function packWindows(chunks: ChunkRow[], budget: number): ChunkWindow[] {
  const windows: ChunkWindow[] = []
  let current: ChunkRow[] = []
  let currentTokens = 0
  for (const c of chunks) {
    const t = c.token_count ?? estimateTokens(c.text)
    if (current.length > 0 && currentTokens + t > budget) {
      windows.push({ chunks: current, tokens: currentTokens })
      current = []
      currentTokens = 0
    }
    current.push(c)
    currentTokens += t
  }
  if (current.length > 0) windows.push({ chunks: current, tokens: currentTokens })
  return windows
}

/** Windowed map-reduce extraction. Each window is a real run of chunk text (no
 *  lossy outline) so every theme's groundingChunkIds are the actual chunk ids
 *  in that window. Cross-window/cross-doc dedup happens later in dedupThemes(). */
export async function extractThemesForDocument(
  deps: ThemeExtractorDeps,
  input: ExtractThemesForDocInput,
): Promise<QuizTheme[]> {
  const { docId, docTitle, chunks, language, targetCount, cpu, abortSignal } = input
  if (chunks.length === 0) return []

  const contextTokens =
    deps.contextTokens ?? (deps.llm.contextWindowTokens() || FALLBACK_CONTEXT_TOKENS)
  const budget = Math.max(
    1000,
    contextTokens - THEME_PROMPT_RESERVE_TOKENS - THEME_OUTPUT_RESERVE_TOKENS,
  )

  const allWindows = packWindows(chunks, budget)
  // CPU cap: keep at most CPU_MAX_WINDOWS, sampled evenly across the doc so we
  // still cover beginning + end instead of only the opening section.
  const windows = cpu ? sampleEvenly(allWindows, CPU_MAX_WINDOWS) : allWindows
  const maxTokens = cpu ? THEME_EXTRACTION_MAX_TOKENS_CPU : THEME_EXTRACTION_MAX_TOKENS
  // Scale the per-window ask down so all windows together total ≈ targetCount,
  // but always request at least 1 (a window with content should yield a theme).
  const perWindow = Math.max(1, Math.round(targetCount / windows.length))

  const out: QuizTheme[] = []
  let themeIndex = 0
  for (const w of windows) {
    if (abortSignal?.aborted) throw new Error('cancelled')
    const body = w.chunks.map((c) => c.text).join('\n\n')
    const prompt = buildThemeExtractionPrompt({ language, docTitle, body, targetCount: perWindow })
    const raw = await deps.llm.generateRaw(prompt, {
      jsonSchema: THEME_LIST_SCHEMA,
      maxTokens,
      noThink: true,
      ...(abortSignal ? { abortSignal } : {}),
    })
    const parsed = parseThemeJson(raw)
    if (parsed.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[quiz] no themes parsed for doc ${docId} ("${docTitle}"); raw output: ${snippet(raw)}`,
      )
    }
    const windowChunkIds = w.chunks.map((c) => c.id)
    for (const t of parsed) {
      out.push({
        id: `${docId}:${themeIndex}`,
        docId,
        title: t.title,
        summary: t.summary,
        weight: t.weight,
        // Real grounding: the chunk ids in this window, not a doc-wide blob.
        groundingChunkIds: windowChunkIds,
      })
      themeIndex += 1
    }
  }
  return out
}

interface RawTheme {
  title: string
  summary: string
  weight: number
}

/** Pull themes out of the model's response, tolerating leading/trailing prose,
 *  code fences, AND truncation. Rather than parsing the whole `[...]` slice in
 *  one JSON.parse (which throws — and loses everything — if the model was cut
 *  off mid-array), we extract each top-level object by brace-matching and parse
 *  them independently, stopping at the first that fails to parse but keeping the
 *  valid prefix. */
function parseThemeJson(raw: string): RawTheme[] {
  const cleaned = stripCodeFences(raw)
  const out: RawTheme[] = []
  for (const objText of extractJsonObjects(cleaned)) {
    let item: unknown
    try {
      item = JSON.parse(objText)
    } catch {
      break // truncated tail — keep what we have
    }
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

/** Pick at most `max` items spaced evenly across the list (always includes the
 *  first; spreads the rest so we sample beginning..end rather than a prefix). */
function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  if (max <= 1) return items.slice(0, Math.max(0, max))
  const out: T[] = []
  for (let i = 0; i < max; i += 1) {
    const idx = Math.round((i * (items.length - 1)) / (max - 1))
    out.push(items[idx]!)
  }
  return out
}

/** First ~200 chars of raw model output for actionable logs (one line). */
function snippet(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine || '(empty)'
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

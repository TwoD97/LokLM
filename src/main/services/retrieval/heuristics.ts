import type { SearchHit } from '@main/db/database'
import type { ResponseLanguage } from '../llm/prompt'

// small-but-deliberate DE+EN stopword set. Domain-relevant nouns like
// "Wochenbuch" intentionally NOT in the list — they should pass through
// to match title boosts. Tweak with care: each addition reduces recall.
const TITLE_STOPWORDS = new Set([
  // English
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'was',
  'were',
  'be',
  'by',
  'at',
  'as',
  'it',
  // German
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einer',
  'eines',
  'und',
  'oder',
  'von',
  'zu',
  'im',
  'auf',
  'für',
  'mit',
  'ist',
  'sind',
])

/** Shared query/title tokenizer. Exported for the qa router's target-document
 *  resolution so "summarize my Wochenbuch" matches titles by exactly the same
 *  rules as applyTitleBoost. */
export function nonStopwordTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zA-Z0-9äöüß]+/)
    .filter((t) => t.length > 0 && !TITLE_STOPWORDS.has(t))
}

// Decomposition bounds (ADR-0003 multi-question handling). Beyond MAX it's
// likely pasted content, not a genuine multi-question chat turn — decomposing
// would just multiply retrieval passes, so we treat it as one query. MIN_CHARS
// filters '?'-noise ("ok?", "Thanks!") so they don't count as a sub-question.
const MAX_SUBQUESTIONS = 5
const MIN_SUBQUESTION_CHARS = 10

/**
 * Split a chat message into distinct sub-questions for separate retrieval
 * (ADR-0003). Pure + hot-path safe — NO LLM. Conservative by design: splits
 * ONLY on '?' boundaries, so an "and"/"oder" INSIDE one question ("difference
 * between X and Y?", "how does X work and why?") stays together. A false merge
 * (the status quo) is cheaper than a false split, so anything not clearly
 * compound returns the original `[query]`. Language-agnostic ('?' is universal).
 *
 * Used by RetrievalService to retrieve each sub-question separately and RRF-fuse
 * the pools (coverage across topics instead of one diluted centroid vector), and
 * by the qa router to keep compound messages off the single-intent routes.
 */
export function splitQuestions(query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed.includes('?')) return [trimmed]
  // Split AFTER each '?' (lookbehind keeps the mark with its segment), then
  // drop fragments too short or stopword-only to be a real question.
  const segments = trimmed
    .split(/(?<=\?)/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SUBQUESTION_CHARS && nonStopwordTokens(s).length >= 1)
  if (segments.length < 2 || segments.length > MAX_SUBQUESTIONS) return [trimmed]
  return segments
}

export function applyTitleBoost(hits: SearchHit[], query: string, factor: number): SearchHit[] {
  if (factor === 1.0 || factor <= 0) return hits
  const qTokens = new Set(nonStopwordTokens(query))
  if (qTokens.size === 0) return hits
  return hits.map((h) => {
    const titleTokens = nonStopwordTokens(h.document_title)
    const overlap = titleTokens.some((t) => qTokens.has(t))
    return overlap ? { ...h, score: h.score * factor } : h
  })
}

export function applyShortChunkPenalty(
  hits: SearchHit[],
  factor: number,
  minChars: number,
): SearchHit[] {
  if (factor === 1.0 || factor <= 0) return hits
  return hits.map((h) => (h.text.length < minChars ? { ...h, score: h.score * factor } : h))
}

export function applyRecencyBoost(
  hits: SearchHit[],
  factor: number,
  windowMs: number,
): SearchHit[] {
  if (factor === 1.0 || factor <= 0 || windowMs <= 0) return hits
  const nowSec = Math.floor(Date.now() / 1000)
  const windowSec = Math.floor(windowMs / 1000)
  return hits.map((h) => {
    const added = h.added_at ?? null
    if (added == null) return h
    return nowSec - added <= windowSec ? { ...h, score: h.score * factor } : h
  })
}

/**
 * Mild multiplicative boost (default ~1.10) for chunks whose detected language
 * matches the configured response language. Backed by the research summarised
 * in src/main/services/llm/prompt.ts: language-matched material is easier for
 * the model to quote-cite without translation drift, and downstream answer
 * quality drops measurably (~5–10 %) when the model is forced to translate
 * source text mid-response.
 *
 * No-ops in three cases — each chosen to avoid hurting recall:
 *   - factor ≤ 1.0           : caller explicitly disabled the heuristic
 *   - responseLang missing   : caller didn't tell us what language to favour
 *   - chunk.language ∈ {null, 'other'} : we can't be sure of a mismatch, so
 *     leave the chunk untouched rather than down-weight it relative to
 *     known-matching chunks (which would happen implicitly if we boosted only
 *     the matches).
 *
 * Mirrors applyTitleBoost's shape: returns a new array, mutates nothing.
 */
export function applyLanguageMatchBoost(
  hits: SearchHit[],
  responseLang: ResponseLanguage | undefined,
  factor: number,
): SearchHit[] {
  if (factor === 1.0 || factor <= 0 || !responseLang) return hits
  return hits.map((h) =>
    h.language && h.language !== 'other' && h.language === responseLang
      ? { ...h, score: h.score * factor }
      : h,
  )
}

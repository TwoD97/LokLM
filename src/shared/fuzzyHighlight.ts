/**
 * Token-shingle fuzzy match used by SourceViewer to highlight , inside a
 * cited chunk , the spans that look like the sentence(s) of the assistant
 * answer that point at this citation.
 *
 * Why shingles and not edit distance: we don't need full alignment , we just
 * want to find the few-word sequences that look like the answer text. 3-gram
 * shingles catch reorderings and small insertions for free , and the matcher
 * stays O(n) over chunk length.
 *
 * Why not regex from the snippet directly: model output paraphrases the
 * source. A literal substring match is rare even when the chunk is the right
 * one. Shingles give partial credit.
 *
 * One important property: highlights are **non-overlapping** , merged when
 * close , and returned in start-offset order so callers can slice the chunk
 * text once and render alternating plain / highlighted spans.
 */

export interface HighlightRange {
  start: number
  end: number
}

const DEFAULT_NGRAM = 3
const MIN_TOKEN_CHARS = 2 // skip 1-char tokens to dampen "a", "I", "1", etc.
const MERGE_GAP_CHARS = 6 // collapse two highlight spans separated by <= this many chars
// Two matched tokens up to this many unmatched tokens apart belong to the same
// region. Larger = more tolerant of paraphrase reordering; small enough that a
// stray match in an unrelated sentence starts a new (losing) region instead of
// stretching the winning one across half the chunk.
const MAX_GAP_TOKENS = 4
// Cap a single token's contribution so one very long word can't outweigh a
// genuinely denser multi-word region.
const MAX_TOKEN_WEIGHT = 12

interface Token {
  start: number
  end: number
  normalised: string
}

/**
 * Returns highlight ranges (start/end offsets into `chunkText`) for the parts
 * that fuzzy-match any of the provided `snippets`. Snippets are typically the
 * sentences of the assistant answer that cite this chunk (see
 * `extractCitationSnippets`).
 *
 * `n` controls the shingle size. Smaller n = more sensitive but noisier.
 * The default (3) is the sweet spot for paraphrased text. Falls back to 2-grams
 * when the snippet is too short for 3-grams.
 *
 * Empty snippet list or empty chunkText yields no highlights.
 */
export function findFuzzyHighlights(
  chunkText: string,
  snippets: string[],
  opts: { n?: number } = {},
): HighlightRange[] {
  if (!chunkText || snippets.length === 0) return []
  const chunkTokens = tokenise(chunkText)
  if (chunkTokens.length === 0) return []

  const desiredN = opts.n ?? DEFAULT_NGRAM

  // Match each snippet INDEPENDENTLY and keep only its single best-matching
  // region. Pooling every snippet's shingles together (the old approach) let a
  // common phrase shared by the whole answer light up scattered fragments all
  // over the chunk — the citation would "highlight" three unrelated spots
  // instead of the one sentence it supports. Per-snippet + best-region keeps the
  // highlight on the passage that actually matches, while two genuinely distinct
  // snippets still contribute two regions.
  const all: HighlightRange[] = []
  for (const snippet of snippets) {
    const snipTokens = tokenise(snippet)
    if (snipTokens.length === 0) continue
    all.push(...bestRegionForSnippet(chunkTokens, snipTokens, desiredN))
  }
  if (all.length === 0) return []
  all.sort((a, b) => a.start - b.start)
  return mergeClose(all)
}

function bestRegionForSnippet(
  chunkTokens: Token[],
  snipTokens: Token[],
  desiredN: number,
): HighlightRange[] {
  // Progressive fallback: 3-grams are the sweet spot for paraphrased same-
  // language prose. When that finds nothing — typically because the snippet
  // and chunk are in different languages or the model paraphrased very
  // aggressively — fall back to 2-grams, then to single-token matches with a
  // min-length filter so shared terms like "Frontier" or proper nouns still
  // highlight without lighting up every "die" / "the".
  const primaryN = snipTokens.length < desiredN ? 2 : desiredN
  const ladder: Array<{ n: number; minTokenLen: number }> = [{ n: primaryN, minTokenLen: 2 }]
  if (primaryN > 2) ladder.push({ n: 2, minTokenLen: 2 })
  ladder.push({ n: 1, minTokenLen: 5 })

  for (const { n, minTokenLen } of ladder) {
    if (chunkTokens.length < n) continue
    const matched = matchedTokens(chunkTokens, snipTokens, n, minTokenLen)
    const ranges = bestRegion(chunkTokens, matched)
    if (ranges.length > 0) return ranges
  }
  return []
}

/** Boolean per chunk token: true when it is part of a shingle the snippet also
 *  contains. For n === 1 a min-length filter dampens common-word noise
 *  (articles, prepositions); for n > 1 the multi-token shingle is specific
 *  enough that the filter is a deliberate no-op. */
function matchedTokens(
  chunkTokens: Token[],
  snipTokens: Token[],
  n: number,
  minTokenLen: number,
): boolean[] {
  const passesMinLen = (t: Token): boolean => t.normalised.length >= minTokenLen
  const snippetShingles = new Set<string>()
  const eligible = n === 1 ? snipTokens.filter(passesMinLen) : snipTokens
  for (const sh of shingles(eligible, n)) snippetShingles.add(sh)
  const matched = new Array<boolean>(chunkTokens.length).fill(false)
  if (snippetShingles.size === 0) return matched
  for (let i = 0; i + n <= chunkTokens.length; i++) {
    if (n === 1 && !passesMinLen(chunkTokens[i]!)) continue
    const key = chunkTokens
      .slice(i, i + n)
      .map((t) => t.normalised)
      .join(' ')
    if (snippetShingles.has(key)) {
      for (let k = 0; k < n; k++) matched[i + k] = true
    }
  }
  return matched
}

/**
 * Group matched tokens into regions (matches within MAX_GAP_TOKENS of each
 * other), score each region by its summed token weight (longer words count for
 * more, capped), and return the highlight ranges of the single highest-scoring
 * region. Isolated matches in unrelated sentences form their own low-scoring
 * regions and lose, so the highlight stays on the passage that genuinely
 * matches the snippet.
 */
function bestRegion(chunkTokens: Token[], matched: boolean[]): HighlightRange[] {
  interface Region {
    from: number
    to: number
    score: number
  }
  const regions: Region[] = []
  let cur: Region | null = null
  let gap = 0
  for (let i = 0; i < chunkTokens.length; i++) {
    if (matched[i]) {
      if (!cur) cur = { from: i, to: i, score: 0 }
      cur.to = i
      cur.score += Math.min(chunkTokens[i]!.normalised.length, MAX_TOKEN_WEIGHT)
      gap = 0
    } else if (cur) {
      gap++
      if (gap > MAX_GAP_TOKENS) {
        regions.push(cur)
        cur = null
        gap = 0
      }
    }
  }
  if (cur) regions.push(cur)
  if (regions.length === 0) return []

  let best = regions[0]!
  for (const r of regions) if (r.score > best.score) best = r

  // Emit the contiguous matched runs inside the winning region; the small
  // unmatched gaps between them stay un-highlighted, and mergeClose bridges any
  // that sit within a few characters of each other.
  const raw: HighlightRange[] = []
  let i = best.from
  while (i <= best.to) {
    if (!matched[i]) {
      i++
      continue
    }
    const startTok = chunkTokens[i]!
    let j = i
    while (j + 1 <= best.to && matched[j + 1]) j++
    raw.push({ start: startTok.start, end: chunkTokens[j]!.end })
    i = j + 1
  }
  return mergeClose(raw)
}

/**
 * Splits `text` into alternating plain / highlighted segments given a set of
 * ranges. Output is in order , covers the entire text , and never produces
 * empty plain segments at the boundaries (a leading highlight starts the
 * output with `highlighted: true`).
 */
export interface HighlightedSegment {
  text: string
  highlighted: boolean
}

/**
 * Case-insensitive literal-substring ranges of `query` inside `text`. Used to
 * light up the matched part of a filename in library search results — the
 * filename arm of searchLibrary matches the raw title with an ILIKE on the full
 * query , so this highlights exactly that: every contiguous occurrence of the
 * trimmed query. No occurrence (the row came from a content match) → no range.
 *
 * Offsets are computed on the lower-cased copies , which stay length-aligned
 * with the original for the scripts filenames use (Latin + German umlauts).
 */
export function findLiteralHighlights(text: string, query: string): HighlightRange[] {
  const needle = query.trim().toLowerCase()
  if (!needle || !text) return []
  const hay = text.toLowerCase()
  const ranges: HighlightRange[] = []
  for (let from = 0; ; ) {
    const idx = hay.indexOf(needle, from)
    if (idx === -1) break
    ranges.push({ start: idx, end: idx + needle.length })
    from = idx + needle.length
  }
  return ranges
}

export function applyHighlights(text: string, ranges: HighlightRange[]): HighlightedSegment[] {
  if (ranges.length === 0) return [{ text, highlighted: false }]
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out: HighlightedSegment[] = []
  let cursor = 0
  for (const r of sorted) {
    if (r.start > cursor) out.push({ text: text.slice(cursor, r.start), highlighted: false })
    out.push({ text: text.slice(r.start, r.end), highlighted: true })
    cursor = r.end
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), highlighted: false })
  return out
}

function tokenise(text: string): Token[] {
  const out: Token[] = []
  // Word = sequence of letters/digits (incl. accented). Tokenise by stepping
  // through; \p{L} keeps German umlauts working without a custom whitelist.
  const re = /[\p{L}\p{N}]+/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[0]
    if (raw.length < MIN_TOKEN_CHARS) continue
    out.push({
      start: m.index,
      end: m.index + raw.length,
      normalised: raw.toLowerCase(),
    })
  }
  return out
}

function shingles(tokens: Token[], n: number): string[] {
  if (tokens.length < n) return []
  const out: string[] = []
  for (let i = 0; i + n <= tokens.length; i++) {
    out.push(
      tokens
        .slice(i, i + n)
        .map((t) => t.normalised)
        .join(' '),
    )
  }
  return out
}

function mergeClose(ranges: HighlightRange[]): HighlightRange[] {
  if (ranges.length === 0) return ranges
  const first = ranges[0]!
  const out: HighlightRange[] = [{ start: first.start, end: first.end }]
  for (let i = 1; i < ranges.length; i++) {
    const prev = out[out.length - 1]!
    const cur = ranges[i]!
    if (cur.start - prev.end <= MERGE_GAP_CHARS) {
      prev.end = Math.max(prev.end, cur.end)
    } else {
      out.push({ start: cur.start, end: cur.end })
    }
  }
  return out
}

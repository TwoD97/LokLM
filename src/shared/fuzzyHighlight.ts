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
  const minSnippetTokens = Math.min(...snippets.map((s) => tokenise(s).length).filter((l) => l > 0))
  // Fall back to bigrams when even the shortest snippet can't fill an n-gram.
  const n = Number.isFinite(minSnippetTokens) && minSnippetTokens < desiredN ? 2 : desiredN
  if (chunkTokens.length < n) return []

  const snippetShingles = new Set<string>()
  for (const s of snippets) {
    for (const sh of shingles(tokenise(s), n)) snippetShingles.add(sh)
  }
  if (snippetShingles.size === 0) return []

  // Mark which chunk-token positions are part of at least one matching shingle.
  const tokenMatched = new Array<boolean>(chunkTokens.length).fill(false)
  for (let i = 0; i + n <= chunkTokens.length; i++) {
    const key = chunkTokens
      .slice(i, i + n)
      .map((t) => t.normalised)
      .join(' ')
    if (snippetShingles.has(key)) {
      for (let k = 0; k < n; k++) tokenMatched[i + k] = true
    }
  }

  // Collapse consecutive matched tokens into character ranges.
  const raw: HighlightRange[] = []
  let i = 0
  while (i < chunkTokens.length) {
    if (!tokenMatched[i]) {
      i++
      continue
    }
    const startTok = chunkTokens[i]!
    let j = i
    while (j + 1 < chunkTokens.length && tokenMatched[j + 1]) j++
    const endTok = chunkTokens[j]!
    raw.push({ start: startTok.start, end: endTok.end })
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

export interface AnchoredSourceQuote {
  /** Intact original source slice, not the model's whitespace-normalized text. */
  quote: string
  /** UTF-16 offsets into the original source; end is exclusive. */
  start: number
  end: number
  /** More than one source location matches under whitespace collapse. */
  ambiguous: boolean
}

export const SOURCE_QUOTE_LIMITS = Object.freeze({
  sourceChars: 64_000,
  quoteCodePoints: 200,
  contextCodePoints: 800,
})

/** Collapse whitespace runs while mapping every normalized UTF-16 code unit
 * back to its full original span. No case, punctuation or Unicode folding. */
function normalizedSource(source: string): {
  text: string
  starts: number[]
  ends: number[]
} {
  const chunks: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  for (const match of source.matchAll(/\s+|\S+/gu)) {
    const start = match.index!
    if (/^\s/u.test(match[0])) {
      chunks.push(' ')
      starts.push(start)
      ends.push(start + match[0].length)
    } else {
      chunks.push(match[0])
      for (let offset = 0; offset < match[0].length; offset++) {
        starts.push(start + offset)
        ends.push(start + offset + 1)
      }
    }
  }
  return { text: chunks.join(''), starts, ends }
}

/** Anchor a bounded quotation by whitespace-tolerant text membership only.
 * Missing words, punctuation/case changes, reordering and inserted ellipses do
 * not match. The returned original slice preserves newlines and qualifiers;
 * this does not establish semantic support, relevance, approval or authority.
 * Boundary whitespace may be omitted; interior whitespace cannot disappear. */
export function anchorSourceQuote(
  source: string,
  proposedQuote: string,
): AnchoredSourceQuote | null {
  if (
    typeof source !== 'string' ||
    typeof proposedQuote !== 'string' ||
    source.length > SOURCE_QUOTE_LIMITS.sourceChars ||
    proposedQuote.length > SOURCE_QUOTE_LIMITS.quoteCodePoints * 2 ||
    Array.from(proposedQuote).length > SOURCE_QUOTE_LIMITS.quoteCodePoints
  )
    return null
  const quote = proposedQuote.trim().replace(/\s+/gu, ' ')
  if (!quote) return null
  const normalized = normalizedSource(source)
  let found: AnchoredSourceQuote | null = null
  let matches = 0
  let cursor = 0
  while (cursor <= normalized.text.length - quote.length) {
    const index = normalized.text.indexOf(quote, cursor)
    if (index < 0) break
    matches++
    const start = normalized.starts[index]!
    const end = normalized.ends[index + quote.length - 1]!
    // Bound the original source span too: never return a giant whitespace window
    // merely because its normalized representation was short.
    if (!found && end - start <= SOURCE_QUOTE_LIMITS.quoteCodePoints * 2) {
      const original = source.slice(start, end)
      if (Array.from(original).length <= SOURCE_QUOTE_LIMITS.quoteCodePoints)
        found = { quote: original, start, end, ambiguous: false }
    }
    if (found && matches > 1) return { ...found, ambiguous: true }
    // Overlapping occurrences are distinct locations too.
    cursor = index + 1
  }
  return found
}

/** Display a short enclosing paragraph so a selected sentence does not lose
 * nearby dates, exceptions or antecedents. This only expands inside the exact
 * supplied passage; it does not resolve applicability or retrieve new evidence.
 * Keep fenced code and multi-paragraph anchors unchanged rather than guessing
 * their block boundaries. Oversized paragraphs also retain the original quote. */
export function expandSourceQuoteContext(
  source: string,
  anchor: AnchoredSourceQuote,
): AnchoredSourceQuote | null {
  if (
    source.length > SOURCE_QUOTE_LIMITS.sourceChars ||
    !Number.isSafeInteger(anchor.start) ||
    !Number.isSafeInteger(anchor.end) ||
    anchor.start < 0 ||
    anchor.end <= anchor.start ||
    anchor.end > source.length ||
    source.slice(anchor.start, anchor.end) !== anchor.quote
  )
    return null
  if (/(?:^|[\r\n]) {0,3}(?:`{3,}|~{3,})/u.test(source)) return { ...anchor }
  let start = 0
  let end = source.length
  // Read real lines instead of a two-newline regex: CRLF must not backtrack
  // into two independent line breaks and split every Windows paragraph.
  for (const line of source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)) {
    if (!line[0]) continue
    if (line[0].replace(/(?:\r\n|\r|\n)$/u, '').trim()) continue
    const lineStart = line.index!
    const lineEnd = lineStart + line[0].length
    if (lineEnd <= anchor.start) start = lineEnd
    else if (lineStart >= anchor.end) {
      end = lineStart
      break
    } else return { ...anchor }
  }
  const window = source.slice(start, end)
  const quote = window.trim()
  start += window.length - window.trimStart().length
  end = start + quote.length
  if (
    start > anchor.start ||
    end < anchor.end ||
    Array.from(quote).length > SOURCE_QUOTE_LIMITS.contextCodePoints
  )
    return { ...anchor }
  return { quote, start, end, ambiguous: anchor.ambiguous }
}

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

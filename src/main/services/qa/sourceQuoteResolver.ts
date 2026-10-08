import { anchorSourceQuote, SOURCE_QUOTE_LIMITS } from './sourceQuote'

export type QuoteSource = { document_id: number; chunk_id: number; text: string }
export type ResolvedSourceQuote = {
  source: string
  start: number
  end: number
  text: string
  ambiguous: false
}
export type SourceQuoteResolution =
  | { span: ResolvedSourceQuote }
  | { reason: 'quote_missing' | 'quote_ambiguous' }

/** Resolve provenance across the complete supplied catalog, not a model-chosen
 * identity. A unique textual match is not evidence of relevance or entailment.
 * Whitespace is the only tolerated difference; returned text/offsets are original. */
export function createSourceQuoteResolver(input: readonly QuoteSource[]) {
  if (!input.length || input.length > 32) return null
  const ids = new Set<string>()
  let total = 0
  const passages: Array<{ source: string; text: string; normalized: string }> = []
  for (const passage of input) {
    if (
      !Number.isSafeInteger(passage.document_id) ||
      passage.document_id <= 0 ||
      !Number.isSafeInteger(passage.chunk_id) ||
      passage.chunk_id <= 0 ||
      typeof passage.text !== 'string' ||
      !passage.text.trim() ||
      passage.text.length > SOURCE_QUOTE_LIMITS.sourceChars
    )
      return null
    total += passage.text.length
    if (total > 256_000) return null
    const source = `${passage.document_id}:${passage.chunk_id}`
    if (ids.has(source)) return null
    ids.add(source)
    passages.push({ source, text: passage.text, normalized: passage.text.replace(/\s+/gu, ' ') })
  }
  // Bound memoization independently of model output length. Copies prevent a
  // caller from mutating a cached source span used by a later answer record.
  const cache = new Map<string, SourceQuoteResolution>()
  const copy = (result: SourceQuoteResolution): SourceQuoteResolution =>
    'span' in result ? { span: { ...result.span } } : { ...result }
  return (proposed: unknown): SourceQuoteResolution => {
    if (
      typeof proposed !== 'string' ||
      proposed.length > SOURCE_QUOTE_LIMITS.quoteCodePoints * 2 ||
      Array.from(proposed).length > SOURCE_QUOTE_LIMITS.quoteCodePoints
    )
      return { reason: 'quote_missing' }
    const quote = proposed.trim().replace(/\s+/gu, ' ')
    if (!quote) return { reason: 'quote_missing' }
    const cached = cache.get(quote)
    if (cached) return copy(cached)
    let match: (typeof passages)[number] | undefined
    let result: SourceQuoteResolution = { reason: 'quote_missing' }
    for (const passage of passages) {
      const first = passage.normalized.indexOf(quote)
      if (first < 0) continue
      // Count overlapping and overlong-original-span occurrences too. Otherwise
      // a whitespace-heavy duplicate could silently select a different source.
      if (match || passage.normalized.indexOf(quote, first + 1) >= 0) {
        result = { reason: 'quote_ambiguous' }
        match = undefined
        break
      }
      match = passage
    }
    if (match) {
      const anchor = anchorSourceQuote(match.text, proposed)
      if (anchor && !anchor.ambiguous)
        result = {
          span: {
            source: match.source,
            start: anchor.start,
            end: anchor.end,
            text: anchor.quote,
            ambiguous: false,
          },
        }
    }
    if (cache.size >= 128) cache.delete(cache.keys().next().value!)
    cache.set(quote, result)
    return copy(result)
  }
}

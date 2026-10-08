import { describe, expect, it } from 'vitest'
import {
  anchorSourceQuote,
  expandSourceQuoteContext,
  SOURCE_QUOTE_LIMITS,
} from '@main/services/qa/sourceQuote'

describe('whitespace-tolerant original quote anchoring', () => {
  it('returns the original contiguous source and offsets after model line wrapping changes', () => {
    const source = '🧮 Mitglieder.\r\nÜber die Freigabe ist noch nicht entschieden.\nEnde.'
    const result = anchorSourceQuote(
      source,
      'Mitglieder. Über die Freigabe ist noch nicht entschieden.',
    )!
    expect(result).toEqual({
      quote: 'Mitglieder.\r\nÜber die Freigabe ist noch nicht entschieden.',
      start: source.indexOf('Mitglieder.'),
      end: source.indexOf('\nEnde.'),
      ambiguous: false,
    })
    expect(source.slice(result.start, result.end)).toBe(result.quote)
  })

  it.each([
    ['A\nB', 'A B'],
    ['A B', 'A\nB'],
    ['A\r\n\t  B', 'A\tB'],
    ['A\u00a0B', 'A B'],
    ['A\u202fB', 'A B'],
    ['A\n\nB', ' A  B '],
  ])('collapses only whitespace for %j and %j', (source, quote) => {
    expect(anchorSourceQuote(source, quote)?.quote).toBe(source)
  })

  it('prefers the first matching original location and flags differently wrapped duplicates', () => {
    const source = 'First: A\nB. Later: A B.'
    const result = anchorSourceQuote(source, 'A B')!
    expect(result).toEqual({ quote: 'A\nB', start: 7, end: 10, ambiguous: true })
  })

  it('counts overlapping locations as ambiguous', () => {
    expect(anchorSourceQuote('aaaa', 'aaa')).toEqual({
      quote: 'aaa',
      start: 0,
      end: 3,
      ambiguous: true,
    })
  })

  it.each([
    ['Approved fee is 84 EUR.', 'Approved fee is 96 EUR.'],
    ['The fee is not approved.', 'The fee is approved.'],
    ['A applies only after approval.', 'A applies ... approval.'],
    ['First A then B.', 'First B then A.'],
    ['Word A, word B.', 'Word A word B.'],
    ['Approved.', 'approved.'],
    ['A B', 'AB'],
    ['AB', 'A B'],
    ['A\u200bB', 'AB'],
    ['é', 'e\u0301'],
    ['Clause A. Important exception. Clause B.', 'Clause A. Clause B.'],
  ])('rejects non-whitespace changes or omissions: %j versus %j', (source, quote) => {
    expect(anchorSourceQuote(source, quote)).toBeNull()
  })

  it('preserves every intervening source character instead of joining disjoint hits', () => {
    const source = 'The value is 84.\nIt is not approved.\nThe proposed value is 96.'
    expect(anchorSourceQuote(source, 'The value is 84. The proposed value is 96.')).toBeNull()
    expect(anchorSourceQuote(source, source.replaceAll('\n', ' '))?.quote).toBe(source)
  })

  it('requires nonempty bounded quotations and bounded source input', () => {
    for (const quote of ['', ' \r\n\t', 'x'.repeat(SOURCE_QUOTE_LIMITS.quoteCodePoints + 1)])
      expect(anchorSourceQuote(quote, quote)).toBeNull()
    expect(anchorSourceQuote('x'.repeat(SOURCE_QUOTE_LIMITS.sourceChars + 1), 'x')).toBeNull()
  })

  it('applies the quotation limit to original source spans as well as model text', () => {
    expect(anchorSourceQuote(`A${' '.repeat(200)}B`, 'A B')).toBeNull()
    const source = `A${' '.repeat(200)}B. Later: A B`
    const result = anchorSourceQuote(source, 'A B')!
    expect(result.quote).toBe('A B')
    expect(result.start).toBe(source.lastIndexOf('A B'))
    expect(result.ambiguous).toBe(true)
  })

  it('uses decoded code points for limits but UTF-16 source offsets', () => {
    const quote = '🧮'.repeat(SOURCE_QUOTE_LIMITS.quoteCodePoints)
    const result = anchorSourceQuote(`Prefix: ${quote}`, quote)!
    expect(result.start).toBe(8)
    expect(result.end - result.start).toBe(400)
    expect(result.quote).toBe(quote)
    expect(anchorSourceQuote(`${quote}🧮`, `${quote}🧮`)).toBeNull()
  })
})

describe('bounded original quotation context', () => {
  it.each(['\n', '\r\n', '\r'])(
    'keeps antecedents and exceptions in one %j paragraph',
    (newline) => {
      const paragraph =
        `Approved on 2032-06-10, effective 2032-07-01.${newline}` +
        `From that date, the limit is four. Exceptions require written permission.`
      const source = `Other paragraph.${newline}${newline}${paragraph}${newline}${newline}Unrelated ending.`
      const anchor = anchorSourceQuote(source, 'From that date, the limit is four.')!
      const result = expandSourceQuoteContext(source, anchor)!
      expect(result.quote).toBe(paragraph)
      expect(source.slice(result.start, result.end)).toBe(paragraph)
      expect(result.start).toBeLessThan(anchor.start)
      expect(result.end).toBeGreaterThan(anchor.end)
      expect(anchor.quote).toBe('From that date, the limit is four.')
    },
  )

  it('preserves full literal table context without crossing paragraph boundaries', () => {
    const table = '| Name | Volume |\n| --- | --- |\n| A | 18 litres |\n| B | 24 litres |'
    const source = `Measurements:\n\n${table}\n\nUnrelated condition.`
    expect(expandSourceQuoteContext(source, anchorSourceQuote(source, '24 litres')!)?.quote).toBe(
      table,
    )
  })

  it.each(['```js', '~~~ts'])('does not guess code-block boundaries for %s', (fence) => {
    const source = `Code:\n\n${fence}\nfunction f(x) {\n\n  return x + 1;\n}\n${fence.slice(0, 3)}\n`
    const anchor = anchorSourceQuote(source, 'return x + 1;')!
    expect(expandSourceQuoteContext(source, anchor)).toEqual(anchor)
  })

  it('keeps an exact multi-paragraph anchor intact', () => {
    const source = 'Earlier.\n\nValue A.\n\nValue B.\n\nLater.'
    const anchor = anchorSourceQuote(source, 'Value A. Value B.')!
    expect(expandSourceQuoteContext(source, anchor)).toEqual(anchor)
  })

  it('bounds context by code points and falls back without clipping a long paragraph', () => {
    const exact = '🧮'.repeat(799) + 'X'
    const anchor = anchorSourceQuote(exact, 'X')!
    expect(expandSourceQuoteContext(exact, anchor)?.quote).toBe(exact)
    const oversized = '🧮'.repeat(800) + 'X'
    const short = anchorSourceQuote(oversized, 'X')!
    expect(expandSourceQuoteContext(oversized, short)).toEqual(short)
  })

  it('rejects stale or invalid anchors rather than expanding different source text', () => {
    const source = 'Original evidence.'
    const anchor = anchorSourceQuote(source, 'evidence')!
    expect(expandSourceQuoteContext('Changed evidence.', anchor)).toBeNull()
    expect(expandSourceQuoteContext(source, { ...anchor, start: -1 })).toBeNull()
    expect(expandSourceQuoteContext(source, { ...anchor, end: source.length + 1 })).toBeNull()
  })
})

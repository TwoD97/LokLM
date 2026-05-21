import { describe, it, expect } from 'vitest'
import { applyHighlights, findFuzzyHighlights } from './fuzzyHighlight'

describe('findFuzzyHighlights', () => {
  it('finds an exact substring match', () => {
    const chunk = 'The deadline is fourteen days from the notice date.'
    const ranges = findFuzzyHighlights(chunk, ['the deadline is fourteen days'])
    expect(ranges).toHaveLength(1)
    const r0 = ranges[0]!
    expect(chunk.slice(r0.start, r0.end).toLowerCase()).toContain('the deadline is fourteen days')
  })

  it('matches across casing and trailing punctuation', () => {
    const chunk = 'The DEADLINE is fourteen days.'
    const ranges = findFuzzyHighlights(chunk, ['the deadline is fourteen days'])
    expect(ranges.length).toBeGreaterThan(0)
  })

  it('returns [] when no shingle overlaps', () => {
    const chunk = 'Completely unrelated text about cats and kitchens.'
    expect(findFuzzyHighlights(chunk, ['the deadline is fourteen days'])).toEqual([])
  })

  it('returns [] for empty inputs', () => {
    expect(findFuzzyHighlights('', ['something'])).toEqual([])
    expect(findFuzzyHighlights('something', [])).toEqual([])
  })

  it('returns separate ranges for matches with too much unmatched text between them', () => {
    const chunk = 'Frist beträgt vierzehn Tage und der Bescheid ist schriftlich.'
    const ranges = findFuzzyHighlights(chunk, [
      'die Frist beträgt vierzehn Tage',
      'Bescheid ist schriftlich',
    ])
    expect(ranges.length).toBe(2)
    const a = chunk.slice(ranges[0]!.start, ranges[0]!.end)
    const b = chunk.slice(ranges[1]!.start, ranges[1]!.end)
    expect(a).toContain('vierzehn Tage')
    expect(b).toContain('schriftlich')
  })

  it('merges matches separated by only a short connector', () => {
    const chunk = 'one two three of four five six'
    const ranges = findFuzzyHighlights(chunk, ['one two three', 'four five six'])
    // " of " is 4 chars, below the merge gap threshold.
    expect(ranges.length).toBe(1)
    const r0 = ranges[0]!
    expect(chunk.slice(r0.start, r0.end)).toBe('one two three of four five six')
  })

  it('falls back to bigrams when snippet is too short for 3-grams', () => {
    const chunk = 'foo bar baz qux'
    // Snippet has only 2 tokens — strict 3-gram would never match.
    const ranges = findFuzzyHighlights(chunk, ['foo bar'])
    expect(ranges.length).toBe(1)
    const r0 = ranges[0]!
    expect(chunk.slice(r0.start, r0.end)).toBe('foo bar')
  })

  it('skips 1-char tokens so a stray "a" or "I" does not light up the page', () => {
    const chunk = 'a b c d e f g'
    expect(findFuzzyHighlights(chunk, ['a b c d e f g'])).toEqual([])
  })

  it('falls back to single tokens (len >= 5) when no n-gram matches — cross-language', () => {
    // Quiz explanation in German, PDF chunk in English. The only shared token
    // is "Frontier" (proper noun / loanword). 3-gram and 2-gram both miss; the
    // single-token fallback should still light "Frontier" up.
    const chunk = 'On each iteration we choose a node on the frontier with minimum value.'
    const ranges = findFuzzyHighlights(chunk, [
      'Die Frontier ist eine Prioritätsliste, in der die Knoten nach ihrer Bewertungsfunktion sortiert sind.',
    ])
    expect(ranges.length).toBe(1)
    const r0 = ranges[0]!
    expect(chunk.slice(r0.start, r0.end).toLowerCase()).toBe('frontier')
  })

  it('single-token fallback ignores short stopwords so it does not light everything up', () => {
    // No 3-gram / 2-gram overlap. The only "shared" tokens would be 3-char
    // German/English articles — should NOT light up under the len-5 filter.
    const chunk = 'Der Hund lief schnell und sprang über den Zaun.'
    const ranges = findFuzzyHighlights(chunk, ['the dog ran fast and jumped over the fence.'])
    expect(ranges).toEqual([])
  })
})

describe('applyHighlights', () => {
  it('returns the whole text as one plain segment when no ranges', () => {
    expect(applyHighlights('hello world', [])).toEqual([
      { text: 'hello world', highlighted: false },
    ])
  })

  it('splits text into alternating segments', () => {
    const segs = applyHighlights('hello world foo', [{ start: 6, end: 11 }])
    expect(segs).toEqual([
      { text: 'hello ', highlighted: false },
      { text: 'world', highlighted: true },
      { text: ' foo', highlighted: false },
    ])
  })

  it('omits leading plain segment when range starts at 0', () => {
    const segs = applyHighlights('hello world', [{ start: 0, end: 5 }])
    expect(segs).toEqual([
      { text: 'hello', highlighted: true },
      { text: ' world', highlighted: false },
    ])
  })
})

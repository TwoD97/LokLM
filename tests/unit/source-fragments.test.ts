import { describe, expect, it } from 'vitest'
import {
  createSourceExcerptMatcher,
  createSourceFragmentMatcher,
  isDisplayFragment,
} from '@main/services/qa/sourceFragments'

describe('exact display fragments', () => {
  it.each([
    { source: 'PRIVATE_SOURCE approved', fragment: 'PRIVATE_REJECTED.', detail: 'display' },
    { source: 'PRIVATE_SOURCE approved', fragment: 'PRIVATE_ABSENT', detail: 'missing' },
    { source: 'PRIVATE_SOURCE unapproved', fragment: 'approved', detail: 'boundary' },
    { source: 'PRIVATE_SOURCE 👩‍💻', fragment: '👩', detail: 'boundary' },
  ])(
    'reports only terminal $detail with identical no-sink and throwing-sink results',
    ({ source, fragment, detail }) => {
      const match = createSourceFragmentMatcher(source)
      const events: unknown[] = []
      const baseline = match(fragment)
      expect(baseline).toBeNull()
      expect(match(fragment, 160, (...args) => events.push(args))).toEqual(baseline)
      expect(events).toEqual([[detail]])
      expect(JSON.stringify(events)).not.toContain('PRIVATE')
      expect(
        match(fragment, 160, () => {
          throw new Error('PRIVATE_SINK')
        }),
      ).toEqual(baseline)
    },
  )

  it('does not report rejected earlier occurrences when a later occurrence is valid', () => {
    for (const source of ['unapproved; approved', 'unapproved; approved; approved']) {
      const match = createSourceFragmentMatcher(source)
      const events: unknown[] = []
      const baseline = match('approved')
      expect(baseline).not.toBeNull()
      expect(match('approved', 160, (...args) => events.push(args))).toEqual(baseline)
      expect(
        match('approved', 160, () => {
          throw new Error('PRIVATE_SINK')
        }),
      ).toEqual(baseline)
      expect(events).toEqual([])
    }
  })

  it.each([
    ['The number is 42.', '42'],
    ['Colour: amber; another colour: blue.', 'amber'],
    ['Value 2.75 litres is recorded.', '2.75 litres'],
    ['Dr. Vega records a value.', 'Dr. Vega'],
    ['For example, e.g. amber remains allowed.', 'e.g. amber'],
    ['The date is 2047-02-19.', '2047-02-19'],
    ['The signed value is −5.', '−5'],
    ['A non-binding draft exists.', 'non-binding draft'],
    ['The limit is not 5.', '5'],
    ['- amber\n- blue', 'amber'],
    ['Board archive — East record', 'East record'],
    ['East record — Board archive', 'East record'],
    ['The bound is ≤5.', '≤5'],
    ['The bound is >=5.', '>=5'],
  ])('keeps exact complete boundaries in %j', (source, fragment) => {
    const match = createSourceFragmentMatcher(source)(fragment)
    expect(match).not.toBeNull()
    expect(source.slice(match!.start, match!.end)).toBe(fragment)
  })

  it.each([
    ['reapproved', 'approved'],
    ['unapproved', 'approved'],
    ['amberish', 'amber'],
    ['non-binding', 'binding'],
    ['non-binding', 'non'],
    ['non - binding', 'binding'],
    ['non - binding', 'non'],
    ['member’s', 'member'],
    ['member’s', 's'],
    ['12.50', '12'],
    ['12.50', '50'],
    ['.50', '50'],
    ['1,500', '500'],
    ['1 , 500', '500'],
    ['1 , 500', '1'],
    ['5٫25', '5'],
    ['5٫25', '25'],
    ['5 ٫ 25', '25'],
    ['3\u202f500', '500'],
    ['3\u202f500', '3'],
    ['2047-02-19', '2047'],
    ['2047-02-19', '02'],
    ['2047-02-19', '19'],
    ['8–12', '12'],
    ['8 – 12', '8'],
    ['8 – 12', '12'],
    ['1 — 2', '1'],
    ['1 — 2', '2'],
    ['East—record', 'record'],
    ['East— record', 'record'],
    ['East —record', 'record'],
    ['−5', '5'],
    ['+ 5', '5'],
    ['$5', '5'],
    ['5 %', '5'],
    ['＋5', '5'],
    ['﹣5', '5'],
    ['5﹣2', '2'],
    ['≤5', '5'],
    ['>=5', '5'],
    ['>= 5', '5'],
    ['5 < 8', '5'],
    ['≈5', '5'],
    ['3*5', '5'],
    ['3 ^ 5', '5'],
    ['10:30', '10'],
    ['10 : 30', '30'],
    ['6/2', '2'],
    ['12×3', '3'],
    ['12 ⋅ 3', '3'],
    ['2:3', '2'],
    ['alpha_beta', 'alpha'],
    ['éclair', 'clair'],
    ['cafe\u0301', 'cafe'],
    ['non\u200dbinding', 'binding'],
    ['non\u200cbinding', 'binding'],
    ['👩‍💻', '👩'],
    ['👍🏽', '👍'],
    ['🇫🇷', '🇫'],
  ])('rejects a partial word, grapheme or numeric expression in %j', (source, fragment) => {
    expect(createSourceFragmentMatcher(source)(fragment)).toBeNull()
  })

  it('uses the first valid occurrence and only valid repeats establish ambiguity', () => {
    const source = 'reapproved; approved; unapproved; approved'
    const match = createSourceFragmentMatcher(source)('approved')!
    expect(match).toEqual({ start: 12, end: 20, text: 'approved', ambiguous: true })
    expect(createSourceFragmentMatcher('reapproved; approved; unapproved')('approved')).toEqual({
      start: 12,
      end: 20,
      text: 'approved',
      ambiguous: false,
    })
  })

  it.each([
    '',
    ' ',
    ' amber',
    'amber ',
    'a\nb',
    'a\rb',
    'a\u2028b',
    'a\u2029b',
    'Amber.',
    'Amber!',
    'Amber?',
    'Amber;',
    'Amber:',
    'Amber,',
    'Amber。',
    'Amber. Blue',
    'Amber? Blue',
    'Amber! Blue',
    'a\u0000b',
    'a\u202eb',
    '\ud800',
    '\udc00',
  ])('declines display ambiguity without rewriting %j', (value) => {
    expect(isDisplayFragment(value, 160)).toBe(false)
    expect(createSourceFragmentMatcher(value)(value)).toBeNull()
  })

  it('accepts only a complete filename title exception, not source filename fragments', () => {
    expect(isDisplayFragment('report.md', 64, true)).toBe(true)
    expect(isDisplayFragment('Meeting Notes.pdf', 64, true)).toBe(true)
    expect(isDisplayFragment('Meeting Notes.v2.pdf', 64, true)).toBe(true)
    expect(isDisplayFragment('Meeting Notes.pdf', 64)).toBe(false)
    expect(isDisplayFragment('report.md', 64)).toBe(false)
    expect(isDisplayFragment('Two sentences. More', 64, true)).toBe(false)
    expect(isDisplayFragment('Two sentences. More.pdf', 64, true)).toBe(false)
  })

  it('preserves unicode scalars, markup and exact bytes, with codepoint bounds', () => {
    const value = '👩‍💻 cafe\u0301 <tag> [doc:4, chunk:8] $x$ `literal`'
    expect(createSourceFragmentMatcher(value)(value)?.text).toBe(value)
    expect(createSourceFragmentMatcher('café')('cafe\u0301')).toBeNull()
    const emoji = '😀'.repeat(160)
    expect(createSourceFragmentMatcher(emoji)(emoji)).not.toBeNull()
    expect(createSourceFragmentMatcher(emoji + '😀')(emoji + '😀')).toBeNull()
  })
})

describe('exact selected excerpts and inline display subspans', () => {
  it.each([
    'The service interval is not 14 days.',
    'If approved, the interval is 14 days.',
    'The value is 3.5.',
    '3.5.',
    'Dr. Vega recorded amber.',
    'Die Frist ist nicht 14 Tage.',
    '👩‍💻 cafe\u0301 bleibt unverändert.',
    'The illustration is 👩‍💻.',
  ])('keeps exact original and derived bytes for %j', (text) => {
    const selected = createSourceExcerptMatcher(text)(text)!
    expect(selected).not.toBeNull()
    expect(selected.selected).toEqual({ start: 0, end: text.length, text, ambiguous: false })
    expect(selected.display).toEqual({
      start: 0,
      end: text.length - 1,
      text: text.slice(0, -1),
      ambiguous: false,
    })
    expect(createSourceFragmentMatcher(text)(selected.display.text)).toEqual(selected.display)
    expect(createSourceFragmentMatcher(text)(text)).toBeNull()
  })

  it.each(['3.5', 'not 14 days', 'amber coating', 'Dr. Vega', '👩‍💻 cafe\u0301'])(
    'leaves pre-existing admissible excerpts unchanged: %j',
    (text) => {
      const original = createSourceFragmentMatcher(text)(text)
      expect(createSourceExcerptMatcher(text)(text)).toEqual({
        selected: original,
        display: original,
      })
    },
  )

  it.each([
    'Amber!',
    'Amber?',
    'Amber…',
    'Amber...',
    'Amber..',
    'Amber。',
    'Amber. Blue.',
    'Amber? Blue.',
    'Amber! Blue.',
    ' Amber.',
    'Amber .',
    'Amber. ',
    'Amber\ncoating.',
    'Amber\u2028coating.',
    'Amber\u0000coating.',
    'Amber\u202ecoating.',
    '\ud800.',
    'Dr.',
    'The author is Dr.',
    'Use e.g.',
    'Zum Beispiel z. B.',
    'The author is A.',
    'The label is ABC.',
    'Other items etc.',
    'Weitere Punkte usw.',
    'The address is Long Str.',
    '3.',
    '-3.',
    'The file is report.md.',
  ])('declines ambiguous or invalid punctuation without repairing %j', (text) => {
    expect(createSourceExcerptMatcher(text)(text)).toBeNull()
  })

  it.each([
    ['The value is 3.5', 'The value is 3.'],
    ['The value is 3. 5', 'The value is 3.'],
    ['3.5.6', '3.5.'],
    ['amber.pdf', 'amber.'],
    ['amber...', 'amber.'],
    ['reapproved.', 'approved.'],
    ['non-binding.', 'binding.'],
    ['👩‍💻.', '💻.'],
    ['👍🏽.', '🏽.'],
  ])('checks the original and display boundaries together in %j', (source, excerpt) => {
    expect(createSourceExcerptMatcher(source)(excerpt)).toBeNull()
  })

  it('never pairs an earlier bare fragment with a later punctuated occurrence', () => {
    const source = 'amber; amber. amber.'
    const match = createSourceExcerptMatcher(source)('amber.')!
    expect(match.selected).toEqual({ start: 7, end: 13, text: 'amber.', ambiguous: true })
    expect(match.display).toEqual({ start: 7, end: 12, text: 'amber', ambiguous: true })
    expect(createSourceExcerptMatcher('amber; amber.')('amber.')!.display.ambiguous).toBe(false)
    const later = createSourceExcerptMatcher('reapproved. approved. unapproved.')('approved.')!
    expect(later.selected.start).toBe(12)
    expect(later.display.start).toBe(12)
    expect(later.selected.ambiguous).toBe(false)
  })

  it('requires the original period in the source and reports only fixed diagnostics', () => {
    const events: unknown[] = []
    const match = createSourceExcerptMatcher('PRIVATE_FRAGMENT')
    expect(match('PRIVATE_FRAGMENT.', 160, (...args) => events.push(args))).toBeNull()
    expect(events).toEqual([['missing']])
    expect(JSON.stringify(events)).not.toContain('PRIVATE')
    expect(
      match('PRIVATE_FRAGMENT.', 160, () => {
        throw new Error('PRIVATE_SINK')
      }),
    ).toBeNull()
  })

  it('keeps the original selected codepoint bound including the full stop', () => {
    const text = '😀'.repeat(159) + '.'
    expect(createSourceExcerptMatcher(text)(text)?.display.text).toBe('😀'.repeat(159))
    const tooLong = '😀' + text
    expect(createSourceExcerptMatcher(tooLong)(tooLong)).toBeNull()
  })
})

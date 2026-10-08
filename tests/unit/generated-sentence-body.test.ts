import { describe, expect, it } from 'vitest'
import { generatedSentenceBody } from '@main/services/qa/generatedSentenceBody'
import { createComparisonAnswerPlan } from '@main/services/qa/comparisonAnswer'
import {
  createSourceExcerptMatcher,
  createSourceFragmentMatcher,
  inlineSentenceBody,
} from '@main/services/qa/sourceFragments'

describe('bounded generated sentence body', () => {
  it.each([
    'Die beiden Fristen betragen 6 bzw. 9 Tage.',
    'Die Angaben betreffen die EU.',
    'The measurements use UTC.',
    'The selected label is A.',
    'Die beiden Fristen betragen 6, alternativ 9 Tage.',
    'Die Angaben betreffen die Region.',
    'Dr. Rowan nennt 3.5 Stunden bzw. ca. 210 Minuten.',
    'Die Regeln gelten z. B. für diese beiden Fälle.',
    'Die Notiz nennt u. a. diese beiden Werte.',
    'The examples, e.g. amber and blue, differ.',
    'The evidence, i.e. both supplied excerpts, is limited.',
    'Die Schreibweisen é und e\u0301 sowie 👩‍💻 bleiben erhalten.',
    'Der Wert ist ٣.٥.',
    'A\tB.',
  ])('preserves every generated character except the optional final stop: %s', (text) => {
    const body = text.slice(0, -1)
    expect(generatedSentenceBody(text, Array.from(text).length)).toBe(body)
    expect(generatedSentenceBody(body, Array.from(body).length)).toBe(body)
    expect(generatedSentenceBody(text, Array.from(text).length - 1)).toBeNull()
  })

  it.each([
    'Dr.',
    'Prof.',
    'Mr.',
    'Mrs.',
    'Ms.',
    'Sr.',
    'Jr.',
    'St.',
    'vs.',
    'etc.',
    'bspw.',
    'bzw.',
    'ca.',
    'ggf.',
    'inkl.',
    'zzgl.',
    'Nr.',
    'No.',
    'Abb.',
    'Abs.',
    'Art.',
    'vgl.',
    'usw.',
    'e.g.',
    'i.e.',
    'z. B.',
    'd. h.',
    'u. a.',
  ])('admits only declared abbreviation dots followed by prose: %s', (abbreviation) => {
    const text = `Angabe ${abbreviation} weitere Angaben`
    expect(generatedSentenceBody(text, 200)).toBe(text)
  })

  it.each([
    '',
    ' ',
    ' Text',
    'Text ',
    'Text. ',
    'Text .',
    'First. Second',
    'First. Second.',
    'First! Second.',
    'First? Second.',
    'Text...',
    'Text..',
    'Text…',
    'Text。',
    'Text！',
    'Text？',
    'Text;',
    'Text:',
    'Text,',
    'first\nsecond',
    'first\rsecond',
    'first\u2028second',
    'first\u2029second',
    'first\u0000second',
    'first\u202esecond',
    'first\u200bsecond',
    '\ud800',
    '\udc00',
    'An unknown abbr. continues',
    'prefixbzw. continues',
    'préfixébzw. continues',
    'A. New sentence.',
    'A. Danach folgt Text.',
    'EU. Danach folgt Text.',
    'The URL is example.invalid',
    'The filename is report.md.',
    'Recorded by Dr.',
    'Recorded by e.g.',
    'Recorded by z. B.',
    '5.',
  ])('rejects boundaries, undeclared dots and malformed text without repair: %j', (text) => {
    expect(generatedSentenceBody(text, 200)).toBeNull()
  })

  it('rejects invalid types and budgets without coercion', () => {
    for (const value of [undefined, null, 3, {}, ['text']])
      expect(generatedSentenceBody(value, 200)).toBeNull()
    for (const max of [NaN, Infinity, 0, -1, 1.5])
      expect(generatedSentenceBody('text', max)).toBeNull()
  })

  it('keeps the declared abbreviation ambiguity explicit rather than claiming sentence verification', () => {
    // The same lexical continuation rule admits German capitalized nouns and
    // cannot infer whether the author intended a sentence break after an
    // abbreviation. No semantic or universal one-sentence guarantee follows.
    expect(generatedSentenceBody('bzw. Danach folgt Text.', 200)).toBe('bzw. Danach folgt Text')
  })

  it.each([
    'Die Angaben betreffen die EU.',
    'The selected label is A.',
    'Die Fristen sind 6 bzw. 9 Tage.',
  ])('does not expand exact source/excerpt admission for %s', (text) => {
    expect(generatedSentenceBody(text, 160)).toBe(text.slice(0, -1))
    expect(inlineSentenceBody(text, 160)).toBeNull()
    expect(createSourceExcerptMatcher(text)(text)).toBeNull()
    expect(createSourceFragmentMatcher(text)(text)).toBeNull()
  })
})

describe('retired generated summary through the actual comparison parser', () => {
  it.each([
    'Die Angaben betreffen die EU.',
    'Die Werte sind 6 bzw. 9 Tage.',
    'The conflicting values are both binding.',
  ])('keeps the legacy prose helper separate from production summary admission: %s', (text) => {
    const input = [
      { document_id: 8, chunk_id: 81, document_title: 'One', text: 'The entry records one value.' },
    ]
    const original = structuredClone(input)
    const plan = createComparisonAnswerPlan('Compare the entries. Answer in one sentence.', input)!
    const raw = JSON.stringify({
      check: 'Check the evidence.',
      result: {
        resolution: 'comparison',
        summary: { text, sources: ['8:81'] },
        outcome: 'unresolved',
      },
    })
    expect(generatedSentenceBody(text, 160)).not.toBeNull()
    expect(plan.parse(raw, 'en', 512)).toBeNull()
    expect(input).toEqual(original)
    expect(plan.promptSourceText(8, 81)).toBe(input[0]!.text)
  })
})

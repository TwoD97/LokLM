import { describe, expect, it } from 'vitest'
import { extractCitationMarkers } from '@shared/citationMarkers'
import type { RetrievalHit } from '@shared/documents'
import { planGroundedAnswer } from '../evals/native-calibration/prototypes/groundedAnswerPlan'
import {
  parseGroundedAnswer,
  renderGroundedAnswer,
  GROUNDED_ANSWER_LIMITS,
  type GroundedAnswer,
} from '../evals/native-calibration/prototypes/groundedAnswer'

const passages = [
  {
    document_id: 7,
    chunk_id: 41,
    text: '🗒️ Draft A: 90 seconds. It is not approved.\r\nRetain both values.',
  },
  { document_id: 8, chunk_id: 42, text: 'Draft B: 1.5 minutes. Approval remains pending.' },
]
function proposal(): GroundedAnswer {
  return {
    evidence: [
      { source: '7:41', quote: '90 seconds.' },
      { source: '8:42', quote: '1.5 minutes.' },
    ],
    comparison: 'The stated durations convert to the same number of seconds.',
    status: 'answered',
    claims: [{ text: 'Both passages state the same duration.', sources: ['7:41', '8:42'] }],
  }
}
const parse = (value: unknown) => parseGroundedAnswer(JSON.stringify(value), passages)

describe('grounded answer structural quotation checks', () => {
  it('accepts exact quotes and returns intact original offsets without changing wire fields', () => {
    const value = proposal()
    const result = parse(value)!
    expect(result).toMatchObject(value)
    expect(result.evidenceSpans).toHaveLength(2)
    result.evidenceSpans.forEach((span, index) => {
      expect(span.source).toBe(value.evidence[index]!.source)
      expect(span.documentId).toBe(passages[index]!.document_id)
      expect(span.chunkId).toBe(passages[index]!.chunk_id)
      expect(passages[index]!.text.slice(span.start, span.end)).toBe(value.evidence[index]!.quote)
      expect(span.ambiguous).toBe(false)
    })
    expect(renderGroundedAnswer(result)).toBe(
      'Both passages state the same duration. [doc:7, chunk:41] [doc:8, chunk:42]',
    )
  })

  it('allows different quotes from the same passage for a value and its qualifier', () => {
    const value = proposal()
    value.evidence = [
      { source: '7:41', quote: '90 seconds.' },
      { source: '7:41', quote: 'It is not approved.' },
    ]
    value.claims = [{ text: 'The draft gives 90 seconds and is not approved.', sources: ['7:41'] }]
    expect(parse(value)?.evidenceSpans.map((span) => span.start)).toEqual([
      passages[0]!.text.indexOf('90 seconds.'),
      passages[0]!.text.indexOf('It is not approved.'),
    ])
  })

  it('permits duplicate text under different source IDs without assigning corroboration', () => {
    const value = proposal()
    value.evidence[1]!.quote = '90 seconds.'
    const result = parseGroundedAnswer(JSON.stringify(value), [
      passages[0]!,
      { ...passages[1]!, text: passages[0]!.text },
    ])
    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('verified')
  })

  it('marks repeated quote locations as ambiguous rather than claiming a unique span', () => {
    const value = proposal()
    const result = parseGroundedAnswer(JSON.stringify(value), [
      { ...passages[0]!, text: '90 seconds. Later: 90 seconds.' },
      passages[1]!,
    ])
    expect(result?.evidenceSpans[0]).toMatchObject({ start: 0, end: 11, ambiguous: true })
  })

  it('does not claim semantic support when a structurally valid claim is wrong', () => {
    const value = proposal()
    value.claims[0]!.text = 'The unapproved draft is the final authorized rule.'
    expect(parse(value)).not.toBeNull()
    // This is deliberately not an entailment/authority check.
  })

  it.each([
    null,
    [],
    1,
    'answer',
    {},
    { ...proposal(), status: { toString: 1, valueOf: 2 } },
    { ...proposal(), status: ['answered'] },
    { ...proposal(), status: 'verified' },
    { ...proposal(), comparison: 2 },
    { ...proposal(), extra: true },
    { ...proposal(), evidenceSpans: [] },
    { ...proposal(), evidence: {} },
    { ...proposal(), claims: [] },
    { ...proposal(), claims: [null] },
    { ...proposal(), evidence: [null] },
    { ...proposal(), claims: [{ text: ' ', sources: ['7:41'] }] },
    { ...proposal(), claims: [{ text: 'Claim', sources: [7] }] },
    { ...proposal(), claims: [{ text: 'Claim', sources: ['7:41', '7:41'] }] },
    { ...proposal(), claims: [{ text: 'Claim', sources: ['99:1'] }] },
    { ...proposal(), claims: [{ text: 'Claim', sources: [] }] },
    { ...proposal(), evidence: [{ source: '7:41', quote: '90 Seconds.' }] },
    { ...proposal(), evidence: [{ source: '7:41', quote: '90 seconds. ... not approved.' }] },
    { ...proposal(), evidence: [{ source: '7:41', quote: ' ' }] },
  ])('returns null for malformed/unsupported model records %#', (value) => {
    expect(() => parse(value)).not.toThrow()
    expect(parse(value)).toBeNull()
  })

  it.each(['0:41', '-7:41', '07:41', '7:041', '7:41 ', '7:4e1', '9007199254740992:41'])(
    'declines unsafe/noncanonical source ID %s',
    (source) => {
      const value = proposal()
      value.evidence[0]!.source = source
      value.claims[0]!.sources[0] = source
      expect(parse(value)).toBeNull()
    },
  )

  it('rejects duplicate evidence records but not different quotes from that source', () => {
    const value = proposal()
    value.evidence.push({ ...value.evidence[0]! })
    expect(parse(value)).toBeNull()
  })

  it('rejects duplicate JSON keys even when escaped or nested', () => {
    const raw = JSON.stringify(proposal())
    for (const changed of [
      raw.replace('"status":"answered"', '"status":"unresolved","status":"answered"'),
      raw.replace('"status":"answered"', '"sta\\u0074us":"missing","status":"answered"'),
      raw.replace('"source":"7:41"', '"source":"99:1","source":"7:41"'),
      raw.replace('"quote":"90 seconds."', '"quote":"invented","quote":"90 seconds."'),
    ])
      expect(parseGroundedAnswer(changed, passages)).toBeNull()
  })

  it.each(['', '{', '{"status":"unterminated', '{"x":[[[', 'undefined', '\u0000'])(
    'declines invalid JSON without attempting repairs %#',
    (raw) => {
      expect(parseGroundedAnswer(raw, passages)).toBeNull()
    },
  )

  it('allows missing answers with a topic quote and no fabricated claim citations', () => {
    const result = parse({
      evidence: [proposal().evidence[0]!],
      comparison: 'The passage gives a duration but does not state the requested cost.',
      status: 'missing',
      claims: [{ text: 'The supplied passages do not state that fact.', sources: [] }],
    })!
    expect(renderGroundedAnswer(result)).toBe('The supplied passages do not state that fact.')
  })

  it('rejects missing answers that omit required evidence or a nonempty comparison', () => {
    const value = {
      ...proposal(),
      status: 'missing',
      claims: [{ text: 'The fact is absent.', sources: [] }],
    }
    expect(parse({ ...value, evidence: [] })).toBeNull()
    for (const comparison of ['', ' ', '\r\n\t', '\u00a0']) {
      expect(parse({ ...value, comparison })).toBeNull()
    }
  })

  it('does not mutate frozen original passages', () => {
    const frozen = Object.freeze(passages.map((source) => Object.freeze({ ...source })))
    expect(parseGroundedAnswer(JSON.stringify(proposal()), frozen)).not.toBeNull()
    expect(frozen).toEqual(passages)
  })

  it('rejects duplicate or invalid supplied source IDs rather than choosing one', () => {
    const raw = JSON.stringify(proposal())
    expect(parseGroundedAnswer(raw, [...passages, { ...passages[0]! }])).toBeNull()
    expect(parseGroundedAnswer(raw, [...passages, { ...passages[0]!, chunk_id: 0 }])).toBeNull()
    expect(
      parseGroundedAnswer(raw, [
        ...passages,
        { ...passages[0]!, document_id: Number.MAX_SAFE_INTEGER + 1 },
      ]),
    ).toBeNull()
  })

  it('bounds raw, per-field, passage and aggregate input sizes', () => {
    expect(
      parseGroundedAnswer(' '.repeat(GROUNDED_ANSWER_LIMITS.rawChars + 1), passages),
    ).toBeNull()
    for (const value of [
      { ...proposal(), comparison: 'x'.repeat(GROUNDED_ANSWER_LIMITS.comparisonChars + 1) },
      {
        ...proposal(),
        claims: [{ text: 'x'.repeat(GROUNDED_ANSWER_LIMITS.claimChars + 1), sources: ['7:41'] }],
      },
      {
        ...proposal(),
        evidence: [{ source: '7:41', quote: 'x'.repeat(GROUNDED_ANSWER_LIMITS.quoteChars + 1) }],
      },
      { ...proposal(), claims: Array.from({ length: 5 }, () => proposal().claims[0]!) },
    ])
      expect(parse(value)).toBeNull()
    const raw = JSON.stringify(proposal())
    expect(
      parseGroundedAnswer(raw, [
        { ...passages[0]!, text: 'x'.repeat(GROUNDED_ANSWER_LIMITS.passageChars + 1) },
      ]),
    ).toBeNull()
    const many = Array.from({ length: GROUNDED_ANSWER_LIMITS.passages + 1 }, (_, i) => ({
      document_id: i + 1,
      chunk_id: 1,
      text: '',
    }))
    expect(parseGroundedAnswer(raw, many)).toBeNull()
    const large = Array.from({ length: 5 }, (_, i) => ({
      document_id: i + 1,
      chunk_id: 1,
      text: 'x'.repeat(GROUNDED_ANSWER_LIMITS.passageChars),
    }))
    expect(parseGroundedAnswer(raw, large)).toBeNull()
  })
})

describe('candidate C schema and parser bounds', () => {
  const hits: RetrievalHit[] = passages.map((passage) => ({
    ...passage,
    document_title: 'Source',
    score: 1,
    ordinal: 0,
    page_from: null,
    page_to: null,
    heading_path: null,
    language: 'en',
  }))

  it('agrees with the production grammar on field and array limits', () => {
    const schema = planGroundedAnswer('What duration is stated?', hits, 'en', 8192)!.jsonSchema
      .properties
    expect(schema.evidence.minItems).toBe(1)
    expect(schema.evidence.maxItems).toBe(GROUNDED_ANSWER_LIMITS.evidence)
    expect(schema.evidence.items.properties.quote).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: GROUNDED_ANSWER_LIMITS.quoteChars,
    })
    expect(schema.comparison).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: GROUNDED_ANSWER_LIMITS.comparisonChars,
    })
    expect(schema.claims.minItems).toBe(1)
    expect(schema.claims.maxItems).toBe(GROUNDED_ANSWER_LIMITS.claims)
    expect(schema.claims.items.properties.text).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: GROUNDED_ANSWER_LIMITS.claimChars,
    })
    expect(schema.claims.items.properties.sources.minItems).toBe(0)
    expect(schema.claims.items.properties.sources.maxItems).toBe(
      GROUNDED_ANSWER_LIMITS.claimSources,
    )
  })

  it.each(['x', '🧮'])(
    'accepts decoded string boundaries and rejects one extra code point: %s',
    (character) => {
      for (const field of ['quote', 'comparison', 'claim'] as const) {
        const limit =
          field === 'quote'
            ? GROUNDED_ANSWER_LIMITS.quoteChars
            : field === 'comparison'
              ? GROUNDED_ANSWER_LIMITS.comparisonChars
              : GROUNDED_ANSWER_LIMITS.claimChars
        for (const length of [limit, limit + 1]) {
          const text = character.repeat(length)
          const value = proposal()
          const sources = passages.map((source) => ({ ...source }))
          if (field === 'quote') {
            value.evidence[0]!.quote = text
            sources[0]!.text = `Original: ${text}\nEnd.`
          } else if (field === 'comparison') value.comparison = text
          else value.claims[0]!.text = text
          // Escaped JSON must be measured after decoding, not by escape bytes.
          const raw = JSON.stringify(value)
            .split('')
            .map((codeUnit) =>
              ['x', '\uD83E', '\uDDEE'].includes(codeUnit)
                ? `\\u${codeUnit.charCodeAt(0).toString(16).padStart(4, '0')}`
                : codeUnit,
            )
            .join('')
          const result = parseGroundedAnswer(raw, sources)
          if (length === limit) {
            expect(result).not.toBeNull()
            if (field === 'quote') {
              const span = result!.evidenceSpans[0]!
              expect(sources[0]!.text.slice(span.start, span.end)).toBe(text)
            }
          } else expect(result).toBeNull()
        }
      }
    },
  )
})

describe('program-rendered grounded citations', () => {
  it.each([
    'Claim [doc:99, chunk:1]',
    'Claim [DOC:99, chunk:1]',
    '[fake](#cite-99-1)',
    '[fake](&#35;cite-99-1)',
    '[fake](&#x23;cite-99-1)',
    '[fake](&num;cite-99-1)',
    '`[doc:99, chunk:1]`',
  ])('rejects citations embedded in model-authored text: %s', (text) => {
    const value = proposal()
    value.claims[0]!.text = text
    expect(parse(value)).toBeNull()
    expect(renderGroundedAnswer(value)).toBeNull()
    value.claims[0]!.text = 'Normal claim.'
    value.comparison = text
    expect(parse(value)).toBeNull()
  })

  it.each(['```text\nUnclosed code', '    Indented code', '<!-- hidden', '> ```\n> Nested code'])(
    'rejects Markdown that hides appended markers: %s',
    (text) => {
      const value = proposal()
      value.claims[0]!.text = text
      expect(parse(value)).toBeNull()
      expect(renderGroundedAnswer(value)).toBeNull()
    },
  )

  it('checks the entire render so code spanning separate claims cannot swallow citations', () => {
    const value = proposal()
    value.claims = [
      { text: 'First `', sources: ['7:41'] },
      { text: '` last.', sources: ['8:42'] },
    ]
    expect(renderGroundedAnswer(value)).toBeNull()
  })

  it('allows ordinary inline formatting and attaches markers in exact claim/source order', () => {
    const value = proposal()
    value.claims = [
      { text: 'The `duration` is **90 seconds**.', sources: ['8:42', '7:41'] },
      { text: 'The other source uses minutes.', sources: ['8:42'] },
    ]
    const rendered = renderGroundedAnswer(parse(value)!)!
    expect(extractCitationMarkers(rendered)).toEqual([
      { documentId: 8, chunkId: 42 },
      { documentId: 7, chunkId: 41 },
      { documentId: 8, chunkId: 42 },
    ])
    expect(rendered).toContain('`duration`')
  })

  it('revalidates mutable claim source IDs before rendering', () => {
    const result = parse(proposal())!
    result.claims[0]!.sources = ['99:1']
    expect(renderGroundedAnswer(result)).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  createComparisonAnswerPlan,
  COMPARISON_ANSWER_VERSION,
} from '@main/services/qa/comparisonAnswer'
import { findCitationMatches } from '@shared/citationMarkers'
import * as markers from '@shared/citationMarkers'

const sources = [
  {
    document_id: 1,
    chunk_id: 11,
    document_title: 'Private title',
    text: 'For test B, Cedar specifies 8 hours and Birch specifies 11 hours. This excerpt establishes no priority. The symbol is **amber** & <blue>. The amount is 18 hours, not 8.5 hours.',
  },
]
const question = 'Which applies? Answer in one short sentence.'
const fixture = () => createComparisonAnswerPlan(question, sources)!
const summary = () => ({
  scope: [{ text: 'test B', source: '1:11' }],
  alternatives: [
    { label: 'Cedar', value: '8 hours', source: '1:11' },
    { label: 'Birch', value: '11 hours', source: '1:11' },
  ],
  grounds: [
    {
      kind: 'priority',
      evidence: [{ text: 'This excerpt establishes no priority.', source: '1:11' }],
    },
  ],
})
const envelope = (result: unknown) => JSON.stringify({ check: 'PRIVATE_CHECK', result })
const response = (value: unknown = summary()) =>
  envelope({ resolution: 'comparison', summary: value, outcome: 'unresolved' })

describe('typed conflict summary contract', () => {
  it('keeps all original immutable passages and exposes no unrestricted body branch', () => {
    const input = sources.map((source) => ({ ...source }))
    const plan = createComparisonAnswerPlan(question, input)!
    expect(COMPARISON_ANSWER_VERSION).toBe('typed-comparison-v32')
    expect(plan.summaryMaxCodePoints).toBe(512)
    expect(plan.jsonSchema.properties.result.oneOf).toHaveLength(2)
    const schema = plan.jsonSchema.properties.result.oneOf[1]!
    expect(schema.properties).toHaveProperty('summary.required', [
      'scope',
      'alternatives',
      'grounds',
    ])
    expect(schema.properties).not.toHaveProperty('summary.properties.text')
    expect(schema.properties).toHaveProperty(
      'summary.properties.alternatives.items.properties.source.enum',
      ['1:11'],
    )
    const original = plan.parse(response(), 'en', 512)
    input[0]!.text = 'changed'
    input[0]!.document_id = 999
    expect(plan.promptSourceText(1, 11)).toBe(sources[0]!.text)
    expect(plan.parse(response(), 'en', 512)).toEqual(original)
    expect(() => plan.promptSourceText(999, 11)).toThrow('Unknown comparison passage')
  })

  it('supports two named alternatives within one passage with local citations', () => {
    const parsed = fixture().parse(response(), 'en', 512)!
    expect(parsed).not.toBeNull()
    expect(parsed.answer).toContain(
      '“Cedar” reports “8 hours” [doc:1, chunk:11] and “Birch” reports “11 hours”',
    )
    expect(findCitationMatches(parsed.answer)).toHaveLength(4)
    expect(parsed.answer).not.toContain('Private title')
    expect(parsed.answer).not.toContain('PRIVATE_CHECK')
  })

  it.each([null, '', 3, {}, { text: 'claimed binding value', sources: ['1:11'] }])(
    'rejects obsolete or malformed summaries %j',
    (value) => {
      expect(fixture().parse(response(value), 'en', 512)).toBeNull()
    },
  )

  it('rejects missing roles, additions, reordered fields, duplicate alternatives and issue categories', () => {
    const original = summary()
    const examples = [
      { ...original, prose: 'Both are binding' },
      { alternatives: original.alternatives, scope: original.scope, grounds: original.grounds },
      { ...original, scope: [] },
      { ...original, alternatives: original.alternatives.slice(0, 1) },
      { ...original, alternatives: [original.alternatives[0], original.alternatives[0]] },
      { ...original, grounds: [] },
      { ...original, grounds: [original.grounds[0], original.grounds[0]] },
      {
        ...original,
        grounds: [{ kind: 'universal_absence', evidence: original.grounds[0]!.evidence }],
      },
      { ...original, grounds: [{ kind: 'priority', evidence: [] }] },
      {
        ...original,
        alternatives: [
          { source: '1:11', label: 'Cedar', value: '8 hours' },
          original.alternatives[1],
        ],
      },
    ]
    for (const value of examples) expect(fixture().parse(response(value), 'en', 512)).toBeNull()
  })

  it.each([
    '8 hour',
    '5 hours',
    ' Cedar',
    'Cedar ',
    'Cedar\nBirch',
    'Cedar\u202e',
    '\ud800',
    '<script>bad</script>',
    '[doc:9, chunk:9]',
  ])('rejects invalid or unmatched exact values %j', (text) => {
    const value = summary()
    value.alternatives[0]!.value = text
    expect(fixture().parse(response(value), 'en', 512)).toBeNull()
  })

  it('keeps numeric matching conservative without source repair', () => {
    const input = [
      {
        ...sources[0]!,
        text: 'Scope B: Alpha reports 18 hours, Beta reports 8.5 hours; priority is unrecorded here.',
      },
    ]
    const value = {
      scope: [{ text: 'Scope B', source: '1:11' }],
      alternatives: [
        { label: 'Alpha', value: '8 hours', source: '1:11' },
        { label: 'Beta', value: '8.5 hours', source: '1:11' },
      ],
      grounds: [
        { kind: 'priority', evidence: [{ text: 'priority is unrecorded here.', source: '1:11' }] },
      ],
    }
    const plan = createComparisonAnswerPlan(question, input)!
    expect(plan.parse(response(value), 'en', 512)).toBeNull()
    value.alternatives[0]!.value = '18 hours'
    expect(plan.parse(response(value), 'en', 512)).not.toBeNull()
  })

  it('escapes exact source markup without creating source-authored HTML or citations', () => {
    const value = summary()
    value.alternatives[0]!.value = '**amber** & <blue>'
    const parsed = fixture().parse(response(value), 'en', 512)!
    expect(parsed.answer).toContain('“\\*\\*amber\\*\\* &amp; &lt;blue&gt;”')
    expect(findCitationMatches(parsed.answer)).toHaveLength(4)
    expect(parsed.displaySpans.some((span) => span.text === '**amber** & <blue>')).toBe(true)
  })

  it('rejects unknown evidence identities and duplicate JSON keys', () => {
    const value = summary()
    value.grounds[0]!.evidence[0]!.source = '9:99'
    expect(fixture().parse(response(value), 'en', 512)).toBeNull()
    const raw = response().replace('"kind":"priority"', '"kind":"approval","kind":"priority"')
    expect(fixture().parse(raw, 'en', 512)).toBeNull()
  })

  it.each(['en', 'de'] as const)(
    'enforces complete rendered bounds without clipping in %s',
    (language) => {
      const plan = fixture()
      const parsed = plan.parse(response(), language, 512)!
      const size = Array.from(parsed.answer).length
      expect(plan.parse(response(), language, size)).toEqual(parsed)
      expect(plan.parse(response(), language, size - 1)).toBeNull()
      const long = '😀'.repeat(160)
      const input = [{ ...sources[0]!, text: sources[0]!.text + ' ' + long }]
      const value = summary()
      value.scope = [
        { text: long, source: '1:11' },
        { text: long, source: '1:11' },
      ]
      expect(
        createComparisonAnswerPlan(question, input)!.parse(response(value), language, 32000),
      ).toBeNull()
    },
  )

  it('rejects altered marker placement and reports fixed categories without private values', () => {
    const finder = vi.spyOn(markers, 'findCitationMatches').mockReturnValue([])
    const details: string[] = []
    try {
      expect(
        fixture().parse(response(), 'en', 512, undefined, undefined, (detail) =>
          details.push(detail),
        ),
      ).toBeNull()
      expect(details).toEqual(['render_mismatch'])
    } finally {
      finder.mockRestore()
    }
    const value = summary()
    value.alternatives[0]!.value = 'PRIVATE_REJECTED_VALUE'
    const rejected: string[] = []
    expect(
      fixture().parse(response(value), 'en', 512, undefined, undefined, (detail) =>
        rejected.push(detail),
      ),
    ).toBeNull()
    expect(rejected).toEqual(['excerpt_missing'])
    expect(
      fixture().parse(response(value), 'en', 512, undefined, undefined, () => {
        throw new Error('PRIVATE_SINK')
      }),
    ).toBeNull()
  })

  it('does not confuse exact provenance with semantic entailment or complete coverage', () => {
    const value = summary()
    value.grounds[0]!.kind = 'approval'
    // Category support must fail independent semantic review despite fitting
    // the exact-evidence grammar. Likewise a bare numeric token can omit units.
    value.alternatives[0]!.value = '8'
    const parsed = fixture().parse(response(value), 'en', 512)!
    expect(parsed).not.toBeNull()
    expect(parsed.answer).toContain('these excerpts do not establish approval')
    expect(parsed.spans.some((span) => span.text === 'This excerpt establishes no priority.')).toBe(
      true,
    )
  })

  it('preserves ordinary/full behavior and every original passage', () => {
    const full = createComparisonAnswerPlan('Compare the records.', sources)!
    expect(full.comparisonMode).toBe('full')
    expect(full.summaryMaxCodePoints).toBeNull()
    expect(fixture().jsonSchema.properties.result.oneOf[0]).toEqual(
      full.jsonSchema.properties.result.oneOf[0],
    )
    const ordinary = envelope({
      resolution: 'answered',
      blocks: [{ text: 'A supported result.', sources: ['1:11'] }],
    })
    expect(fixture().parse(ordinary, 'de', 512)).toEqual(full.parse(ordinary, 'de', 512))
    const displayed = full.parse(
      envelope({ resolution: 'comparison', sources: ['1:11'], outcome: 'compatible' }),
      'en',
      512,
    )!
    expect(displayed.spans.map((span) => span.text)).toEqual(sources.map((source) => source.text))
    expect(full.parse(response(), 'en', 512)).toBeNull()
  })
})

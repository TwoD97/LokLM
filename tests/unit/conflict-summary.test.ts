import { describe, expect, it } from 'vitest'
import { createComparisonAnswerPlan } from '@main/services/qa/comparisonAnswer'
import { findCitationMatches } from '@shared/citationMarkers'

const sources = [
  {
    document_id: 1,
    chunk_id: 11,
    document_title: 'Opaque one.md',
    text: 'For apparatus BX cycle Z2, Cedar reports an interval of 8 hours. This excerpt records no approval signature or priority rule.',
  },
  {
    document_id: 2,
    chunk_id: 22,
    document_title: 'Opaque two.md',
    text: 'For apparatus BX cycle Z2, Birch reports an interval of 11 hours. This excerpt records no approval signature or priority rule.',
  },
]
const question =
  'Which interval governs apparatus BX cycle Z2? Give both alternatives and reasons. Answer in one short sentence.'
const summary = () => ({
  scope: [{ text: 'apparatus BX cycle Z2', source: '1:11' }],
  alternatives: [
    { label: 'Cedar', value: '8 hours', source: '1:11' },
    { label: 'Birch', value: '11 hours', source: '2:22' },
  ],
  grounds: [
    {
      kind: 'priority',
      evidence: sources.map((source) => ({
        text: 'This excerpt records no approval signature or priority rule.',
        source: `${source.document_id}:${source.chunk_id}`,
      })),
    },
  ],
})
const envelope = (value: unknown) =>
  JSON.stringify({
    check: 'Both intervals, attribution, documentary grounds and scope.',
    result: { resolution: 'comparison', summary: value, outcome: 'unresolved' },
  })
const plan = () => createComparisonAnswerPlan(question, sources)!

describe('evidence-bound conflict reporting', () => {
  const headedSources = () =>
    sources.map((source, index) => ({
      ...source,
      text: `${index === 0 ? '# Complete apparatus record Cedar' : '# Vollständiger Gerätevermerk Birch'}\n${source.text}`,
    }))
  const headingSummary = () => ({
    ...summary(),
    alternatives: summary().alternatives.map((alternative) => ({
      ...alternative,
      label: { kind: 'heading' },
    })),
  })

  it('selects complete headings from the cited bodies without translating or copying their names', () => {
    const original = headedSources()
    const captured = createComparisonAnswerPlan(question, original)!
    const before = structuredClone(original)
    original[0]!.text = '# Later replacement'
    original[0]!.document_title = 'A different filename.md'
    const parsed = captured.parse(envelope(headingSummary()), 'de', 512)!
    expect(parsed).not.toBeNull()
    expect(parsed.answer).toContain('„Complete apparatus record Cedar“ „8 hours“ [doc:1, chunk:11]')
    expect(parsed.answer).toContain(
      '„Vollständiger Gerätevermerk Birch“ nennt „11 hours“ [doc:2, chunk:22]',
    )
    expect(parsed.answer).not.toContain('Opaque')
    expect(parsed.answer).not.toContain('Later replacement')
    for (const span of parsed.spans) {
      const source = before.find(
        (entry) => `${entry.document_id}:${entry.chunk_id}` === span.source,
      )!
      expect(source.text.slice(span.start, span.end)).toBe(span.text)
    }
    const names = parsed.displaySpans.filter(
      (span) => span.text.includes('Cedar') || span.text.includes('Birch'),
    )
    expect(names.map((span) => span.start)).toEqual([2, 2])
    expect(findCitationMatches(parsed.answer)).toHaveLength(5)
  })

  it.each([
    '',
    'Plain source text\n',
    '```markdown\n# Literal heading\n```\n',
    '    # Indented code\n',
    '> # Quoted heading\n',
    '# One heading\n## Another heading\n',
    '# \n',
  ])('rejects unavailable or ambiguous heading selectors without guessing: %j', (prefix) => {
    const input = headedSources()
    input[0]!.text = prefix + sources[0]!.text
    const captured = createComparisonAnswerPlan(question, input)!
    const details: string[] = []
    expect(
      captured.parse(envelope(headingSummary()), 'de', 512, undefined, undefined, (reason) =>
        details.push(reason),
      ),
    ).toBeNull()
    expect(details).toEqual(['label_missing'])
    // An explicit valid entry fragment is still possible; heading selection
    // never erases the separate entry names or silently repairs a failure.
    expect(captured.parse(envelope(summary()), 'en', 512)).not.toBeNull()
  })

  it('retains exact heading spans after Markdown delimiters and escapes displayed markup', () => {
    const input = headedSources()
    input[0]!.text = `\r\n  ### **Cedar** & <amber> ###  \r\n${sources[0]!.text}`
    const parsed = createComparisonAnswerPlan(question, input)!.parse(
      envelope(headingSummary()),
      'en',
      512,
    )!
    expect(parsed).not.toBeNull()
    expect(parsed.answer).toContain('“\\*\\*Cedar\\*\\* &amp; &lt;amber&gt;”')
    const span = parsed.displaySpans.find((span) => span.text === '**Cedar** & <amber>')!
    expect(input[0]!.text.slice(span.start, span.end)).toBe(span.text)
  })

  it('rejects overlong complete headings and malformed selectors without clipping or fallback', () => {
    const input = headedSources()
    input[0]!.text = `# ${'A'.repeat(81)}\n${sources[0]!.text}`
    expect(
      createComparisonAnswerPlan(question, input)!.parse(envelope(headingSummary()), 'en', 512),
    ).toBeNull()
    for (const label of [
      null,
      {},
      { kind: 'title' },
      { kind: 'heading', text: 'Cedar' },
      { kind: 'heading', source: '2:22' },
    ]) {
      const value = headingSummary()
      Object.assign(value.alternatives[0]!, { label })
      expect(
        createComparisonAnswerPlan(question, headedSources())!.parse(envelope(value), 'en', 512),
      ).toBeNull()
    }
    const captured = createComparisonAnswerPlan(question, headedSources())!
    const parsed = captured.parse(envelope(headingSummary()), 'de', 512)!
    const length = Array.from(parsed.answer).length
    expect(captured.parse(envelope(headingSummary()), 'de', length)).toEqual(parsed)
    expect(captured.parse(envelope(headingSummary()), 'de', length - 1)).toBeNull()
  })

  it('requires explicit entry names when alternatives share one passage', () => {
    const input = [
      {
        ...sources[0]!,
        text: '# Apparatus paired entries\n' + sources.map((source) => source.text).join(' '),
      },
    ]
    const captured = createComparisonAnswerPlan(question, input)!
    const value = summary()
    value.alternatives[1]!.source = '1:11'
    value.grounds[0]!.evidence = [value.grounds[0]!.evidence[0]!]
    expect(captured.parse(envelope(value), 'en', 512)).not.toBeNull()
    const ambiguous = {
      ...value,
      alternatives: value.alternatives.map((alternative) => ({
        ...alternative,
        label: { kind: 'heading' },
      })),
    }
    expect(captured.parse(envelope(ambiguous), 'en', 512)).toBeNull()
    expect(
      captured.parse(
        envelope({ ...value, alternatives: [ambiguous.alternatives[0], value.alternatives[1]] }),
        'en',
        512,
      ),
    ).toBeNull()
  })

  it.each(['en', 'de'] as const)(
    'renders duplicated heading scopes once with their own label citations in %s',
    (language) => {
      const input = headedSources()
      const value = headingSummary()
      value.scope = [
        { text: 'Complete apparatus record Cedar', source: '1:11' },
        { text: 'Vollständiger Gerätevermerk Birch', source: '2:22' },
      ]
      const parsed = createComparisonAnswerPlan(question, input)!.parse(
        envelope(value),
        language,
        512,
      )!
      expect(parsed).not.toBeNull()
      expect(parsed.answer.split('Complete apparatus record Cedar')).toHaveLength(2)
      expect(parsed.answer.split('Vollständiger Gerätevermerk Birch')).toHaveLength(2)
      expect(parsed.answer).not.toMatch(/^(?:For|Zu) /u)
      expect(parsed.answer).toContain(
        language === 'de'
          ? '„Complete apparatus record Cedar“ nennt „8 hours“ [doc:1, chunk:11]'
          : '“Complete apparatus record Cedar” reports “8 hours” [doc:1, chunk:11]',
      )
      expect(parsed.spans).toHaveLength(8)
      expect(parsed.displaySpans).toHaveLength(4)
      expect(
        findCitationMatches(parsed.answer).map((marker) => [marker.documentId, marker.chunkId]),
      ).toEqual([
        [1, 11],
        [2, 22],
        [1, 11],
        [2, 22],
      ])
    },
  )

  it('retains nonduplicate scope and necessary units or qualifiers while removing only the identical label span', () => {
    const input = headedSources()
    const value = headingSummary()
    value.scope = [
      { text: 'Complete apparatus record Cedar', source: '1:11' },
      { text: 'apparatus BX cycle Z2', source: '1:11' },
      { text: 'interval of 8 hours', source: '1:11' },
    ]
    const parsed = createComparisonAnswerPlan(question, input)!.parse(envelope(value), 'en', 512)!
    expect(parsed).not.toBeNull()
    expect(parsed.answer).toMatch(
      /^For “apparatus BX cycle Z2” and “interval of 8 hours” \[doc:1, chunk:11\], /u,
    )
    expect(parsed.answer.split('Complete apparatus record Cedar')).toHaveLength(2)
    expect(parsed.spans).toHaveLength(9)
    expect(parsed.displaySpans).toHaveLength(6)
  })

  it('retains identical words attributed to a different source and never folds a partial label', () => {
    const input = sources.map((source) => ({ ...source }))
    input[1]!.text += ' Reference Cedar is separately scoped.'
    const captured = createComparisonAnswerPlan(question, input)!
    const value = summary()
    value.scope = [{ text: 'Cedar', source: '2:22' }]
    const parsed = captured.parse(envelope(value), 'en', 512)!
    expect(parsed.answer).toMatch(/^For “Cedar” \[doc:2, chunk:22\], “Cedar” reports/u)
    expect(parsed.displaySpans).toHaveLength(5)
    value.scope = [{ text: 'Cedar reports', source: '1:11' }]
    expect(captured.parse(envelope(value), 'en', 512)!.answer).toContain(
      'For “Cedar reports” [doc:1, chunk:11]',
    )
  })

  it('validates redundant scope before presentation and states uncertainty once within the cited excerpts', () => {
    const value = summary()
    value.scope = [{ text: 'Cedar', source: '1:11' }]
    const captured = plan()
    const parsed = captured.parse(envelope(value), 'en', 512)!
    expect(parsed.answer).toContain(
      '; because these excerpts do not establish priority, which statement governs remains unresolved',
    )
    expect(parsed.answer).not.toContain('(')
    value.scope = [{ text: 'Translated Cedar', source: '1:11' }]
    expect(captured.parse(envelope(value), 'en', 512)).toBeNull()
    value.scope = [{ text: 'Cedar', source: '99:999' }]
    expect(captured.parse(envelope(value), 'en', 512)).toBeNull()
  })

  it('renders the reported alternatives with program-owned documentary uncertainty', () => {
    const parsed = plan().parse(envelope(summary()), 'en', 512)!
    expect(parsed).not.toBeNull()
    expect(parsed.answer).toBe(
      'For “apparatus BX cycle Z2” [doc:1, chunk:11], “Cedar” reports “8 hours” [doc:1, chunk:11] and “Birch” reports “11 hours” [doc:2, chunk:22]; because these excerpts do not establish priority, which statement governs remains unresolved [doc:1, chunk:11] [doc:2, chunk:22].',
    )
    expect(parsed.spans.some((span) => span.text.endsWith('priority rule.'))).toBe(true)
    expect(parsed.displaySpans.some((span) => span.text.endsWith('priority rule.'))).toBe(false)
    for (const span of parsed.spans) {
      const original = sources.find(
        (source) => `${source.document_id}:${source.chunk_id}` === span.source,
      )!
      expect(original.text.slice(span.start, span.end)).toBe(span.text)
    }
  })

  it('rejects the previous free body that could call conflicting reported values binding', () => {
    expect(
      plan().parse(
        envelope({
          text: 'The binding interval is 8 hours for Cedar and 11 hours for Birch, with no priority documented',
          sources: ['1:11', '2:22'],
        }),
        'en',
        512,
      ),
    ).toBeNull()
  })

  it('does not admit invented applicability in any copied role', () => {
    for (const role of ['label', 'value'] as const) {
      const value = summary()
      value.alternatives[0]![role] = 'the binding interval is 8 hours'
      expect(plan().parse(envelope(value), 'en', 512)).toBeNull()
    }
    const value = summary()
    value.scope[0]!.text = 'these are binding intervals'
    expect(plan().parse(envelope(value), 'en', 512)).toBeNull()
  })

  it('rejects invented documentary evidence instead of emitting a claim of universal absence', () => {
    const value = summary()
    value.grounds[0]!.evidence[0]!.text = 'Approval never occurred.'
    expect(plan().parse(envelope(value), 'en', 512)).toBeNull()
  })

  it('retains German program language and evidence-scoped grounds', () => {
    const parsed = plan().parse(envelope(summary()), 'de', 512)!
    expect(parsed.answer).toContain('nennt „Cedar“ „8 hours“')
    expect(parsed.answer).toContain('weil diese Textstellen Vorrang nicht belegen')
    expect(parsed.answer).not.toContain('nie genehmigt')
    expect(Array.from(parsed.answer).length).toBeLessThanOrEqual(512)
    expect(findCitationMatches(parsed.answer)).toHaveLength(5)
  })
})

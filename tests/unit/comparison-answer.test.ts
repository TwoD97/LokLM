/** Structural passage membership is not semantic outcome validation. */
import { describe, expect, it } from 'vitest'
import { findCitationMatches } from '@shared/citationMarkers'
import {
  createComparisonAnswerPlan,
  COMPARISON_ANSWER_VERSION,
} from '@main/services/qa/comparisonAnswer'

const sources = [
  {
    document_id: 1,
    chunk_id: 10,
    document_title: 'Record A',
    text: '# Record A\r\n\r\nDraft A: the deadline is Monday.\r\nApproval is not recorded.',
  },
  {
    document_id: 2,
    chunk_id: 20,
    document_title: 'Record B',
    text: '# Record B\n\nDraft B: the deadline is Tuesday.\nApproval is not recorded.',
  },
]
const ids = ['1:10', '2:20']
const comparison = (change: Record<string, unknown> = {}) =>
  JSON.stringify({
    check: 'Compare the supplied statements.',
    result: { resolution: 'comparison', outcome: 'unresolved', sources: ids, ...change },
  })
const ordinary = (blocks: unknown) =>
  JSON.stringify({ check: 'Check the supplied facts.', result: { resolution: 'answered', blocks } })
const fixture = () => createComparisonAnswerPlan('What is the definitive deadline?', sources)!

describe('typed comparison v29', () => {
  it('uses the same all-fed catalog in all branches, with ordinary text before sources and no small record cap', () => {
    expect(COMPARISON_ANSWER_VERSION).toBe('typed-comparison-v32')
    const schema = fixture().jsonSchema
    expect(Object.keys(schema.properties)).toEqual(['check', 'result'])
    expect(schema.required).toEqual(['check', 'result'])
    expect(schema.properties.check).toEqual({ type: 'string', minLength: 1, maxLength: 120 })
    expect(schema.additionalProperties).toBe(false)
    const ordinary = schema.properties.result.oneOf[0]!
    expect(ordinary.properties).toHaveProperty('blocks.items.required', ['text', 'sources'])
    expect(ordinary.properties).toHaveProperty('blocks.items.properties.sources.items.enum', ids)
    expect(ordinary.properties).toHaveProperty('blocks.items.properties.sources.maxItems', 32)
    expect(ordinary.properties).not.toHaveProperty('blocks.maxItems')
    const fields =
      'blocks' in ordinary.properties ? ordinary.properties.blocks.items.properties : undefined
    expect(Object.keys(fields ?? {})).toEqual(['text', 'sources'])
    for (const branch of schema.properties.result.oneOf.slice(1)) {
      expect(branch.required).toEqual(['resolution', 'sources', 'outcome'])
      expect(Object.keys(branch.properties)).toEqual(['resolution', 'sources', 'outcome'])
      expect(branch.properties).toHaveProperty('sources.items.enum', ids)
      expect(branch.properties).toHaveProperty('sources.minItems', 1)
      expect(branch.properties).toHaveProperty('sources.maxItems', 4)
      expect(branch.properties).not.toHaveProperty('evidence')
    }
  })

  it('keeps comparison parsing and rendering independent of JSON property order', () => {
    const plan = fixture()
    const sourceFirst = JSON.stringify({
      check: 'Compare the supplied statements.',
      result: { resolution: 'comparison', sources: ids, outcome: 'unresolved' },
    })
    const earlierOutcomeFirst = comparison()
    const parsed = plan.parse(sourceFirst, 'en', 5000)
    expect(parsed).not.toBeNull()
    expect(parsed).toEqual(plan.parse(earlierOutcomeFirst, 'en', 5000))
    expect(parsed?.spans.map((span) => span.source)).toEqual(ids)
  })

  it('retains all32 supplied identities without question-specific filtering', () => {
    const catalog = Array.from({ length: 32 }, (_, i) => ({
      ...sources[0]!,
      document_id: i + 1,
      chunk_id: i + 101,
      text: 'Source ' + i,
    }))
    const plan = createComparisonAnswerPlan('Any topic.', catalog)!
    const all = catalog.map((s) => `${s.document_id}:${s.chunk_id}`)
    expect(plan.jsonSchema.properties.result.oneOf[0]!.properties).toHaveProperty(
      'blocks.items.properties.sources.items.enum',
      all,
    )
    for (const branch of plan.jsonSchema.properties.result.oneOf.slice(1))
      expect(branch.properties).toHaveProperty('sources.items.enum', all)
    expect(
      createComparisonAnswerPlan('Any topic.', [
        ...catalog,
        { ...sources[0]!, document_id: 99, chunk_id: 99 },
      ]),
    ).toBeNull()
    expect(
      plan.parse(ordinary([{ text: 'Source31.', sources: ['32:132'] }]), 'en', 5000)?.answer,
    ).toBe('Source31. [doc:32, chunk:132]')
  })

  it('preserves long ordinary Markdown and independently attached records without quote copying', () => {
    const text = 'A detailed explanation. '.repeat(100) + 'Monday.'
    const parsed = fixture().parse(
      ordinary([
        { text, sources: ['1:10'] },
        { text: 'Tuesday.', sources: ['2:20'] },
      ]),
      'en',
      5000,
    )!
    expect(parsed.answer).toBe(`${text} [doc:1, chunk:10]\n\nTuesday. [doc:2, chunk:20]`)
    expect(parsed).toMatchObject({ mode: 'answered', spans: [], displaySpans: [], derivations: [] })
    expect(
      findCitationMatches(
        fixture().parse(
          ordinary(Array.from({ length: 40 }, () => ({ text: 'Monday.', sources: ['1:10'] }))),
          'en',
          5000,
        )!.answer,
      ),
    ).toHaveLength(40)
  })

  it.each([
    '`[doc:9, chunk:90]` is a code example.',
    '```js\nconst x = 1\n```',
    '| x | y |\n|---|---|\n| 1 | 2 |',
  ])(
    'retains legitimate Markdown and program-owned citations after text-first generation: %s',
    (text) => {
      const parsed = fixture().parse(ordinary([{ text, sources: ids }]), 'en', 5000)!
      expect(parsed.answer).toContain(text)
      expect(findCitationMatches(parsed.answer).map((c) => `${c.documentId}:${c.chunkId}`)).toEqual(
        ids,
      )
    },
  )

  it.each([
    ['[label](', 'destination)'],
    ['$$\nx+y', '$$'],
  ])('rejects citation absorption assembled across ordinary records', (first, last) => {
    expect(
      fixture().parse(
        ordinary([
          { text: first, sources: ['1:10'] },
          { text: last, sources: ['2:20'] },
        ]),
        'en',
        5000,
      ),
    ).toBeNull()
  })

  it('does not claim that valid source selection entails an ordinary claim or comparison outcome', () => {
    expect(
      fixture().parse(
        ordinary([{ text: 'An unsupported unrelated claim.', sources: ['1:10'] }]),
        'en',
        5000,
      )?.answer,
    ).toBe('An unsupported unrelated claim. [doc:1, chunk:10]')
    const plan = createComparisonAnswerPlan('Is the machine safe?', [
      { ...sources[0]!, text: 'Unrelated cafeteria opening times.' },
    ])!
    expect(
      plan.parse(comparison({ outcome: 'compatible', sources: ['1:10'] }), 'en', 5000),
    ).toMatchObject({ mode: 'comparison', outcome: 'compatible' })
  })

  it.each(
    [[], ['9:90'], ['01:10'], ['0:10'], ['1:9007199254740992'], [1], '1:10'].map((value) => [
      value,
    ]),
  )('rejects invalid ordinary references %j', (value) => {
    expect(fixture().parse(ordinary([{ text: 'Monday.', sources: value }]), 'en', 5000)).toBeNull()
  })
  it.each(['[doc:1, chunk:10]', '[doc:1, chunk:10; doc:2, chunk:20]', '<script>hidden', '$$\nx+y'])(
    'does not let ordinary text forge or absorb markers: %s',
    (text) => {
      expect(fixture().parse(ordinary([{ text, sources: ['1:10'] }]), 'en', 5000)).toBeNull()
    },
  )
  it('rejects obsolete/free ordinary fields and sources-before-text', () => {
    for (const blocks of [
      [{ sources: ['1:10'], text: 'Monday.' }],
      [{ evidence: ['Monday.'], text: 'Monday.' }],
    ])
      expect(fixture().parse(ordinary(blocks), 'en', 5000)).toBeNull()
    expect(
      fixture().parse(
        JSON.stringify({ check: 'x', result: { resolution: 'answered', answer: 'Monday.' } }),
        'en',
        5000,
      ),
    ).toBeNull()
  })

  it('renders complete original passages with headers, newlines and qualifiers preserved', () => {
    const parsed = fixture().parse(comparison(), 'en', 5000)!
    expect(parsed.spans).toEqual(
      sources.map((s, i) => ({
        source: ids[i],
        start: 0,
        end: s.text.length,
        text: s.text,
        ambiguous: false,
      })),
    )
    expect(parsed.displaySpans).toEqual(parsed.spans)
    expect(findCitationMatches(parsed.answer).map((c) => [c.documentId, c.chunkId])).toEqual([
      [1, 10],
      [2, 20],
    ])
    expect(parsed.answer).toContain('Approval is not recorded')
    expect(parsed.answer).not.toContain('neither replaces')
  })
  it('permits a single passage containing both conflicting alternatives with one canonical reference', () => {
    const text =
      '# Schedule\n\nPlan A says Monday.\nPlan B says Tuesday.\nNo precedence is documented.'
    const plan = createComparisonAnswerPlan('Which date is definitive?', [
      { ...sources[0]!, text },
    ])!
    const parsed = plan.parse(comparison({ sources: ['1:10'] }), 'en', 5000)!
    expect(parsed).toMatchObject({ mode: 'comparison', outcome: 'unresolved' })
    expect(parsed.spans).toEqual([
      { source: '1:10', start: 0, end: text.length, text, ambiguous: false },
    ])
    expect(parsed.answer).toContain('Monday')
    expect(parsed.answer).toContain('Tuesday')
    expect(findCitationMatches(parsed.answer)).toHaveLength(1)
  })
  it.each(['compatible', 'unresolved', 'insufficient'])(
    'allows1–4 distinct sourceIDs for %s without a model rationale',
    (outcome) => {
      const plan = createComparisonAnswerPlan(
        'Compare.',
        Array.from({ length: 5 }, (_, i) => ({
          ...sources[0]!,
          document_id: i + 1,
          chunk_id: i + 1,
        })),
      )!
      for (const selected of [['1:1'], ['1:1', '2:2', '3:3', '4:4']])
        expect(
          plan.parse(comparison({ outcome, sources: selected }), 'en', 5000)?.spans,
        ).toHaveLength(selected.length)
      expect(
        plan.parse(
          comparison({ outcome, sources: ['1:1', '2:2', '3:3', '4:4', '5:5'] }),
          'en',
          5000,
        ),
      ).toBeNull()
      expect(plan.parse(comparison({ outcome, sources: [] }), 'en', 5000)).toBeNull()
      expect(
        plan.parse(
          comparison({ outcome, sources: ['1:1'], rationale: 'They certainly agree.' }),
          'en',
          5000,
        ),
      ).toBeNull()
    },
  )
  it.each([['9:90'], ['1:10', '1:10'], ['01:10'], [1], '1:10'].map((value) => [value]))(
    'rejects unknown duplicate or malformed comparisonIDs %j',
    (value) => {
      const reasons: string[] = []
      expect(
        fixture().parse(comparison({ sources: value }), 'en', 5000, (r) => reasons.push(r)),
      ).toBeNull()
      expect(reasons.length).toBe(1)
    },
  )
  it.each([
    { evidence: ['invented quote'] },
    { answer: 'invented prose' },
    { outcome: 'established' },
    { calculations: ['C1'] },
    { text: 'invented conclusion', sources: ids },
  ])('rejects model-written quotation/answer/calculation branch contamination %j', (extra) => {
    expect(fixture().parse(comparison(extra), 'en', 5000)).toBeNull()
  })
  it('permits identical full text under distinct source identities without inventing provenance', () => {
    const text = 'The retention period is thirty days.'
    const plan = createComparisonAnswerPlan(
      'Compare.',
      sources.map((s) => ({ ...s, text })),
    )!
    const parsed = plan.parse(comparison({ outcome: 'compatible' }), 'en', 5000)!
    expect(parsed.spans.map((s) => s.text)).toEqual([text, text])
    expect(findCitationMatches(parsed.answer).map((c) => c.documentId)).toEqual([1, 2])
  })
  it('rejects duplicate supplied IDs and pins original source bytes after planning', () => {
    expect(createComparisonAnswerPlan('Compare.', [sources[0]!, sources[0]!])).toBeNull()
    const copied = sources.map((s) => ({ ...s }))
    const plan = createComparisonAnswerPlan('Compare.', copied)!
    copied[0]!.text = 'Replaced source.'
    expect(plan.parse(comparison(), 'en', 5000)?.spans[0]?.text).toBe(sources[0]!.text)
  })
  it('rejects oversize source/display without truncation, and remains reusable after rejection', () => {
    expect(
      createComparisonAnswerPlan('Compare.', [{ ...sources[0]!, text: 'x'.repeat(64001) }]),
    ).toBeNull()
    const plan = createComparisonAnswerPlan('Compare.', [
      { ...sources[0]!, text: 'x'.repeat(32001) },
    ])!
    const reasons: string[] = []
    expect(
      plan.parse(comparison({ sources: ['1:10'] }), 'en', 32000, (r) => reasons.push(r)),
    ).toBeNull()
    expect(reasons).toEqual(['render'])
    // Escaping can push a bounded original beyond the display cap as well.
    const escaped = createComparisonAnswerPlan('Compare.', [
      { ...sources[0]!, text: '&'.repeat(7000) },
    ])!
    expect(escaped.parse(comparison({ sources: ['1:10'] }), 'en', 32000)).toBeNull()
    expect(fixture().parse(comparison(), 'en', 32000)).not.toBeNull()
  })
  it.each([0, -1, 1.5, NaN, Infinity, 32001])(
    'rejects an invalid caller answer bound %s',
    (bound) => {
      expect(fixture().parse(comparison(), 'en', bound)).toBeNull()
      expect(
        fixture().parse(ordinary([{ text: 'Monday.', sources: ['1:10'] }]), 'en', bound),
      ).toBeNull()
    },
  )
  it('uses the independent display cap for original comparisons while retaining the ordinary prose cap', () => {
    const text = 'Original source sentence. '.repeat(700)
    const plan = createComparisonAnswerPlan('Compare.', [{ ...sources[0]!, text }])!
    const result = plan.parse(comparison({ sources: ['1:10'] }), 'en', 1000)!
    expect(result.answer.length).toBeGreaterThan(13056)
    expect(result.spans[0]?.text).toBe(text)
    expect(
      plan.parse(ordinary([{ text: 'A'.repeat(1001), sources: ['1:10'] }]), 'en', 1000),
    ).toBeNull()
    expect(
      plan.parse(ordinary([{ text: 'A short answer.', sources: ['1:10'] }]), 'en', 1000),
    ).not.toBeNull()
  })
  it('rejects duplicate escaped JSON keys, misplaced check and raw overflow', () => {
    expect(
      fixture().parse(
        '{"check":"x","result":{"resolution":"comparison","outcome":"unresolved","sources":["1:10"],"sourc\\u0065s":["2:20"]}}',
        'en',
        5000,
      ),
    ).toBeNull()
    expect(
      fixture().parse(
        JSON.stringify({
          result: { resolution: 'comparison', outcome: 'unresolved', sources: ids },
          check: 'x',
        }),
        'en',
        5000,
      ),
    ).toBeNull()
    expect(fixture().parse(comparison() + ' '.repeat(256_001), 'en', 5000)).toBeNull()
  })
  it.each([
    '{"check":"x","result":{},"result":{"resolution":"comparison","sources":["1:10"],"outcome":"unresolved"}}',
    '{"check":"x","res\\u0075lt":{},"result":{"resolution":"comparison","sources":["1:10"],"outcome":"unresolved"}}',
    '{"check":"x","ch\\u0065ck":"y","result":{"resolution":"comparison","sources":["1:10"],"outcome":"unresolved"}}',
  ])('rejects duplicate result keys rather than accepting the overwritten valid branch', (raw) => {
    const reasons: string[] = []
    expect(fixture().parse(raw, 'en', 5000, (reason) => reasons.push(reason))).toBeNull()
    expect(reasons).toEqual(['json'])
  })
  it.each(['extra', 'confidence'])(
    'rejects the otherwise valid result when the envelope adds %s',
    (key) => {
      const value = JSON.parse(ordinary([{ text: 'Monday.', sources: ['1:10'] }]))
      expect(fixture().parse(JSON.stringify(value), 'en', 5000)).not.toBeNull()
      const reasons: string[] = []
      expect(
        fixture().parse(JSON.stringify({ [key]: 'PRIVATE', ...value }), 'en', 5000, (reason) =>
          reasons.push(reason),
        ),
      ).toBeNull()
      expect(reasons).toEqual(['envelope'])
    },
  )
  it.each([undefined, null, 1, '', ' ', 'x'.repeat(121), '🙂'.repeat(121)])(
    'rejects missing or invalid private check %j',
    (check) => {
      const result = JSON.parse(ordinary([{ text: 'Monday.', sources: ['1:10'] }])).result
      const reasons: string[] = []
      expect(
        fixture().parse(JSON.stringify({ check, result }), 'en', 5000, (reason) =>
          reasons.push(reason),
        ),
      ).toBeNull()
      expect(reasons).toEqual(['envelope'])
    },
  )
  it('accepts120 Unicode check codepoints without publishing them', () => {
    const result = JSON.parse(ordinary([{ text: 'Monday.', sources: ['1:10'] }])).result
    expect(
      fixture().parse(JSON.stringify({ check: '🙂'.repeat(120), result }), 'en', 5000)?.answer,
    ).toBe('Monday. [doc:1, chunk:10]')
  })
  it.each([undefined, null, [], 'PRIVATE_RESULT'])(
    'rejects a missing or malformed result even with a valid check: %j',
    (result) => {
      const reasons: string[] = []
      expect(
        fixture().parse(
          JSON.stringify({ check: 'Valid bounded check.', result }),
          'en',
          5000,
          (r) => reasons.push(r),
        ),
      ).toBeNull()
      expect(reasons).toEqual(['envelope'])
    },
  )
  it('reports only a fixed rejection category rather than unknown source content', () => {
    const reasons: string[] = []
    expect(
      fixture().parse(comparison({ sources: ['PRIVATE'] }), 'en', 5000, (r) => reasons.push(r)),
    ).toBeNull()
    expect(reasons).toEqual(['source'])
    expect(JSON.stringify(reasons)).not.toContain('PRIVATE')
  })
  it.each([
    { blocks: [{ sources: ['1:10'], text: 'Monday.' }], detail: 'source_order' },
    {
      blocks: [{ text: 'Monday.', sources: ['1:10'], privateExtra: 'PRIVATE_EXTRA' }],
      detail: 'record_shape',
    },
    {
      blocks: [{ text: 'Monday.', sources: Array<string>(33).fill('1:10') }],
      detail: 'sources_shape',
    },
    { blocks: [{ text: 'PRIVATE_BODY', sources: ['PRIVATE_SOURCE'] }], detail: 'source_unknown' },
    {
      blocks: [{ text: 'PRIVATE_BODY [doc:1, chunk:10]', sources: ['1:10'] }],
      detail: 'citation_syntax',
    },
    { blocks: [{ text: '$$\nx + y', sources: ['1:10'] }], detail: 'citation_placement' },
  ])('preserves broad answer rejection with fixed detail $detail', ({ blocks, detail }) => {
    const broad: string[] = []
    const details: unknown[] = []
    const raw = ordinary(blocks)
    expect(fixture().parse(raw, 'en', 5000)).toBeNull()
    expect(
      fixture().parse(
        raw,
        'en',
        5000,
        (reason) => broad.push(reason),
        (...args) => details.push(args),
      ),
    ).toBeNull()
    expect(broad).toEqual(['answer'])
    expect(details).toEqual([[detail]])
    expect(JSON.stringify({ broad, details })).not.toContain('PRIVATE')
  })
  it.each([
    { blocks: [{ sources: ['1:10'], text: 'Monday.' }] },
    { blocks: [{ text: 'Claim [doc:1, chunk:10].', sources: ['1:10'] }] },
  ])('keeps the broad rejection when a detail sink throws', ({ blocks }) => {
    const broad: string[] = []
    expect(
      fixture().parse(
        ordinary(blocks),
        'en',
        5000,
        (reason) => broad.push(reason),
        () => {
          throw new Error('Sink failure')
        },
      ),
    ).toBeNull()
    expect(broad).toEqual(['answer'])
  })
  it('parses repeated ordinary attachments through the current captured plan without changing comparison admission', () => {
    const plan = fixture()
    const raw = ordinary([
      {
        text: 'The two records state different deadlines.',
        sources: ['2:20', '1:10', '2:20', '1:10'],
      },
      { text: 'The first states Monday.', sources: ['1:10', '1:10'] },
    ])
    const broad: string[] = []
    const details: string[] = []
    const parsed = plan.parse(
      raw,
      'en',
      5000,
      (reason) => broad.push(reason),
      (reason) => details.push(reason),
    )
    expect(parsed?.mode).toBe('answered')
    expect(parsed?.answer).toBe(
      'The two records state different deadlines. [doc:2, chunk:20] [doc:1, chunk:10]\n\n' +
        'The first states Monday. [doc:1, chunk:10]',
    )
    expect(broad).toEqual([])
    expect(details).toEqual([])
    const oneSourcePlan = createComparisonAnswerPlan('What does this record say?', [sources[0]!])!
    expect(
      oneSourcePlan.parse(ordinary([{ text: 'Monday.', sources: ['1:10', '1:10'] }]), 'en', 1000)
        ?.answer,
    ).toBe('Monday. [doc:1, chunk:10]')
    expect(plan.parse(comparison({ sources: ['1:10', '1:10'] }), 'en', 5000)).toBeNull()
    expect(
      plan.parse(ordinary([{ sources: ['1:10', '1:10'], text: 'Monday.' }]), 'en', 5000),
    ).toBeNull()
    expect(
      plan.parse(
        '{"check":"Valid.","result":{"resolution":"answered","blocks":[{"text":"Monday.","sources":["1:10"],"sources":["1:10","1:10"]}]}}',
        'en',
        5000,
      ),
    ).toBeNull()
    expect(
      plan.parse(ordinary([{ text: 'Monday.', sources: ['1:10', '1:10', '9:90'] }]), 'en', 5000),
    ).toBeNull()
  })

  it('does not emit ordinary details for comparison failures or valid responses', () => {
    const broad: string[] = []
    const details: string[] = []
    const plan = fixture()
    const onBroad = (reason: string) => broad.push(reason)
    const onDetail = (reason: string) => details.push(reason)
    expect(
      plan.parse(comparison({ sources: ['PRIVATE'] }), 'en', 5000, onBroad, onDetail),
    ).toBeNull()
    expect(plan.parse(comparison(), 'en', 5000, onBroad, onDetail)).not.toBeNull()
    const raw = ordinary([{ text: 'Monday.', sources: ['1:10'] }])
    expect(plan.parse(raw, 'en', 5000, onBroad, onDetail)).toEqual(plan.parse(raw, 'en', 5000))
    expect(broad).toEqual(['source'])
    expect(details).toEqual([])
  })
  it('renders source syntax literally with only program-owned active markers', () => {
    const text =
      '# Header\n\n[link](https://example.invalid) [doc:999, chunk:999] `code` <b>x</b> &lt;tag&gt;'
    const plan = createComparisonAnswerPlan('Compare.', [{ ...sources[0]!, text }])!
    const parsed = plan.parse(comparison({ sources: ['1:10'] }), 'en', 5000)!
    expect(parsed.spans[0]?.text).toBe(text)
    expect(parsed.answer).toContain('\\[doc\\:999, chunk\\:999\\]')
    expect(parsed.answer).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(findCitationMatches(parsed.answer).map((c) => c.documentId)).toEqual([1])
  })
  it('renders all known code results from selected sources, never invented model calculations', () => {
    const pair = [
      { ...sources[0]!, text: '~~~js\nfunction cap(x) { return Math.min(8,x); }\n~~~' },
      { ...sources[1]!, text: '~~~js\nfunction cap(x) { return Math.min(9,x); }\n~~~' },
      {
        document_id: 3,
        chunk_id: 30,
        document_title: 'Other',
        text: '~~~js\nfunction cap(x) { return Math.min(99,x); }\n~~~',
      },
    ]
    const plan = createComparisonAnswerPlan('What does cap(10) return?', pair)!
    expect(plan.parse(comparison(), 'en', 5000)?.derivations.map((r) => r.expression)).toEqual([
      'cap(10) = 8',
      'cap(10) = 9',
    ])
    expect(plan.parse(comparison({ calculations: ['C999'] }), 'en', 5000)).toBeNull()
  })
  it('preserves conversions from whole selected passages without certifying scope or authority', () => {
    const pair = [
      { ...sources[0]!, text: 'Duration is 90 seconds.' },
      { ...sources[1]!, text: 'Duration is 1.5 minutes.' },
    ]
    const plan = createComparisonAnswerPlan('Compare durations in seconds.', pair)!
    const parsed = plan.parse(comparison({ outcome: 'compatible' }), 'en', 5000)!
    expect(parsed.derivations.map((r) => r.expression)).toEqual([
      '90 seconds = 90 s',
      '1.5 minutes = 90 s',
    ])
    expect(parsed.answer).toContain('can be read consistently')
    // Semantic conflict decisions remain model choices; parser cannot prove scope.
    expect(plan.parse(comparison(), 'en', 5000)?.outcome).toBe('unresolved')
  })
  it('does not drop derived results after sixteen selected quantities', () => {
    const pair = [
      {
        ...sources[0]!,
        text: 'Recorded: ' + Array.from({ length: 17 }, (_, i) => `${i + 1} s`).join('; ') + '.',
      },
      { ...sources[1]!, text: 'Recorded: 20 s.' },
    ]
    const plan = createComparisonAnswerPlan('Compare durations.', pair)!
    const parsed = plan.parse(comparison(), 'en', 5000)!
    expect(parsed.derivations).toHaveLength(18)
    expect(findCitationMatches(parsed.answer)).toHaveLength(20)
  })
  it('scopes insufficient-evidence wording to supplied excerpts', () => {
    const parsed = fixture().parse(
      comparison({ outcome: 'insufficient', sources: ['1:10'] }),
      'en',
      5000,
    )!
    expect(parsed.answer).toContain('does not establish what the rest of the document contains')
    expect(parsed.spans).toHaveLength(1)
  })
})

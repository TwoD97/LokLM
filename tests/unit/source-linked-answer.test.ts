import { describe, expect, it } from 'vitest'
import { findCitationMatches, removeRedundantSourceLabels } from '@shared/citationMarkers'
import {
  renderSourceLinkedAnswer,
  type SourceLinkedAnswerRejection,
} from '@shared/sourceLinkedAnswer'

const supplied = new Set(['1:10', '2:20'])
const block = (text: string, sources = ['1:10']) => ({ text, sources })
const render = (blocks: unknown, limit = 32_000) =>
  renderSourceLinkedAnswer(blocks, supplied, limit)

describe('source-linked answer rejection diagnostics', () => {
  const cases: Array<{
    reason: SourceLinkedAnswerRejection
    input: unknown
    limit?: number
    sources?: ReadonlySet<string>
  }> = [
    { reason: 'record_shape', input: [{ text: 7, sources: ['1:10'] }] },
    { reason: 'sources_shape', input: [block('Text.', [])] },
    { reason: 'sources_shape', input: [{ text: 'Text.', sources: [7] }] },
    { reason: 'source_unknown', input: [block('Text.', ['9:90'])] },
    {
      reason: 'source_invalid',
      input: [block('Text.', ['0:10'])],
      sources: new Set(['0:10']),
    },
    { reason: 'text_bounds', input: [block('A'.repeat(101))], limit: 100 },
    { reason: 'text_empty', input: [block(' \n\t')] },
    { reason: 'source_label_unattached', input: [block('The policy (doc:9:90) applies.')] },
    { reason: 'source_label_malformed', input: [block('The policy (doc:1:) applies.')] },
    { reason: 'source_label_ambiguous', input: [block('An "unfinished quote (doc:1:10).')] },
    { reason: 'source_label_placement', input: [block('word(doc:1:10)word')] },
    { reason: 'citation_syntax', input: [block('Claim [doc:1, chunk:10].')] },
    { reason: 'html_syntax', input: [block('<script>hidden')] },
    { reason: 'reserved_href', input: [block('Reserved #cite-1-10 target')] },
    { reason: 'render_bounds', input: [block('A')], limit: 1 },
    { reason: 'citation_placement', input: [block('$$\nx + y')] },
    {
      reason: 'citation_placement',
      input: [block('[label]('), block('destination)')],
    },
  ]

  it.each(cases)(
    'reports $reason without changing rejection',
    ({ reason, input, limit, sources }) => {
      const details: SourceLinkedAnswerRejection[] = []
      expect(renderSourceLinkedAnswer(input, sources ?? supplied, limit ?? 32_000)).toBeNull()
      expect(
        renderSourceLinkedAnswer(input, sources ?? supplied, limit ?? 32_000, (detail) => {
          details.push(detail)
        }),
      ).toBeNull()
      expect(details).toEqual([reason])
    },
  )

  it('reports only the first failure in the existing validation order without private values', () => {
    const privateSource = 'PRIVATE_SOURCE_VALUE'
    const privateText = 'PRIVATE_BODY <script>hidden'
    const details: unknown[] = []
    expect(
      renderSourceLinkedAnswer(
        [block(privateText, [privateSource]), block('Claim [doc:1, chunk:10].')],
        supplied,
        32_000,
        (...args) => details.push(args),
      ),
    ).toBeNull()
    expect(details).toEqual([['source_unknown']])
    expect(JSON.stringify(details)).not.toContain(privateSource)
    expect(JSON.stringify(details)).not.toContain(privateText)
  })

  it('keeps rejection unchanged when the diagnostic sink throws', () => {
    expect(
      renderSourceLinkedAnswer([block('Claim [doc:1, chunk:10].')], supplied, 32_000, () => {
        throw new Error('Sink failure')
      }),
    ).toBeNull()
  })

  it('does not call the sink or change valid literal Markdown and source attachments', () => {
    const input = [block('`[doc:9, chunk:90]` is a code example.', ['1:10', '2:20'])]
    const details: SourceLinkedAnswerRejection[] = []
    const result = renderSourceLinkedAnswer(input, supplied, 32_000, (detail) =>
      details.push(detail),
    )
    expect(result).toBe(render(input))
    expect(result).toBe(
      '`[doc:9, chunk:90]` is a code example. [doc:1, chunk:10] [doc:2, chunk:20]',
    )
    expect(details).toEqual([])
  })
})

describe('source-linked answer record rendering', () => {
  it('preserves prose and ordered source choices without copying model citation syntax', () => {
    const result = render([
      block('The first result is six.'),
      block('The second result is seven.', ['2:20']),
      block('Deployment is not established by these excerpts.', ['2:20', '1:10']),
    ])!
    expect(result).toBe(
      'The first result is six. [doc:1, chunk:10]\n\n' +
        'The second result is seven. [doc:2, chunk:20]\n\n' +
        'Deployment is not established by these excerpts. [doc:2, chunk:20] [doc:1, chunk:10]',
    )
    expect(findCitationMatches(result).map((marker) => marker.documentId)).toEqual([1, 2, 2, 1])
  })

  it.each([
    undefined,
    null,
    'text',
    [],
    [null],
    [{ text: 'Uncited.' }],
    [block('')],
    [block(' \n\t')],
    [block('Text.', [])],
    [block('Text.', ['9:90'])],
    [block('Text.', ['0:10'])],
    [block('Text.', ['01:10'])],
    [block('Text.', ['9007199254740992:10'])],
    [{ text: 7, sources: ['1:10'] }],
    [{ text: 'Text.', sources: [1] }],
    [{ text: 'Text.', sources: ['1:10'], rationale: 'extra' }],
  ])('rejects malformed records or unsupported source identities: %j', (input) => {
    expect(render(input)).toBeNull()
  })

  it.each([0, -1, 1.5, NaN, Infinity, 32_001])('rejects invalid aggregate limit %s', (limit) => {
    expect(render([block('Text.')], limit)).toBeNull()
  })

  it('bounds the final render including citation overhead using code points', () => {
    const exact = '🧮 [doc:1, chunk:10]'
    expect(render([block('🧮')], Array.from(exact).length)).toBe(exact)
    expect(render([block('🧮')], Array.from(exact).length - 1)).toBeNull()
    expect(render([block('A'), block('B')], 20)).toBeNull()
  })

  it('does not impose a small record or prose-length ceiling', () => {
    const many = Array.from({ length: 100 }, (_, index) => block(`Result ${index}.`))
    expect(findCitationMatches(render(many)!)).toHaveLength(100)
    expect(render([block('Long requested explanation. '.repeat(250))])).not.toBeNull()
  })

  it.each([
    'A claim [doc:1, chunk:10].',
    'A claim [doc:0, chunk:10].',
    'A claim [doc:9007199254740992, chunk:10].',
    'A claim [doc:1, chunk:10; doc:2, chunk:20].',
    'A claim [doc:1, chunk:',
    'A claim [doc:',
    'A claim [DOC:1, chunk:10].',
    '[Source](#cite-1-10)',
    '<a href="#cite-1-10">Source</a>',
  ])('rejects model-authored active citation material: %s', (text) => {
    expect(render([block(text)])).toBeNull()
  })

  it.each([
    '`[doc:99, chunk:99]` is literal code.',
    '`[doc:1, chunk:10; doc:2, chunk:20]` is a literal grouped example.',
    '\\[doc:99, chunk:99] is escaped source text.',
    '[doc:99, chunk:99](https://example.invalid) is an ordinary link.',
    '```txt\n[doc:99, chunk:99]\n```',
    '    [doc:99, chunk:99]\n    literal code',
    '<!-- [doc:99, chunk:99] -->\nThe comment is not an active citation.',
  ])('preserves literal marker examples without inventing evidence: %s', (text) => {
    const result = render([block(text)])!
    expect(result).toContain(text.trimEnd())
    expect(findCitationMatches(result).map((marker) => marker.documentId)).toEqual([1])
  })

  it.each([
    '```txt\nAn unclosed fence',
    '~~~\nAn unclosed fence',
    '<!-- An unclosed comment',
    '$$\nx + y',
    '$$',
    '<script>hidden',
    '<pre>hidden',
    '<style>hidden',
    '<textarea>hidden',
    '<?hidden',
    '<![CDATA[hidden',
    '<div>hidden',
    '<script',
    '<pre class="incomplete',
    '<div',
    '<table',
    '<section class="incomplete',
  ])('rejects Markdown that hides the attached source: %s', (text) => {
    expect(render([block(text)])).toBeNull()
  })

  it('checks all records together so later syntax cannot hide an earlier marker', () => {
    expect(render([block('[label]('), block('destination)')])).toBeNull()
    expect(render([block('$$\nx + y'), block('$$')])).toBeNull()
  })

  it('does not treat unmatched ticks in separate paragraphs as one literal span', () => {
    expect(findCitationMatches(render([block('`open'), block('close`')])!)).toHaveLength(2)
  })

  it.each([
    '```html\n<script>literal tag text\n```',
    '`<script>` is literal code.',
    '\\<script> is escaped source text.',
    '$$\nx + y\n$$',
    '$$x + y$$',
    '$x + y$',
    'The bound x<y is given; three is less than five (3 < 5).',
  ])('preserves supported code/escaped HTML and closed math: %s', (text) => {
    const result = render([block(text)])!
    expect(result).toContain(text)
    expect(findCitationMatches(result)).toHaveLength(1)
  })

  it('preserves Markdown and places multiline citations outside complete blocks', () => {
    const texts = [
      '```js\nfunction result() { return 6 }\n```',
      '| Source | Result |\n| --- | --- |\n| A | 6 |',
      '- Result one\n- Result two',
    ]
    const result = render(texts.map((text) => block(text)))!
    for (const text of texts) expect(result).toContain(`${text}\n\n[doc:1, chunk:10]`)
    expect(findCitationMatches(result)).toHaveLength(3)
  })

  it('captures no changes to input records or supplied identities', () => {
    const input = Object.freeze([
      Object.freeze({ text: 'Text.', sources: Object.freeze(['1:10']) }),
    ])
    expect(render(input)).toBe('Text. [doc:1, chunk:10]')
    expect([...supplied]).toEqual(['1:10', '2:20'])
  })
})

describe('redundant plain-prose source labels', () => {
  it.each([
    ['The policy (doc:1:) applies.', 'source_label_malformed'],
    ['The policy (doc:1:10', 'source_label_malformed'],
    ['The policy (doc:1:\n10) applies.', 'source_label_malformed'],
    ['The policy (doc:9007199254740992:10) applies.', 'source_label_malformed'],
    ['The policy (doc:2:20) applies.', 'source_label_unattached'],
    ['The policy (doc:9:90) applies.', 'source_label_unattached'],
    ['An "unfinished quote (doc:1:10).', 'source_label_ambiguous'],
    ['An "unfinished quote (doc:bad).', 'source_label_ambiguous'],
    ['word(doc:1:10)word', 'source_label_placement'],
    ['**(doc:1:10)**', 'source_label_placement'],
    ['word(doc:2:20)word', 'source_label_unattached'],
  ] as const)('classifies the existing first rejection without changing it: %s', (text, code) => {
    const details: unknown[] = []
    const sources = new Set(['1:10'])
    expect(removeRedundantSourceLabels(text, sources)).toBeNull()
    expect(removeRedundantSourceLabels(text, sources, (...args) => details.push(args))).toBeNull()
    expect(details).toEqual([[code]])
    expect(JSON.stringify(details)).not.toContain(text)
    expect(
      removeRedundantSourceLabels(text, sources, () => {
        throw new Error('PRIVATE')
      }),
    ).toBeNull()
  })

  it('never reports a rejection or changes matched literal labels', () => {
    const examples = [
      '`(doc:9:90)` is code.',
      'The literal "(doc:9:90)" stays.',
      '> Quote\n(doc:9:90) is its identifier.',
      '- > Quote\n  (doc:9:90) is its identifier.',
      '[(doc:9:90)](https://example.invalid)',
      '\\(doc:9:90\\) is escaped.',
    ]
    const details: unknown[] = []
    for (const text of examples)
      expect(
        removeRedundantSourceLabels(text, new Set(['1:10']), (...args) => details.push(args)),
      ).toBe(text)
    expect(details).toEqual([])
  })

  it('removes only attached labels from natural prose and keeps canonical attachments', () => {
    expect(
      render([
        block(
          'The base policy (doc:1:10) set the limits. The amendment (doc:2:20) changed one limit.',
          ['1:10', '2:20'],
        ),
      ]),
    ).toBe(
      'The base policy set the limits. The amendment changed one limit. [doc:1, chunk:10] [doc:2, chunk:20]',
    )
  })

  it.each([
    ['Policy (doc:1:10), then another clause.', 'Policy, then another clause.'],
    ['Policy (doc:1:10) (doc:1:10) applies.', 'Policy applies.'],
    ['(doc:1:10) Policy applies.', 'Policy applies.'],
    ['Policy applies. (doc:1:10)', 'Policy applies.'],
    ['Policy\u00a0(doc:1:10)\u00a0applies.', 'Policy\u00a0applies.'],
    ['The policy (doc: 1:10) applies.', 'The policy applies.'],
    ["The policy's limit (doc:1:10) applies.", "The policy's limit applies."],
  ])('normalizes only immediate horizontal spacing: %s', (text, expected) => {
    expect(render([block(text)])).toBe(`${expected} [doc:1, chunk:10]`)
  })

  it.each([
    'The policy (doc:2:20) applies.', // Supplied elsewhere, but not attached here.
    'The policy (doc:9:90) applies.',
    'The policy (doc:0:10) applies.',
    'The policy (doc:01:10) applies.',
    'The policy (doc:9007199254740992:10) applies.',
    'The policy (doc:1:10; doc:2:20) applies.',
    'The policy (doc:1:) applies.',
    'The policy (doc:1:10',
    'word(doc:1:10)word',
    '**(doc:1:10)**',
    '(see (doc:1:10))',
    'The "unfinished quote mentions (doc:1:10).',
    '(doc:1:10)',
  ])('rejects unknown, malformed, ambiguous, or emptied labels: %s', (text) => {
    expect(render([block(text)])).toBeNull()
  })

  it.each([
    '`(doc:9:90)` is a code example.',
    '```text\n(doc:9:90)\n```',
    '    (doc:9:90)\n    code example',
    '\\(doc:9:90\\) is escaped source text.',
    '[(doc:9:90)](https://example.invalid) is a link.',
    '[label](https://example.invalid/(doc:9:90))',
    '<!-- (doc:9:90) -->\nThe comment remains literal.',
    '> The original source says (doc:9:90).',
    '> The source says\n(doc:9:90) as its identifier.',
    '- > The source says\n  (doc:9:90) as its identifier.',
    '> Outer\n> > Inner source\n(doc:9:90) remains a literal identifier.',
    'The literal "(doc:9:90)" is an example.',
    "The literal '(doc:9:90)' is an example.",
    'The literal “(doc:9:90)” is an example.',
    'Das Beispiel „(doc:9:90)“ bleibt wörtlich.',
    'The literal «(doc:9:90)» is an example.',
    'The literal »(doc:9:90)« is an example.',
    "The literal 'vendor’s (doc:9:90)' remains text.",
    '$x + (doc:9:90)$ is a literal math example.',
    '$$x + (doc:9:90)$$ is a literal math example.',
    '(2042-06-10), (1:10), a ratio (2:3), and a quantity (6).',
  ])('preserves protected examples and unrelated parentheses byte-for-byte: %s', (text) => {
    const output = render([block(text)])!
    expect(output).toContain(text)
    expect(findCitationMatches(output)).toHaveLength(1)
  })

  it('does not let a quoted example hide an unclaimed plain-prose label', () => {
    expect(render([block('"(doc:9:90)" is an example. The rule (doc:2:20) applies.')])).toBeNull()
    expect(render([block('"(doc:9:90)" is an example. The rule (doc:1:10) applies.')])).toBe(
      '"(doc:9:90)" is an example. The rule applies. [doc:1, chunk:10]',
    )
  })

  it('bounds original bodies before cleanup, and final output after cleanup', () => {
    expect(render([block('A (doc:1:10) '.repeat(20))], 100)).toBeNull()
    expect(render([block('A (doc:1:10)')], 17)).toBeNull()
    expect(render([block('A (doc:1:10)')], 19)).toBe('A [doc:1, chunk:10]')
  })

  it('does not mutate original model text or attached source arrays', () => {
    const item = Object.freeze({
      text: 'Policy (doc:1:10) applies.',
      sources: Object.freeze(['1:10']),
    })
    const records = Object.freeze([item])
    expect(render(records)).toBe('Policy applies. [doc:1, chunk:10]')
    expect(item.text).toBe('Policy (doc:1:10) applies.')
    expect(item.sources).toEqual(['1:10'])
  })

  it.each([
    '(doc: 1 : 10)',
    '( doc : 1 : 10 )',
    '(\tDOC\t:\t1\t:\t10\t)',
    '(doc:1, chunk:10)',
    '( doc : 1 , chunk : 10 )',
    '(\tdOc\t:\t1\t,\tChUnK\t:\t10\t)',
  ])('removes only a complete attached label variant: %s', (label) => {
    const input = Object.freeze({
      text: `Policy ${label}, then applies.`,
      sources: Object.freeze(['1:10']),
    })
    const details: SourceLinkedAnswerRejection[] = []
    const answer = renderSourceLinkedAnswer(Object.freeze([input]), supplied, 1000, (code) =>
      details.push(code),
    )
    expect(answer).toBe('Policy, then applies. [doc:1, chunk:10]')
    expect(findCitationMatches(answer!)).toHaveLength(1)
    expect(details).toEqual([])
    expect(input.text).toBe(`Policy ${label}, then applies.`)
    expect(input.sources).toEqual(['1:10'])
  })

  it.each(['( doc : 1 : 10 )', '(doc:1, chunk:10)'])(
    'retains all admission boundaries for %s',
    (label) => {
      for (const text of [
        `word${label}word`,
        `**${label}**`,
        `(see ${label})`,
        `An "unfinished ${label}.`,
      ])
        expect(render([block(text)])).toBeNull()
      expect(render([block(`Policy ${label}.`, ['1:10', '1:10'])])).toBe(
        'Policy. [doc:1, chunk:10]',
      )
      expect(render([block(label)])).toBeNull()
      expect(render([block(`A ${label} `.repeat(20))], 100)).toBeNull()
      expect(render([block(`A ${label}`)], 17)).toBeNull()
      expect(render([block(`A ${label}`)], 100)).toBe('A [doc:1, chunk:10]')
      expect(render([block(`Policy ${label} ${label} applies.`)])).toBe(
        'Policy applies. [doc:1, chunk:10]',
      )
      expect(render([block(`Policy ${label}  \nnext.`)])).toBe(
        'Policy  \nnext.\n\n[doc:1, chunk:10]',
      )
    },
  )

  it.each(['(doc: 2 : 20)', '(doc:2, chunk:20)', '(doc:9, chunk:90)'])(
    'does not infer record membership for %s',
    (label) => {
      const details: SourceLinkedAnswerRejection[] = []
      expect(
        renderSourceLinkedAnswer([block(`Policy ${label}.`)], supplied, 1000, (code) =>
          details.push(code),
        ),
      ).toBeNull()
      expect(details).toEqual(['source_label_unattached'])
      expect(JSON.stringify(details)).not.toContain(label)
      expect(
        renderSourceLinkedAnswer([block(`Policy ${label}.`)], supplied, 1000, () => {
          throw new Error('PRIVATE')
        }),
      ).toBeNull()
    },
  )

  it.each([
    '(doc:1, chunk:)',
    '(doc:1, chunk:10',
    '(doc:1, chunk:10; doc:2, chunk:20)',
    '(doc:1, chunk:10,20)',
    '(doc:1:10, chunk:10)',
    '(doc:1, 10)',
    '(doc:1:chunk:10)',
    '(doc:0, chunk:10)',
    '(doc:01, chunk:10)',
    '(doc:1, chunk:010)',
    '(doc:9007199254740992, chunk:10)',
    '(doc:1, chunk:9007199254740992)',
    '(doc:1.0, chunk:10)',
    '(doc:+1, chunk:10)',
    '(doc:1e0, chunk:10)',
    '(doc:1,\nchunk:10)',
    '(doc:1,\rchunk:10)',
    '(doc:\u00a01, chunk:10)',
    '(doc:1, chunk:\u200b10)',
    '(doc:1, chunk:١٠)',
  ])('does not broaden incomplete, grouped or noncanonical variants: %s', (label) => {
    const details: SourceLinkedAnswerRejection[] = []
    expect(
      renderSourceLinkedAnswer([block(`Policy ${label}.`)], supplied, 1000, (code) =>
        details.push(code),
      ),
    ).toBeNull()
    expect(details).toEqual(['source_label_malformed'])
  })

  it.each(['(doc: 9 : 90)', '( doc : 9 , chunk : 90 )'])(
    'preserves literal variants without retargeting: %s',
    (label) => {
      const examples = [
        `\`${label}\` is code.`,
        `\`\`\`text\n${label}\n\`\`\``,
        `    ${label}\n    code`,
        `\\${label} is escaped.`,
        `[${label}](https://example.invalid)`,
        `[label](https://example.invalid/${label})`,
        `<!-- ${label} -->\nLiteral.`,
        `> Quote\n${label} remains literal.`,
        `- > Quote\n  ${label} remains literal.`,
        `The literal "${label}" stays.`,
        `Das Beispiel „${label}“ bleibt.`,
        `$x + ${label}$`,
      ]
      for (const text of examples) {
        const details: SourceLinkedAnswerRejection[] = []
        const answer = renderSourceLinkedAnswer([block(text)], supplied, 1000, (code) =>
          details.push(code),
        )
        expect(answer).toContain(text)
        expect(findCitationMatches(answer!)).toHaveLength(1)
        expect(details).toEqual([])
      }
    },
  )
})

describe('repeated ordinary source attachments', () => {
  it('keeps first-occurrence order and a separate attachment for each record without mutation', () => {
    const input = Object.freeze([
      Object.freeze({
        text: 'Both records apply.',
        sources: Object.freeze(['2:20', '1:10', '2:20', '1:10']),
      }),
      Object.freeze({
        text: 'The first record also states this.',
        sources: Object.freeze(['1:10', '1:10']),
      }),
    ])
    const details: SourceLinkedAnswerRejection[] = []
    const answer = renderSourceLinkedAnswer(input, supplied, 1000, (reason) => details.push(reason))
    expect(answer).toBe(
      'Both records apply. [doc:2, chunk:20] [doc:1, chunk:10]\n\n' +
        'The first record also states this. [doc:1, chunk:10]',
    )
    expect(findCitationMatches(answer!).map(({ documentId }) => documentId)).toEqual([2, 1, 1])
    expect(input[0]!.sources).toEqual(['2:20', '1:10', '2:20', '1:10'])
    expect([...supplied]).toEqual(['1:10', '2:20'])
    expect(details).toEqual([])
  })

  it('admits up to32 raw references even for a single-source catalog, but never33', () => {
    const catalog = new Set(['1:10'])
    for (const count of [2, 32])
      expect(
        renderSourceLinkedAnswer(
          [block('Text.', Array<string>(count).fill('1:10'))],
          catalog,
          1000,
        ),
      ).toBe('Text. [doc:1, chunk:10]')
    const details: SourceLinkedAnswerRejection[] = []
    expect(
      renderSourceLinkedAnswer(
        [block('Text.', Array<string>(33).fill('1:10'))],
        catalog,
        1000,
        (reason) => details.push(reason),
      ),
    ).toBeNull()
    expect(details).toEqual(['sources_shape'])
  })

  it('retains all32 distinct supplied references and bounds the raw array independently of catalog size', () => {
    const ids = Array.from({ length: 33 }, (_, index) => `${index + 1}:${index + 101}`)
    const catalog = new Set(ids)
    const answer = renderSourceLinkedAnswer(
      [block('All records apply.', ids.slice(0, 32))],
      catalog,
      3000,
    )!
    expect(
      findCitationMatches(answer).map(({ documentId, chunkId }) => `${documentId}:${chunkId}`),
    ).toEqual(ids.slice(0, 32))
    expect(renderSourceLinkedAnswer([block('All records apply.', ids)], catalog, 3000)).toBeNull()
  })

  it.each([
    { value: '9:90', reason: 'source_unknown' },
    { value: 7, reason: 'sources_shape' },
    { value: null, reason: 'sources_shape' },
  ])('rejects an invalid later entry instead of dropping it: $reason', ({ value, reason }) => {
    const details: SourceLinkedAnswerRejection[] = []
    expect(
      renderSourceLinkedAnswer(
        [{ text: 'PRIVATE_BODY', sources: ['1:10', '1:10', value] }],
        supplied,
        1000,
        (detail) => details.push(detail),
      ),
    ).toBeNull()
    expect(details).toEqual([reason])
    expect(JSON.stringify(details)).not.toContain('PRIVATE')
  })

  it.each([
    '0:10',
    '01:10',
    '1:010',
    '1.0:10',
    '+1:10',
    '9007199254740992:10',
    '1:9007199254740992',
    '1:10\n',
  ])('still requires canonical safe IDs even when the supplied set contains %j', (invalid) => {
    const details: SourceLinkedAnswerRejection[] = []
    expect(
      renderSourceLinkedAnswer(
        [block('Text.', ['1:10', '1:10', invalid])],
        new Set([...supplied, invalid]),
        1000,
        (reason) => details.push(reason),
      ),
    ).toBeNull()
    expect(details).toEqual(['source_invalid'])
  })

  it('keeps redundant-label cleanup local to each record', () => {
    expect(render([block('Policy ( doc : 1 , chunk : 10 ) applies.', ['1:10', '1:10'])])).toBe(
      'Policy applies. [doc:1, chunk:10]',
    )
    expect(
      render([block('The rule (doc:2:20) applies.', ['1:10', '1:10']), block('Other.', ['2:20'])]),
    ).toBeNull()
  })

  it.each([
    '`[doc:9, chunk:90]` is literal.',
    '```html\n<script>literal\n```',
    '$$x + y$$',
    '> Original (doc:9:90).',
  ])('preserves protected literal text with repeated source IDs: %s', (text) => {
    const answer = render([block(text, ['1:10', '1:10'])])!
    expect(answer).toContain(text)
    expect(findCitationMatches(answer)).toHaveLength(1)
  })

  it.each([
    { text: 'Claim [doc:1, chunk:10].', reason: 'citation_syntax' },
    { text: '<script>hidden', reason: 'html_syntax' },
    { text: '[hidden](#cite-1-10)', reason: 'reserved_href' },
    { text: '$$\nx + y', reason: 'citation_placement' },
    { text: '```txt\nunclosed', reason: 'citation_placement' },
    { text: '(doc:1:10)', reason: 'text_empty' },
  ])('does not bypass $reason after deduplication', ({ text, reason }) => {
    const details: SourceLinkedAnswerRejection[] = []
    expect(
      renderSourceLinkedAnswer([block(text, ['1:10', '1:10'])], supplied, 1000, (detail) =>
        details.push(detail),
      ),
    ).toBeNull()
    expect(details).toEqual([reason])
  })

  it('preserves aggregate original-body and final-render bounds plus cross-record absorption checks', () => {
    const duplicates = ['1:10', '1:10']
    expect(render([block('A (doc:1:10) '.repeat(20), duplicates)], 100)).toBeNull()
    const exact = '🧮 [doc:1, chunk:10]'
    expect(render([block('🧮', duplicates)], Array.from(exact).length)).toBe(exact)
    expect(render([block('🧮', duplicates)], Array.from(exact).length - 1)).toBeNull()
    expect(render([block('[label](', duplicates), block('destination)', duplicates)])).toBeNull()
    expect(render([block('$$\nx', duplicates), block('$$', duplicates)])).toBeNull()
  })
})

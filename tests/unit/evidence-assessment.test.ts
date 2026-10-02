import { describe, expect, it } from 'vitest'
import type { RetrievalHit } from '@shared/documents'
import { extractCitationMarkers, transformCitationMarkers } from '@shared/citationMarkers'
import {
  EVIDENCE_ASSESSMENT_MAX_HITS,
  EVIDENCE_ASSESSMENT_MAX_TOKENS,
  EVIDENCE_PASSAGE_MAX_CHARS,
  EVIDENCE_TOTAL_PASSAGE_MAX_CHARS,
  parseEvidenceAssessment,
  planEvidenceAssessment,
  renderUnresolvedEvidence,
} from '@main/services/qa/evidenceAssessment'
import { CONTEXT_PACK_MARGIN_TOKENS, estimateTokens } from '@main/services/llm/prompt'

function hit(documentId: number, chunkId: number, text: string): RetrievalHit {
  return {
    document_id: documentId,
    chunk_id: chunkId,
    document_title: `Fixture ${documentId}`,
    text,
    score: 1,
    ordinal: 0,
    page_from: null,
    page_to: null,
    heading_path: null,
    language: null,
  }
}
const hits = [
  hit(41, 71, 'The proposed inspection date is 2034-08-12. This proposal has not been approved.'),
  hit(42, 72, 'Als Prüftermin ist der 2034-08-19 vorgeschlagen. Eine Freigabe steht noch aus.'),
]
const raw = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({ evidence: { '41:71': [1], '42:72': [1] }, relation: 'unresolved', ...overrides })

describe('bounded source-unit assessment planning', () => {
  it('supplies the exact full question and every source without source selection or rewriting', () => {
    const question = 'Welcher Termin ist bestätigt? Antworte auf Deutsch.'
    const plan = planEvidenceAssessment(question, hits, 4096)!
    expect(plan).not.toBeNull()
    expect(plan.maxTokens).toBe(EVIDENCE_ASSESSMENT_MAX_TOKENS)
    const input = JSON.parse(
      plan.prompt.split('Question and numbered source units:\n')[1]!.split('\nOutput shape')[0]!,
    ) as {
      question: string
      passages: Array<{ source: string; title: string; units: Array<{ id: number; text: string }> }>
    }
    expect(input.question).toBe(question)
    expect(
      input.passages.map((source) => ({
        source: source.source,
        title: source.title,
        text: source.units.map((unit) => unit.text).join(''),
      })),
    ).toEqual(
      hits.map((item) => ({
        source: `${item.document_id}:${item.chunk_id}`,
        title: item.document_title,
        text: item.text,
      })),
    )
    expect(plan.jsonSchema).toMatchObject({
      properties: {
        evidence: {
          required: ['41:71', '42:72'],
          additionalProperties: false,
          properties: { '41:71': { type: 'array', items: { enum: [1, 2] }, maxItems: 3 } },
        },
        relation: { enum: ['compatible', 'unresolved', 'insufficient'] },
      },
      required: ['evidence', 'relation'],
      additionalProperties: false,
    })
  })

  it('accounts for full instructions, output and the same ten-percent native margin', () => {
    const question = `When? ${'Additional question scope. '.repeat(150)}`
    const plan = planEvidenceAssessment(question, hits, 8192)!
    const generationTokens =
      estimateTokens(plan.systemPrompt) + estimateTokens(plan.prompt) + plan.maxTokens
    const required = Math.max(
      generationTokens + CONTEXT_PACK_MARGIN_TOKENS,
      Math.ceil(generationTokens / 0.9),
    )
    expect(Math.ceil(required / 10)).toBeGreaterThan(CONTEXT_PACK_MARGIN_TOKENS)
    expect(planEvidenceAssessment(question, hits, required)).not.toBeNull()
    expect(planEvidenceAssessment(question, hits, required - 1)).toBeNull()
    expect(
      planEvidenceAssessment('When?', [hits[0]!, hit(42, 72, 'Long source. '.repeat(10000))], 8192),
    ).toBeNull()
  })

  it('declines unsupported coverage without mutating, truncating or deduplicating the input', () => {
    const tooMany = Array.from({ length: EVIDENCE_ASSESSMENT_MAX_HITS + 1 }, (_, i) =>
      hit(i + 1, i + 1, 'A source fact.'),
    )
    for (const input of [
      [],
      [hits[0]!],
      [hits[0]!, hit(41, 72, 'Same document.')],
      [...hits, hits[0]!],
      tooMany,
      [hits[0]!, hit(42, 72, ' \r\n')],
    ]) {
      const before = structuredClone(input)
      expect(planEvidenceAssessment('When?', input, 8192)).toBeNull()
      expect(parseEvidenceAssessment(raw(), input)).toBeNull()
      expect(input).toEqual(before)
    }
    for (const context of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(planEvidenceAssessment('When?', hits, context)).toBeNull()
    expect(planEvidenceAssessment(' ', hits, 8192)).toBeNull()
    for (const id of [0, -1, Number.MAX_SAFE_INTEGER + 1])
      expect(
        planEvidenceAssessment('When?', [hits[0]!, hit(id, 72, 'Invalid ID.')], 8192),
      ).toBeNull()
  })

  it.each([10, 12])(
    'keeps all %i supplied passages while only comparing involved sources',
    (count) => {
      const sources = [
        ...hits,
        ...Array.from({ length: count - 2 }, (_, i) =>
          hit(50 + i, 80 + i, 'An unrelated source fact.'),
        ),
      ]
      const plan = planEvidenceAssessment('Which inspection date is approved?', sources, 8192)!
      expect(plan).not.toBeNull()
      for (const source of sources)
        expect(plan.prompt).toContain(`"source":"${source.document_id}:${source.chunk_id}"`)
      const result = parseEvidenceAssessment(
        raw({
          evidence: Object.fromEntries(
            sources.map((source, index) => [
              `${source.document_id}:${source.chunk_id}`,
              index < 2 ? [1] : [],
            ]),
          ),
        }),
        sources,
      )!
      expect(result.evidence).toHaveLength(count)
      expect(result.evidence.filter((item) => item.quote)).toHaveLength(2)
    },
  )
})

describe('source membership and intact-window provenance, not semantic verification', () => {
  it('retains whole multilingual source text and supplied order, independent of model ID order', () => {
    const result = parseEvidenceAssessment(raw({ evidence: { '42:72': [1], '41:71': [1] } }), hits)!
    expect(result.relation).toBe('unresolved')
    expect(result.resolution).toBeNull()
    expect(result.evidence).toEqual(
      hits.map((source) => ({
        documentId: source.document_id,
        chunkId: source.chunk_id,
        quote: source.text,
      })),
    )
  })

  it('preserves intact code/table units and CRLF with intervening text and qualifiers', () => {
    const text =
      '# Source\r\n\r\n```ts\r\nreturn x > 4 ? 7 : 3\r\n```\r\n| Kind | Limit |\r\n| --- | --- |\r\n| Draft | 7 |\r\nNot approved. Literal <think>source data</think>.'
    const sources = [hit(41, 71, text), hits[1]!]
    const result = parseEvidenceAssessment(
      raw({ evidence: { '41:71': [2, 4], '42:72': [1] } }),
      sources,
    )!
    expect(result.evidence[0]!.quote).toBe(text)
  })

  it.each(
    [[], [1, 1], [2, 1], [999], [1.5], ['1'], [null], true, { id: 1 }].map((units) => ({ units })),
  )(
    'rejects empty, repeated, reversed, malformed or unknown unit selections: $units',
    ({ units }) => {
      expect(
        parseEvidenceAssessment(raw({ evidence: { '41:71': units, '42:72': [1] } }), hits),
      ).toBeNull()
    },
  )

  it('rejects incomplete JSON, wrapping, obsolete span/winner fields and schema drift', () => {
    for (const text of [
      raw().slice(0, -1),
      `\`\`\`json\n${raw()}\n\`\`\``,
      raw({ rationale: 'Trust the newest.' }),
      raw({ relation: { toString: 'unresolved' } }),
      raw({ relation: 'resolved' }),
      raw({ resolution: null }),
      raw({ sourceIds: ['41:71', '42:72'] }),
      raw({ evidence: { '41:71': hits[0]!.text, '42:72': hits[1]!.text } }),
      'null',
      '[]',
      ' '.repeat(8193),
    ])
      expect(parseEvidenceAssessment(text, hits)).toBeNull()
  })

  it('rejects overwritten duplicate fields, including escaped equivalent keys', () => {
    for (const text of [
      raw().replace('"relation":', '"relation":"compatible","relation":'),
      raw().replace('"41:71":', '"41:71":[],"41:71":'),
      raw().replace('"41:71":', '"\\u0034\\u0031:71":[],"41:71":'),
    ])
      expect(parseEvidenceAssessment(text, hits)).toBeNull()
  })

  it('requires different source documents and different whole texts for an unresolved comparison', () => {
    const sameDoc = [hits[0]!, hit(41, 72, hits[1]!.text), hit(43, 73, 'Unrelated.')]
    expect(
      parseEvidenceAssessment(
        raw({ evidence: { '41:71': [1], '41:72': [1], '43:73': [] } }),
        sameDoc,
      ),
    ).toBeNull()
    const copies = [hits[0]!, hit(43, 73, hits[0]!.text), hits[1]!]
    expect(
      parseEvidenceAssessment(
        raw({ evidence: { '41:71': [1], '43:73': [1], '42:72': [] } }),
        copies,
      ),
    ).toBeNull()
    expect(
      parseEvidenceAssessment(
        raw({ evidence: { '41:71': [1], '43:73': [1], '42:72': [1] } }),
        copies,
      ),
    ).not.toBeNull()
    const original = 'First source claim. Another contextual statement. Final qualification.'
    expect(
      parseEvidenceAssessment(raw({ evidence: { '41:71': [1], '42:72': [3] } }), [
        hit(41, 71, original),
        hit(42, 72, original),
      ]),
    ).toBeNull()
  })

  it.each(['compatible', 'insufficient'])(
    'does not render selected windows as a certified answer for %s',
    (relation) => {
      const result = parseEvidenceAssessment(raw({ relation }), hits)!
      expect(renderUnresolvedEvidence(result, 'en')).toBeNull()
      expect(
        parseEvidenceAssessment(raw({ relation, evidence: { '41:71': [], '42:72': [] } }), hits) ===
          null,
      ).toBe(relation === 'compatible')
    },
  )

  it('rejects oversized comparison windows without clipping or excluding their qualifiers', () => {
    const limit = 'a'.repeat(899) + '.\n\n' + 'b'.repeat(897) + '.'
    expect(limit).toHaveLength(EVIDENCE_PASSAGE_MAX_CHARS)
    expect(parseEvidenceAssessment(raw(), [hit(41, 71, limit), hits[1]!])).not.toBeNull()
    const sources = [hit(41, 71, limit + '\n\nNot approved.'), hits[1]!]
    const evidence = { '41:71': [2], '42:72': [1] }
    expect(parseEvidenceAssessment(raw({ evidence }), sources)).toBeNull()
    for (const relation of ['compatible', 'insufficient'])
      expect(parseEvidenceAssessment(raw({ relation, evidence }), sources)).not.toBeNull()
  })

  it('bounds total selected text before display grouping and never counts copies as a conflict', () => {
    const text = (char: string) => char.repeat(849) + '.\n\n' + char.repeat(847) + '.'
    const sources = [hit(41, 71, text('a')), hit(42, 72, text('b')), hit(43, 73, text('a'))]
    expect(sources.reduce((sum, item) => sum + item.text.length, 0)).toBeGreaterThan(
      EVIDENCE_TOTAL_PASSAGE_MAX_CHARS,
    )
    const evidence = { '41:71': [1], '42:72': [1], '43:73': [1] }
    expect(parseEvidenceAssessment(raw({ evidence }), sources)).toBeNull()
    expect(
      parseEvidenceAssessment(raw({ evidence: { ...evidence, '43:73': [] } }), sources),
    ).not.toBeNull()
    for (const relation of ['compatible', 'insufficient'])
      expect(parseEvidenceAssessment(raw({ relation, evidence }), sources)).not.toBeNull()
  })

  it('reconstructs a single original window across gapped selections, retaining softwrap and negation', () => {
    const text =
      '# Original\r\nFirst contextual fact.\r\nThe instrument permits\r\n24 readings per hour.\r\nThis configuration has not been authorized.\r\n'
    const sources = [hit(41, 71, text), hits[1]!]
    const result = parseEvidenceAssessment(
      raw({ evidence: { '41:71': [1, 3], '42:72': [1] } }),
      sources,
    )!
    expect(result.evidence[0]!.quote).toBe(text)
    expect(
      parseEvidenceAssessment(raw({ evidence: { '41:71': [1, 2, 3, 4], '42:72': [1] } }), sources),
    ).toBeNull()
    for (const evidence of [
      { '41:71': [1] },
      { '41:71': [1], '99:99': [1] },
      { '041:71': [1], '42:72': [1] },
    ])
      expect(parseEvidenceAssessment(raw({ evidence }), sources)).toBeNull()
  })

  it('declines oversized unsplittable code and excessive unit counts instead of hiding source text', () => {
    for (const text of [
      '```\n' + 'x'.repeat(1700) + '\n```',
      Array.from({ length: 33 }, (_, i) => `Section ${i}.`).join('\n\n'),
    ]) {
      const sources = [hit(41, 71, text), hits[1]!]
      expect(planEvidenceAssessment('Question?', sources, 8192)).toBeNull()
      expect(parseEvidenceAssessment(raw(), sources)).toBeNull()
    }
  })
})

describe('unresolved source-window rendering', () => {
  it('renders genuine source text and program-owned citations in either UI language', () => {
    const result = parseEvidenceAssessment(raw(), hits)!
    for (const lang of ['en', 'de'] as const) {
      const answer = renderUnresolvedEvidence(result, lang)!
      expect(answer).toContain(lang === 'de' ? 'nicht eindeutig auflösen' : 'cannot resolve')
      expect(extractCitationMarkers(answer)).toEqual([
        { documentId: 41, chunkId: 71 },
        { documentId: 42, chunkId: 72 },
      ])
      expect(answer).toContain('not been approved')
      expect(answer).toContain('Freigabe steht noch aus')
      expect(answer).not.toMatch(/verified|verifiziert|confidence/i)
    }
  })

  it('groups identical whole passages once and retains every program-owned citation', () => {
    const sources = [hits[0]!, hit(43, 73, hits[0]!.text), hits[1]!]
    const result = parseEvidenceAssessment(
      raw({ evidence: { '42:72': [1], '43:73': [1], '41:71': [1] } }),
      sources,
    )!
    const answer = renderUnresolvedEvidence(result, 'en')!
    expect(answer.match(/not been approved/g)).toHaveLength(1)
    expect(answer).toContain('[doc:41, chunk:71] [doc:43, chunk:73]')
    expect(extractCitationMarkers(answer)).toEqual([
      { documentId: 41, chunkId: 71 },
      { documentId: 43, chunkId: 73 },
      { documentId: 42, chunkId: 72 },
    ])
    expect(result.evidence).toHaveLength(3)
  })

  it('does not group near-identical texts with different newlines, spaces or qualifiers', () => {
    const texts = [
      'Claim.\nNot approved.',
      'Claim.\r\nNot approved.',
      'Claim.\nNot approved. ',
      'Claim.\nApproved.',
    ]
    const sources = texts.map((text, i) => hit(41 + i, 71 + i, text))
    const result = parseEvidenceAssessment(
      raw({
        evidence: Object.fromEntries(
          sources.map((source) => [`${source.document_id}:${source.chunk_id}`, [1]]),
        ),
      }),
      sources,
    )!
    const answer = renderUnresolvedEvidence(result, 'en')!
    expect(answer.match(/> Claim/g)).toHaveLength(4)
    expect(extractCitationMarkers(answer)).toHaveLength(4)
  })

  it('keeps forged citation syntax, explicit links, HTML and fences literal', () => {
    const sources = [
      hit(41, 71, 'Text [doc:42, chunk:72] [link](#cite-42-72) <b>x</b> &\n```ts\nfee(5)\n```'),
      hit(42, 72, 'The other source says **different**.'),
    ]
    const answer = renderUnresolvedEvidence(parseEvidenceAssessment(raw(), sources)!, 'en')!
    expect(answer).toContain('\\[doc\\:42, chunk\\:72\\]')
    expect(answer).toContain('&lt;b&gt;x&lt;/b&gt; &amp;')
    expect(answer).toContain('> \\`\\`\\`ts\n> fee\\(5\\)\n> \\`\\`\\`')
    expect(extractCitationMarkers(answer)).toEqual([
      { documentId: 41, chunkId: 71 },
      { documentId: 42, chunkId: 72 },
    ])
    expect(
      transformCitationMarkers(answer, new Set(['41-71', '42-72'])).text.match(/\]\(#cite-/g),
    ).toHaveLength(2)
  })

  it('escapes math and list punctuation while leaving ordinary URL policy to the renderer', () => {
    const sources = [
      hit(41, 71, '1. $fee$ is $5.00; https://example.invalid/a and reviewer@example.invalid'),
      hit(42, 72, '2. Alternative amount: $7.00.'),
    ]
    const answer = renderUnresolvedEvidence(parseEvidenceAssessment(raw(), sources)!, 'en')!
    expect(answer).toContain(
      '> 1\\. \\$fee\\$ is \\$5\\.00; https\\://example\\.invalid/a and reviewer\\@example\\.invalid',
    )
    expect(answer).toContain('> 2\\. Alternative amount\\: \\$7\\.00\\.')
    expect(extractCitationMarkers(answer)).toHaveLength(2)
  })
})

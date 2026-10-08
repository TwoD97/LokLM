import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { conflictSummarySchema } from '@main/services/qa/conflictSummary'
import { buildCheckedContextBundle } from '@main/services/qa/checkedAnswer'
import {
  installSyntheticWorkerObserver,
  sanitizeSyntheticEvidence,
  type ObservableUtilityProcess,
} from '../evals/native-calibration/syntheticWorkerCapture'

const schema = { type: 'object', properties: { check: {}, result: {} } }
const options = { workerPath: '/owned/modelsWorker.js', expectedSchemaJson: JSON.stringify(schema) }
const request = (id: number) => ({
  id,
  op: 'llm.generateRaw',
  payload: { jsonSchema: schema, noThink: true },
})
const raw = JSON.stringify({
  check: 'PRIVATE_CHECK',
  result: {
    resolution: 'answered',
    blocks: [{ text: 'PRIVATE_ANSWER', evidence: ['An exact source quote.'] }],
  },
})
function fixture(
  sanitize = sanitizeSyntheticEvidence,
  config: Parameters<typeof installSyntheticWorkerObserver>[2] = options,
  install = installSyntheticWorkerObserver,
) {
  const calls: unknown[][] = []
  const response = { sent: true }
  class Child extends EventEmitter {
    postMessage(...args: unknown[]) {
      expect(this).toBe(child)
      calls.push(args)
      return response
    }
  }
  const child = new Child()
  const forkArgs: unknown[][] = []
  const utility: ObservableUtilityProcess = {
    fork(...args) {
      expect(this).toBe(utility)
      forkArgs.push(args)
      return child
    },
  }
  const originalFork = utility.fork
  const originalPost = child.postMessage
  const observer = install(utility, sanitize, config)
  const spawned = utility.fork(options.workerPath, ['unchanged'], { serviceName: 'loklm-models' })
  expect(spawned).toBe(child)
  return { child, utility, observer, calls, forkArgs, response, originalFork, originalPost }
}

describe('synthetic-only raw evidence sanitizer', () => {
  it('counts only formatting line breaks after valid JSON without retaining private strings', () => {
    const value = {
      check: 'PRIVATE_CHECK\nsecond line',
      result: {
        resolution: 'answered',
        blocks: [{ text: 'PRIVATE_BODY\r\nnext line', sources: ['1:10'] }],
      },
    }
    const compact = JSON.stringify(value)
    const pretty = JSON.stringify(value, null, 2)
    expect(sanitizeSyntheticEvidence(compact).externalLineBreaks).toBe(0)
    expect(sanitizeSyntheticEvidence(pretty).externalLineBreaks).toBe(pretty.split('\n').length - 1)
    expect(sanitizeSyntheticEvidence(pretty.replaceAll('\n', '\r\n')).externalLineBreaks).toBe(
      pretty.split('\n').length - 1,
    )
    expect(sanitizeSyntheticEvidence(pretty.replaceAll('\n', '\r')).externalLineBreaks).toBe(
      pretty.split('\n').length - 1,
    )
    for (const raw of [compact, pretty])
      expect(JSON.stringify(sanitizeSyntheticEvidence(raw))).not.toMatch(
        /PRIVATE|second line|next line/,
      )
    expect(sanitizeSyntheticEvidence('{\n"check":"PRIVATE')).not.toHaveProperty(
      'externalLineBreaks',
    )
    expect(sanitizeSyntheticEvidence('x'.repeat(256001))).not.toHaveProperty('externalLineBreaks')
  })
  it('retains evidence and structural metadata but no private check, answer, arbitrary keys or nested objects', () => {
    const observed = sanitizeSyntheticEvidence(
      JSON.stringify({
        check: 'PRIVATE_CHECK',
        hidden: 'SECRET',
        result: {
          resolution: 'answered',
          answer: 'PRIVATE_ANSWER',
          hidden: 'SECRET',
          blocks: [
            {
              text: 'PRIVATE_ANSWER',
              evidence: [{ quote: 'source text', thought: 'SECRET', nested: { text: 'SECRET' } }],
            },
          ],
        },
      }),
    )
    expect(observed.structure?.check).toEqual({ type: 'string', codepoints: 13 })
    expect(observed.structure?.root.unknownKeyCount).toBe(1)
    expect(observed.evidence).toContainEqual(expect.objectContaining({ quote: 'source text' }))
    for (const value of ['PRIVATE', 'SECRET', 'hidden', 'thought', 'nested'])
      expect(JSON.stringify(observed)).not.toContain(value)
  })
  it('diagnoses flat known shapes, invalid JSON and nonstring evidence without reading serialized result strings', () => {
    const observed = sanitizeSyntheticEvidence(
      JSON.stringify({
        resolution: 'answered',
        blocks: [{ text: 'PRIVATE', evidence: 'source' }],
        result: '{"check":"PRIVATE"}',
      }),
    )
    expect(observed.structure?.result.type).toBe('string')
    expect(observed.structure?.rootBlocks).toMatchObject({ length: 1 })
    expect(observed.evidence[0]).toMatchObject({ quote: 'source' })
    expect(JSON.stringify(observed)).not.toContain('PRIVATE')
    expect(sanitizeSyntheticEvidence('PRIVATE')).toMatchObject({ envelopeParsed: false })
    expect(sanitizeSyntheticEvidence(JSON.stringify({ evidence: 123 })).evidence[0]).toMatchObject({
      type: 'number',
    })
  })
  it('bounds raw input, record enumeration, quote sizes, counts and retained codepoints', () => {
    expect(sanitizeSyntheticEvidence('x'.repeat(256001))).toMatchObject({
      inputBoundExceeded: true,
    })
    const observed = sanitizeSyntheticEvidence(
      JSON.stringify({
        blocks: Array.from({ length: 140 }, () => ({
          evidence: Array.from({ length: 140 }, () => 'x'.repeat(200)),
        })),
      }),
    )
    expect(observed).toMatchObject({ inputBoundExceeded: true })
    const bounded = sanitizeSyntheticEvidence(
      JSON.stringify({
        blocks: Array.from({ length: 140 }, () => ({ evidence: ['x'.repeat(1000)] })),
      }),
    )
    expect(bounded.structure?.rootBlocks).toMatchObject({ length: 140, inspected: 128 })
    expect(bounded.evidence.length).toBeLessThanOrEqual(128)
    expect(bounded.evidence.reduce((sum, value) => sum + (value.quote?.length ?? 0), 0)).toBe(32000)
    expect(
      sanitizeSyntheticEvidence(JSON.stringify({ evidence: ['x'.repeat(2001)] })).evidence[0],
    ).toMatchObject({ omitted: true, codepoints: 2001 })
  })
  it('both functions survive serialization into a clean main-process context', () => {
    const sanitizer = runInNewContext(
      `(${sanitizeSyntheticEvidence.toString()})`,
    ) as typeof sanitizeSyntheticEvidence
    expect(sanitizer(raw).evidence[0]?.quote).toBe('An exact source quote.')
    const installer = runInNewContext(
      `(${installSyntheticWorkerObserver.toString()})`,
    ) as typeof installSyntheticWorkerObserver
    const child = new EventEmitter() as EventEmitter & {
      postMessage: (...args: unknown[]) => unknown
    }
    child.postMessage = () => undefined
    const utility = { fork: () => child }
    const observer = installer(utility, sanitizer, options)
    utility.fork()
    expect(observer.status().disposed).toBe(false)
    observer.dispose()
  })

  it('captures historical captioned record shapes and lengths without retaining labels, IDs or text', () => {
    const input = JSON.stringify({
      check: 'PRIVATE_CHECK',
      result: {
        resolution: 'comparison',
        evidence: [
          {
            source: '82716:71625',
            label: 'PRIVATE_LABEL',
            excerpts: ['PRIVATE_EXCERPT (doc:82716:71625)', '😀é', { text: 'PRIVATE_NESTED' }],
            quote: 'PRIVATE_SMUGGLED_QUOTE',
            PRIVATE_KEY: 'PRIVATE_VALUE',
          },
        ],
        outcome: 'unresolved',
      },
    })
    for (const config of [
      { legacyExcerptLabels: true },
      { legacyExcerptLabels: true, sourceLabelShapes: true },
    ]) {
      const observed = sanitizeSyntheticEvidence(input, config)
      expect(observed.evidence).toEqual([
        expect.objectContaining({
          location: 'result.evidence[0]',
          object: {
            type: 'object',
            knownKeys: ['source', 'label', 'excerpts'],
            unknownKeyCount: 2,
            types: { source: 'string', label: 'string', excerpts: 'array' },
          },
          label: { type: 'string', codepoints: 13 },
          excerpts: {
            type: 'array',
            length: 3,
            inspected: 3,
            entries: [
              { type: 'string', codepoints: 33 },
              { type: 'string', codepoints: 2 },
              { type: 'object' },
            ],
          },
        }),
      ])
      expect(JSON.stringify(observed)).not.toMatch(/PRIVATE|82716|71625/)
      if (config.sourceLabelShapes)
        expect(observed.sourceLabelShapes).toMatchObject({
          inspectedBlocks: 0,
          inspectedChars: 0,
          candidates: 0,
          capped: false,
        })
    }
  })

  it('bounds historical metadata enumeration and never traverses malformed label/excerpt objects', () => {
    const record = {
      source: '82716:71625',
      label: { text: 'PRIVATE' },
      excerpts: Array.from({ length: 140 }, () => 'PRIVATE'),
    }
    const observed = sanitizeSyntheticEvidence(
      JSON.stringify({ result: { evidence: Array.from({ length: 140 }, () => record) } }),
      { sourceLabelShapes: true, legacyExcerptLabels: true },
    )
    expect(observed.evidence).toHaveLength(128)
    expect(observed.omittedEvidence).toBe(12)
    expect(observed.evidence[0]).toMatchObject({
      label: { type: 'object' },
      excerpts: { type: 'array', length: 140, inspected: 3 },
    })
    expect(JSON.stringify(observed)).not.toMatch(/PRIVATE|82716|71625/)
    const malformed = sanitizeSyntheticEvidence(
      JSON.stringify({ evidence: [{ label: null, excerpts: { text: 'PRIVATE' } }] }),
      { legacyExcerptLabels: true },
    )
    expect(malformed.evidence[0]).toMatchObject({
      label: { type: 'null' },
      excerpts: { type: 'object' },
    })
    expect(JSON.stringify(malformed)).not.toContain('PRIVATE')
  })
})

describe('content-free ordinary label-shape observations', () => {
  const observe = (text: string) =>
    sanitizeSyntheticEvidence(
      JSON.stringify({
        check: 'PRIVATE_CHECK',
        result: { resolution: 'answered', blocks: [{ text, sources: ['82716:71625'] }] },
      }),
      { sourceLabelShapes: true },
    ).sourceLabelShapes!

  it.each([
    ['(doc:82716:71625)', 'exact_colon_pair', false],
    ['( doc : 82716 : 71625 )', 'spaced_colon_pair', false],
    ['(doc:\t82716 :\t71625)', 'spaced_colon_pair', false],
    ['(doc:82716, chunk:71625)', 'comma_chunk_pair', false],
    ['(doc:82716:71625; doc:61524:51423)', 'grouped_complete_pairs', false],
    ['(doc:82716, chunk:71625, doc:61524, chunk:51423)', 'grouped_complete_pairs', false],
    ['(doc:0:71625)', 'exact_colon_pair', true],
    ['(doc:-1:71625)', 'exact_colon_pair', true],
    ['(doc:01:71625)', 'exact_colon_pair', true],
    ['(doc:9007199254740992:71625)', 'exact_colon_pair', true],
    ['(doc:PRIVATE_ID:71625)', 'exact_colon_pair', true],
    ['(doc:82716:\n71625)', 'other_syntax', false],
    ['(\ndoc:82716:71625)', 'other_syntax', false],
    ['(doc:82716:71625', 'no_closing_parenthesis', false],
    ['(doc:82716)', 'other_syntax', false],
    ['(doc:\u00a082716:71625)', 'other_syntax', false],
  ] as const)(
    'observes the bounded syntax category without retaining %j',
    (text, shape, invalid) => {
      const result = observe(text)
      expect(result.candidates).toBe(1)
      expect(result.counts[shape]).toBe(1)
      expect(result.counts.invalid_id).toBe(invalid ? 1 : 0)
      expect(result.counts.line_break).toBe(/[\r\n]/u.test(text) ? 1 : 0)
      expect(result.capped).toBe(false)
      expect(JSON.stringify(result)).not.toMatch(/82716|71625|61524|51423|9007199254740992|PRIVATE/)
      expect(Object.keys(result.counts)).toEqual([
        'exact_colon_pair',
        'spaced_colon_pair',
        'comma_chunk_pair',
        'grouped_complete_pairs',
        'no_closing_parenthesis',
        'line_break',
        'invalid_id',
        'other_syntax',
      ])
    },
  )

  it('counts protected and active occurrences without attributing a rejection or retaining their surroundings', () => {
    const text =
      '`(doc:82716:71625)` and "( doc : 61524 : 51423 )" and [(doc:41322, chunk:31221)](https://private.example)'
    const result = observe(text)
    expect(result).toMatchObject({
      candidates: 3,
      counts: {
        exact_colon_pair: 1,
        spaced_colon_pair: 1,
        comma_chunk_pair: 1,
      },
    })
    expect(result).not.toHaveProperty('rejection')
    expect(JSON.stringify(result)).not.toMatch(/https|private|82716|71625|61524|51423|41322|31221/)
    expect(
      observe('Ordinary (document description), ratio (3:4), date (2038-04-08), doc:82716:71625.')
        .candidates,
    ).toBe(0)
  })

  it('only scans result block text and suppresses unexpected legacy evidence in the opt-in channel', () => {
    const input = JSON.stringify({
      check: 'PRIVATE_CHECK (doc:91827:82916)',
      blocks: [{ text: 'PRIVATE_ROOT (doc:91827:82916)' }],
      result: {
        resolution: 'answered',
        answer: 'PRIVATE_ANSWER (doc:91827:82916)',
        evidence: ['PRIVATE_EVIDENCE (doc:91827:82916)'],
        blocks: [
          {
            text: 'PRIVATE_BODY (doc:82716:71625)',
            sources: ['82716:71625'],
            evidence: [{ quote: 'PRIVATE_QUOTE', text: 'PRIVATE_SOURCE' }],
          },
        ],
      },
    })
    expect(sanitizeSyntheticEvidence(input)).not.toHaveProperty('sourceLabelShapes')
    const result = sanitizeSyntheticEvidence(input, { sourceLabelShapes: true })
    expect(result.sourceLabelShapes).toMatchObject({
      candidates: 1,
      counts: { exact_colon_pair: 1 },
    })
    expect(result.evidence.some((value) => value.quote !== undefined)).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|91827|82916|82716|71625/)
    expect(
      sanitizeSyntheticEvidence('{"result":"PRIVATE', { sourceLabelShapes: true }),
    ).not.toHaveProperty('sourceLabelShapes')
  })

  it('bounds candidates, scanned text, records and candidate length without inventing a truncated missing closer', () => {
    const many = observe('(doc:82716:71625) '.repeat(1000))
    expect(many).toMatchObject({ candidates: 128, capped: true, counts: { exact_colon_pair: 128 } })
    const cut = observe('x'.repeat(31992) + '(doc:82716:71625)')
    expect(cut).toMatchObject({
      inspectedChars: 32000,
      capped: true,
      counts: { no_closing_parenthesis: 0 },
    })
    const long = observe('(doc:' + 'x'.repeat(600) + ')')
    expect(long).toMatchObject({ candidates: 1, capped: true })
    expect(Object.values(long.counts).every((count) => count === 0)).toBe(true)
    const blocks = sanitizeSyntheticEvidence(
      JSON.stringify({
        check: 'PRIVATE',
        result: { blocks: Array.from({ length: 129 }, () => ({ text: 'ordinary' })) },
      }),
      { sourceLabelShapes: true },
    ).sourceLabelShapes
    expect(blocks).toMatchObject({ inspectedBlocks: 128, capped: true })
  })

  it('records summary field types and label counts without retaining body, source IDs or arbitrary keys', () => {
    const captured = sanitizeSyntheticEvidence(
      JSON.stringify({
        check: 'PRIVATE_CHECK (doc:91827:82916)',
        summary: { text: 'PRIVATE_ROOT (doc:91827:82916)' },
        result: {
          resolution: 'comparison',
          summary: {
            text: 'PRIVATE_BODY (doc:82716, chunk:71625)',
            sources: ['82716:71625', '(doc:91827:82916)'],
            PRIVATE_KEY: { text: 'PRIVATE_NESTED (doc:91827:82916)' },
          },
          outcome: 'unresolved',
        },
      }),
      { sourceLabelShapes: true },
    )
    expect(captured.structure?.summary).toEqual({
      type: 'object',
      knownKeys: ['text', 'sources'],
      unknownKeyCount: 1,
      types: { text: 'string', sources: 'array' },
    })
    expect(captured.sourceLabelShapes).toMatchObject({
      candidates: 1,
      inspectedBlocks: 1,
      capped: false,
      counts: { comma_chunk_pair: 1, exact_colon_pair: 0 },
    })
    expect(captured.evidence).toEqual([])
    expect(JSON.stringify(captured)).not.toMatch(/PRIVATE|91827|82916|82716|71625/)
  })

  it('does not traverse invalid summary values or serialized nested content', () => {
    for (const summary of [
      'PRIVATE_BODY (doc:82716:71625)',
      null,
      [{ text: 'PRIVATE_BODY (doc:82716:71625)' }],
      { text: { text: 'PRIVATE_BODY (doc:82716:71625)' }, sources: ['82716:71625'] },
    ]) {
      const captured = sanitizeSyntheticEvidence(
        JSON.stringify({ result: { resolution: 'comparison', summary, outcome: 'unresolved' } }),
        { sourceLabelShapes: true },
      )
      expect(captured.sourceLabelShapes).toMatchObject({ candidates: 0, inspectedChars: 0 })
      expect(JSON.stringify(captured)).not.toMatch(/PRIVATE|82716|71625/)
    }
  })

  it('shares the original scan budgets between malformed co-occurring ordinary and summary fields', () => {
    const observeBoth = (blocks: unknown[], text: string) =>
      sanitizeSyntheticEvidence(
        JSON.stringify({ result: { blocks, summary: { text, sources: ['82716:71625'] } } }),
        { sourceLabelShapes: true },
      ).sourceLabelShapes
    expect(
      observeBoth(
        Array.from({ length: 128 }, () => ({ text: 'x' })),
        '(doc:82716:71625)',
      ),
    ).toMatchObject({ inspectedBlocks: 128, candidates: 0, capped: true })
    expect(observeBoth([{ text: 'x'.repeat(31992) }], '(doc:82716:71625)')).toMatchObject({
      inspectedChars: 32000,
      capped: true,
      counts: { no_closing_parenthesis: 0 },
    })
    expect(observeBoth([], '(doc:82716:71625) '.repeat(129))).toMatchObject({
      candidates: 128,
      capped: true,
    })
  })
})

describe('test-only utility-process reply observer', () => {
  const actualSchema = (concise = false) =>
    buildCheckedContextBundle(
      concise ? 'Synthetic question. Answer in one short sentence.' : 'Synthetic question.',
      [
        {
          document_id: 1,
          chunk_id: 10,
          document_title: 'Fixture',
          text: 'Source text.',
          ordinal: 0,
          page_from: null,
          page_to: null,
          heading_path: null,
          language: 'en',
          score: 1,
        },
      ],
      'en',
    ).comparisonPlan!.jsonSchema
  const catalogSchema = (legacyUnits = false) => {
    // Keep historical unit templates explicit after the active short mode changes.
    const schema = JSON.parse(JSON.stringify(actualSchema()))
    if (legacyUnits)
      for (const variant of schema.properties.result.oneOf.slice(1)) {
        const fields = variant.properties
        variant.properties = {
          resolution: fields.resolution,
          units: { type: 'array', minItems: 1, maxItems: 4, items: { enum: ['U1'] } },
          outcome: fields.outcome,
        }
        variant.required = ['resolution', 'units', 'outcome']
      }
    return schema
  }
  const withIds = (ids: unknown[], concise = false) => {
    const schema = catalogSchema(concise)
    const properties = schema.properties.result.oneOf[0]!.properties
    if (!('blocks' in properties)) throw new Error('Ordinary schema absent')
    properties.blocks.items.properties.sources.items.enum = ids as string[]
    for (let index = 1; index < schema.properties.result.oneOf.length; index++) {
      const properties = schema.properties.result.oneOf[index]!.properties
      if ('sources' in properties) properties.sources.items.enum = ids as string[]
      else if ('units' in properties)
        properties.units.items.enum = Array.from(
          { length: Math.max(1, ids.length) },
          (_, i) => `U${i + 1}`,
        )
      else throw new Error('Comparison schema absent')
    }
    return schema
  }
  const dynamicOptions = () => ({
    ...options,
    expectedSchemaJson: JSON.stringify(actualSchema()),
    normalizeSourceEnum: true,
  })
  const summaryWithIds = (ids: unknown[]) => {
    // Keep the exact v22/v23 historical summary family independent of current production.
    const schema = catalogSchema()
    schema.properties.result.oneOf[0].properties.blocks.items.properties.sources.items.enum = ids
    for (const variant of schema.properties.result.oneOf.slice(1)) {
      const fields = variant.properties
      variant.properties = {
        resolution: fields.resolution,
        summary: {
          type: 'object',
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 512 },
            sources: { type: 'array', minItems: 1, maxItems: 32, items: { enum: ids } },
          },
          required: ['text', 'sources'],
          additionalProperties: false,
        },
        outcome: fields.outcome,
      }
      variant.required = ['resolution', 'summary', 'outcome']
    }
    return schema
  }
  const summaryOptions = () => ({
    ...dynamicOptions(),
    alternateExpectedSchemaJson: JSON.stringify(summaryWithIds(['1:10'])),
    captureSourceLabelShapes: true,
  })
  const excerptsWithIds = (ids: unknown[]) => {
    // Explicit fixed v26 bootstrap: source-dependent budgets are a separate family.
    const schema = catalogSchema()
    schema.properties.result.oneOf[0].properties.blocks.items.properties.sources.items.enum = ids
    schema.properties.result.oneOf = [
      schema.properties.result.oneOf[0],
      {
        type: 'object',
        properties: {
          resolution: { const: 'comparison' },
          evidence: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                source: { enum: ids },
                excerpts: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 3,
                  items: { type: 'string', minLength: 1, maxLength: 160 },
                },
              },
              required: ['source', 'excerpts'],
              additionalProperties: false,
            },
          },
          outcome: { const: 'unresolved' },
        },
        required: ['resolution', 'evidence', 'outcome'],
        additionalProperties: false,
      },
    ]
    return schema
  }
  const excerptsOptions = () => ({
    ...dynamicOptions(),
    alternateExpectedSchemaJson: JSON.stringify(excerptsWithIds(['1:10'])),
    captureSourceLabelShapes: true,
  })
  const budgetedExcerptsOptions = () => ({
    ...dynamicOptions(),
    alternateExpectedSchemaJson: JSON.stringify(historicalBudgetedWithIds(['1:10'], 2)),
    captureSourceLabelShapes: true,
    historicalExcerptBudgets: 'typed-comparison-v28' as const,
  })
  const historicalBudgetedWithIds = (ids: string[], minimumRecords = 1) => {
    // Explicit fixed v27 bootstrap; current v28 requires at least two alternatives.
    const schema = catalogSchema()
    schema.properties.result.oneOf[0].properties.blocks.items.properties.sources.items.enum = ids
    schema.properties.result.oneOf = [
      schema.properties.result.oneOf[0],
      ...[1, 2, 3, 4]
        .filter((count) => count >= minimumRecords)
        .map((recordCount) => ({
          type: 'object',
          properties: {
            resolution: { const: 'comparison' },
            recordCount: { const: recordCount },
            evidence: {
              type: 'array',
              minItems: recordCount,
              maxItems: recordCount,
              items: {
                oneOf: ids.flatMap((source) =>
                  [1, 2, 3].map((fragmentCount) => ({
                    type: 'object',
                    properties: {
                      source: { const: source },
                      fragmentCount: { const: fragmentCount },
                      excerpts: {
                        type: 'array',
                        minItems: fragmentCount,
                        maxItems: fragmentCount,
                        items: { type: 'string', minLength: 1, maxLength: 160 },
                      },
                    },
                    required: ['source', 'fragmentCount', 'excerpts'],
                    additionalProperties: false,
                  })),
                ),
              },
            },
            outcome: { const: 'unresolved' },
          },
          required: ['resolution', 'recordCount', 'evidence', 'outcome'],
          additionalProperties: false,
        })),
    ]
    return schema
  }
  const historicalBudgetedOptions = () => ({
    ...dynamicOptions(),
    alternateExpectedSchemaJson: JSON.stringify(historicalBudgetedWithIds(['1:10'])),
    captureSourceLabelShapes: true,
    historicalExcerptBudgets: 'typed-comparison-v27' as const,
  })
  const historicalGeneratedSummaryWithIds = (ids: string[]) => {
    const schema = catalogSchema()
    schema.properties.result.oneOf[0].properties.blocks.items.properties.sources.items.enum = ids
    const markerLengths = ids
      .map((id) => {
        const [document, chunk] = id.split(':')
        return `[doc:${document}, chunk:${chunk}]`.length
      })
      .sort((a, b) => b - a)
    const count = Math.min(4, ids.length)
    const maximum =
      512 - 73 - 2 - 1 - (markerLengths.slice(0, count).reduce((sum, n) => sum + n, 0) + count)
    schema.properties.result.oneOf = [
      schema.properties.result.oneOf[0],
      {
        type: 'object',
        properties: {
          resolution: { const: 'comparison' },
          summary: {
            type: 'object',
            properties: {
              text: { type: 'string', minLength: 1, maxLength: maximum },
              sources: { type: 'array', minItems: 1, maxItems: 4, items: { enum: ids } },
            },
            required: ['text', 'sources'],
            additionalProperties: false,
          },
          outcome: { const: 'unresolved' },
        },
        required: ['resolution', 'summary', 'outcome'],
        additionalProperties: false,
      },
    ]
    return schema
  }
  const historicalGeneratedSummaryOptions = () => ({
    ...dynamicOptions(),
    alternateExpectedSchemaJson: JSON.stringify(historicalGeneratedSummaryWithIds(['1:10'])),
    captureSourceLabelShapes: true,
  })

  const typedSummaryWithIds = (ids: string[]) => {
    const schema = historicalGeneratedSummaryWithIds(ids)
    schema.properties.result.oneOf[1].properties.summary = conflictSummarySchema(ids)
    return schema
  }
  const typedSummaryOptions = () => ({
    ...dynamicOptions(),
    alternateExpectedSchemaJson: JSON.stringify(typedSummaryWithIds(['1:10'])),
    captureSourceLabelShapes: true,
  })
  const historicalV31WithIds = (ids: string[]) => {
    const schema = typedSummaryWithIds(ids)
    schema.properties.result.oneOf[1].properties.summary.properties.alternatives.items.properties.label =
      {
        type: 'string',
        minLength: 1,
        maxLength: 80,
      }
    return schema
  }

  it.each([1, 2, 32])(
    'admits actual v32 typed summary bundles with %i sources and no private text capture',
    (count) => {
      const ids = Array.from({ length: count }, (_, index) => index + 1)
      const bundle = buildCheckedContextBundle(
        'Compare alternatives. Answer in one short sentence.',
        ids.map((id) => ({
          document_id: id,
          chunk_id: id * 10,
          document_title: 'PRIVATE_TITLE',
          text: 'PRIVATE_SOURCE',
          ordinal: 0,
          page_from: null,
          page_to: null,
          heading_path: null,
          language: 'en',
          score: 1,
        })),
        'en',
      )
      expect(bundle.comparisonPlan?.comparisonMode).toBe('summary')
      expect(bundle.comparisonPlan?.jsonSchema).toEqual(
        typedSummaryWithIds(ids.map((id) => `${id}:${id * 10}`)),
      )
      const install = runInNewContext(
        `(${installSyntheticWorkerObserver.toString()})`,
      ) as typeof installSyntheticWorkerObserver
      const sanitize = runInNewContext(
        `(${sanitizeSyntheticEvidence.toString()})`,
      ) as typeof sanitizeSyntheticEvidence
      const f = fixture(sanitize, typedSummaryOptions(), install)
      f.observer.arm('current-summary')
      const message = {
        ...request(726),
        payload: {
          jsonSchema: bundle.comparisonPlan!.jsonSchema,
          noThink: true,
          prompt: bundle.prompt,
        },
      }
      const before = JSON.stringify(message)
      expect(f.child.postMessage(message)).toBe(f.response)
      const reply = {
        id: 726,
        ok: true,
        result: {
          raw: JSON.stringify({
            check: 'PRIVATE_CHECK',
            result: {
              resolution: 'comparison',
              summary: {
                scope: [{ text: 'PRIVATE_SCOPE', source: '1:10' }],
                alternatives: [{ label: 'PRIVATE_LABEL', value: 'PRIVATE_VALUE', source: '1:10' }],
                grounds: [
                  { kind: 'priority', evidence: [{ text: 'PRIVATE_GROUND', source: '1:10' }] },
                ],
              },
              outcome: 'unresolved',
            },
          }),
        },
      }
      const responseBefore = JSON.stringify(reply)
      f.child.emit('message', reply)
      const rows = f.observer.drain()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        status: 'completed',
        capture: {
          structure: {
            summary: { knownKeys: ['scope', 'alternatives', 'grounds'], unknownKeyCount: 0 },
          },
        },
      })
      expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|1:10/)
      expect(JSON.stringify(message)).toBe(before)
      expect(JSON.stringify(reply)).toBe(responseBefore)
      f.observer.dispose()
    },
  )

  it('requires exact v32 role bounds, ordering, issue categories and identical catalogs', () => {
    const variants: ReturnType<typeof typedSummaryWithIds>[] = []
    const mutate = (change: (schema: ReturnType<typeof typedSummaryWithIds>) => void) => {
      const schema = typedSummaryWithIds(['4:40', '3:30'])
      change(schema)
      variants.push(schema)
    }
    const summary = (s: ReturnType<typeof typedSummaryWithIds>) =>
      s.properties.result.oneOf[1].properties.summary
    for (const role of ['scope', 'alternatives', 'grounds']) {
      mutate((s) => {
        summary(s).properties[role].maxItems++
      })
      mutate((s) => {
        summary(s).properties[role].minItems = 0
      })
      mutate((s) => {
        summary(s).properties[role].items.additionalProperties = true
      })
      mutate((s) => {
        summary(s).properties[role].items.required.reverse()
      })
    }
    for (const changedCatalog of [['3:30', '4:40'], ['4:40'], ['4:40', '9:90']]) {
      for (const role of ['scope', 'alternatives', 'grounds']) {
        mutate((s) => {
          const fields = summary(s).properties[role].items.properties
          const source =
            role === 'grounds' ? fields.evidence.items.properties.source : fields.source
          source.enum = changedCatalog
        })
      }
    }
    mutate((s) => {
      summary(s).properties.scope.items.properties.text.maxLength = 161
    })
    mutate((s) => {
      summary(s).properties.alternatives.items.properties.label.oneOf[0].maxLength = 81
    })
    mutate((s) => {
      summary(s).properties.alternatives.items.properties.label.oneOf[1].properties.kind.const =
        'title'
    })
    mutate((s) => {
      summary(s).properties.alternatives.items.properties.label.oneOf[1].additionalProperties = true
    })
    mutate((s) => {
      summary(s).properties.alternatives.items.properties.label.oneOf[1].required = []
    })
    mutate((s) => {
      summary(s).properties.alternatives.items.properties.label.oneOf.reverse()
    })
    mutate((s) => {
      summary(s).properties.alternatives.items.properties.value.maxLength = 161
    })
    mutate((s) => {
      summary(s).properties.grounds.items.properties.evidence.maxItems = 5
    })
    mutate((s) => {
      summary(s).properties.grounds.items.properties.evidence.items.properties.text.minLength = 0
    })
    mutate((s) => {
      summary(s).properties.grounds.items.properties.kind.enum.push('PRIVATE_REASON')
    })
    mutate((s) => {
      summary(s).properties.grounds.items.properties.kind.enum.reverse()
    })
    mutate((s) => {
      summary(s).properties.text = { type: 'string' }
    })
    mutate((s) => {
      summary(s).required.reverse()
    })
    mutate((s) => {
      summary(s).additionalProperties = true
    })
    mutate((s) => {
      s.properties.result.oneOf[1].properties.outcome = { const: 'compatible' }
    })
    variants.push(
      typedSummaryWithIds(['0:40']),
      typedSummaryWithIds(['4:40', '4:40']),
      historicalV31WithIds(['4:40', '3:30']),
      historicalGeneratedSummaryWithIds(['4:40', '3:30']),
      summaryWithIds(['4:40', '3:30']),
      excerptsWithIds(['4:40', '3:30']),
      historicalBudgetedWithIds(['4:40', '3:30'], 2),
    )
    const f = fixture(sanitizeSyntheticEvidence, typedSummaryOptions())
    f.observer.arm('reject-v32-drift')
    for (const jsonSchema of variants) {
      const message = { ...request(729), payload: { jsonSchema, noThink: true } }
      const before = JSON.stringify(message)
      f.child.postMessage(message)
      f.child.emit('message', { id: 729, ok: true, result: { raw: 'PRIVATE' } })
      expect(f.observer.drain()).toEqual([])
      expect(f.calls.at(-1)?.[0]).toBe(message)
      expect(JSON.stringify(message)).toBe(before)
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
    }
    f.observer.dispose()
  })

  it('keeps v32 unavailable to historical-only templates and retired string-policy requests', () => {
    for (const config of [
      historicalGeneratedSummaryOptions(),
      budgetedExcerptsOptions(),
      {
        ...dynamicOptions(),
        alternateExpectedSchemaJson: JSON.stringify(historicalV31WithIds(['1:10'])),
      },
    ]) {
      const f = fixture(sanitizeSyntheticEvidence, config)
      f.observer.arm('no-implicit-v32')
      f.child.postMessage({
        ...request(730),
        payload: { jsonSchema: typedSummaryWithIds(['4:40']), noThink: true },
      })
      f.child.emit('message', { id: 730, ok: true, result: { raw: 'PRIVATE' } })
      expect(f.observer.drain()).toEqual([])
      f.observer.dispose()
    }
    const f = fixture(sanitizeSyntheticEvidence, {
      ...typedSummaryOptions(),
      historicalExcerptPolicy: 'typed-comparison-v24',
    })
    f.observer.arm('no-v32-string-policy')
    f.child.postMessage({
      ...request(731),
      payload: {
        jsonSchema: typedSummaryWithIds(['4:40']),
        noThink: true,
        jsonStringPolicy: 'source-excerpts',
      },
    })
    f.child.emit('message', { id: 731, ok: true, result: { raw: 'PRIVATE' } })
    expect(f.observer.drain()).toEqual([])
    f.observer.dispose()
  })

  it('preserves explicit v31 replay admission without admitting it through the v32 template', () => {
    const f = fixture(sanitizeSyntheticEvidence, {
      ...dynamicOptions(),
      alternateExpectedSchemaJson: JSON.stringify(historicalV31WithIds(['1:10'])),
    })
    f.observer.arm('historical-v31')
    const message = {
      ...request(732),
      payload: { jsonSchema: historicalV31WithIds(['4:40', '3:30']), noThink: true },
    }
    f.child.postMessage(message)
    f.child.emit('message', { id: 732, ok: true, result: { raw: '{}' } })
    expect(f.observer.drain()).toHaveLength(1)
    expect(f.calls.at(-1)?.[0]).toBe(message)
    f.observer.dispose()
  })

  it('requires the exact historical v29 marker budget, shape and catalog while rejecting other families', () => {
    const variants: ReturnType<typeof historicalGeneratedSummaryWithIds>[] = []
    const mutate = (
      change: (schema: ReturnType<typeof historicalGeneratedSummaryWithIds>) => void,
    ) => {
      const schema = historicalGeneratedSummaryWithIds(['4:40', '3:30'])
      change(schema)
      variants.push(schema)
    }
    const summary = (s: ReturnType<typeof historicalGeneratedSummaryWithIds>) =>
      s.properties.result.oneOf[1].properties.summary
    mutate((s) => {
      summary(s).properties.text.maxLength++
    })
    mutate((s) => {
      summary(s).properties.text.maxLength--
    })
    mutate((s) => {
      summary(s).properties.text.minLength = 0
    })
    mutate((s) => {
      summary(s).properties.sources.maxItems = 5
    })
    mutate((s) => {
      summary(s).properties.sources.items.enum = [
        ...summary(s).properties.sources.items.enum,
      ].reverse()
    })
    mutate((s) => {
      summary(s).properties.sources.items.enum = summary(s).properties.sources.items.enum.slice(
        0,
        1,
      )
    })
    mutate((s) => {
      summary(s).required.reverse()
    })
    mutate((s) => {
      summary(s).additionalProperties = true
    })
    mutate((s) => {
      summary(s).properties.PRIVATE = { type: 'string' }
    })
    mutate((s) => {
      s.properties.result.oneOf[1].properties.outcome = { const: 'compatible' }
    })
    mutate((s) => {
      s.properties.result.oneOf[1].required.reverse()
    })
    mutate((s) => {
      s.properties.result.oneOf.push(s.properties.result.oneOf[1])
    })
    variants.push(
      historicalBudgetedWithIds(['4:40', '3:30']),
      historicalBudgetedWithIds(['4:40', '3:30'], 2),
      excerptsWithIds(['4:40', '3:30']),
      summaryWithIds(['4:40', '3:30']),
    )
    const f = fixture(sanitizeSyntheticEvidence, historicalGeneratedSummaryOptions())
    f.observer.arm('reject-summary-drift')
    for (const jsonSchema of variants) {
      f.child.postMessage({ ...request(727), payload: { jsonSchema, noThink: true } })
      f.child.emit('message', { id: 727, ok: true, result: { raw: 'PRIVATE' } })
      expect(f.observer.drain()).toEqual([])
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
    }
    f.observer.dispose()
  })

  it('does not admit current summaries under historical v28 or the retired v24 policy', () => {
    for (const historical of [false, true]) {
      const f = fixture(
        sanitizeSyntheticEvidence,
        historical
          ? budgetedExcerptsOptions()
          : {
              ...historicalGeneratedSummaryOptions(),
              historicalExcerptPolicy: 'typed-comparison-v24',
            },
      )
      f.observer.arm('summary-family-policy')
      f.child.postMessage({
        ...request(728),
        payload: {
          jsonSchema: historicalGeneratedSummaryWithIds(['4:40']),
          noThink: true,
          ...(!historical ? { jsonStringPolicy: 'source-excerpts' } : {}),
        },
      })
      f.child.emit('message', { id: 728, ok: true, result: { raw: 'PRIVATE' } })
      expect(f.observer.drain()).toEqual([])
      f.observer.dispose()
    }
  })

  const legacyExcerptsWithIds = (ids: unknown[]) => {
    // Fixed v24/v25 bootstrap; do not mutate historical reports or fixtures.
    const schema = excerptsWithIds(ids)
    const item = schema.properties.result.oneOf[1].properties.evidence.items
    item.properties = {
      source: item.properties.source,
      label: { type: 'string', minLength: 1, maxLength: 64 },
      excerpts: item.properties.excerpts,
    }
    item.required = ['source', 'label', 'excerpts']
    return schema
  }
  const legacyExcerptsOptions = () => ({
    ...dynamicOptions(),
    alternateExpectedSchemaJson: JSON.stringify(legacyExcerptsWithIds(['1:10'])),
    captureSourceLabelShapes: true,
    historicalExcerptPolicy: 'typed-comparison-v24' as const,
  })

  it('requires a historical v24 bootstrap for the retired policy and never admits it for v26', () => {
    const legacyWithoutPolicy = legacyExcerptsOptions()
    delete (legacyWithoutPolicy as { historicalExcerptPolicy?: string }).historicalExcerptPolicy
    for (const [observerOptions, jsonSchema] of [
      [legacyWithoutPolicy, legacyExcerptsWithIds(['4:40'])],
      [
        { ...excerptsOptions(), historicalExcerptPolicy: 'typed-comparison-v24' as const },
        excerptsWithIds(['4:40']),
      ],
    ] as const) {
      const f = fixture(sanitizeSyntheticEvidence, observerOptions)
      f.observer.arm('retired-policy')
      const message = {
        ...request(718),
        payload: { jsonSchema, noThink: true, jsonStringPolicy: 'source-excerpts' },
      }
      expect(f.child.postMessage(message)).toBe(f.response)
      f.child.emit('message', { id: 718, ok: true, result: { raw: 'PRIVATE' } })
      expect(f.observer.drain()).toEqual([])
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0 })
      f.observer.dispose()
    }
  })

  it('keeps current caption drift anonymous and parses historical caption lengths only explicitly', () => {
    const raw = JSON.stringify({
      check: 'PRIVATE_CHECK',
      result: {
        evidence: [{ source: '4:40', label: 'PRIVATE_LABEL', excerpts: ['PRIVATE_EXCERPT'] }],
      },
    })
    const current = sanitizeSyntheticEvidence(raw, { sourceLabelShapes: true })
    expect(current.evidence[0]?.object).toMatchObject({
      knownKeys: ['source', 'excerpts'],
      unknownKeyCount: 1,
    })
    expect(current.evidence[0]).not.toHaveProperty('label')
    const historical = sanitizeSyntheticEvidence(raw, {
      sourceLabelShapes: true,
      legacyExcerptLabels: true,
    })
    expect(historical.evidence[0]).toMatchObject({
      object: { knownKeys: ['source', 'label', 'excerpts'], unknownKeyCount: 0 },
      label: { type: 'string', codepoints: 13 },
    })
    expect(JSON.stringify([current, historical])).not.toMatch(/PRIVATE|4:40/)
  })

  it('retains only explicitly bootstrapped historical v24 policy and absent-policy rows', () => {
    const install = runInNewContext(
      `(${installSyntheticWorkerObserver.toString()})`,
    ) as typeof installSyntheticWorkerObserver
    const sanitize = runInNewContext(
      `(${sanitizeSyntheticEvidence.toString()})`,
    ) as typeof sanitizeSyntheticEvidence
    const f = fixture(sanitize, legacyExcerptsOptions(), install)
    for (const explicit of [false, true]) {
      f.observer.arm('requested-policy')
      const message = {
        ...request(716),
        payload: {
          jsonSchema: legacyExcerptsWithIds(['4:40', '3:30']),
          noThink: true,
          prompt: 'PRIVATE',
          ...(explicit ? { jsonStringPolicy: 'source-excerpts' } : {}),
        },
      }
      const before = JSON.stringify(message)
      expect(f.child.postMessage(message)).toBe(f.response)
      expect(f.calls.at(-1)?.[0]).toBe(message)
      f.child.emit('message', { id: 716, ok: false })
      const rows = f.observer.drain()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('worker-error')
      if (explicit) expect(rows[0]?.requestedJsonStringPolicy).toBe('source-excerpts')
      else expect(rows[0]).not.toHaveProperty('requestedJsonStringPolicy')
      expect(JSON.stringify(message)).toBe(before)
      expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|4:40|3:30/)
    }
    f.observer.dispose()
  })

  it('refuses unknown and mismatched requested policies without changing forwarding or admitting replies', () => {
    const f = fixture(sanitizeSyntheticEvidence, excerptsOptions())
    const variants = [
      ...['source-excerpts', 'PRIVATE', 'default', null, undefined, 0, { text: 'PRIVATE' }].map(
        (jsonStringPolicy) => ({
          jsonSchema: excerptsWithIds(['4:40']),
          jsonStringPolicy,
        }),
      ),
      { jsonSchema: withIds(['4:40']), jsonStringPolicy: 'source-excerpts' },
      { jsonSchema: summaryWithIds(['4:40']), jsonStringPolicy: 'source-excerpts' },
      { jsonSchema: withIds(['4:40'], true), jsonStringPolicy: 'source-excerpts' },
    ]
    f.observer.arm('reject-policy')
    for (const payload of variants) {
      const message = { ...request(717), payload: { ...payload, noThink: true } }
      expect(f.child.postMessage(message)).toBe(f.response)
      expect(f.calls.at(-1)?.[0]).toBe(message)
      f.child.emit('message', { id: 717, ok: true, result: { raw: 'PRIVATE' } })
      expect(f.observer.drain()).toEqual([])
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
    }
    f.observer.dispose()
  })

  it('admits explicit historical v28 source-budgeted excerpts with exact forwarding and content-free counts', () => {
    const jsonSchema = historicalBudgetedWithIds(['4:40', '3:30'], 2)
    const before = JSON.stringify(jsonSchema)
    const install = runInNewContext(
      `(${installSyntheticWorkerObserver.toString()})`,
    ) as typeof installSyntheticWorkerObserver
    const sanitize = runInNewContext(
      `(${sanitizeSyntheticEvidence.toString()})`,
    ) as typeof sanitizeSyntheticEvidence
    const f = fixture(sanitize, budgetedExcerptsOptions(), install)
    f.observer.arm('excerpts-admission')
    const message = {
      ...request(713),
      payload: {
        jsonSchema,
        prompt: 'PRIVATE_PROMPT',
        noThink: true,
      },
    }
    expect(f.child.postMessage(message)).toBe(f.response)
    expect(f.calls[0]?.[0]).toBe(message)
    const reply = {
      id: 713,
      ok: true,
      result: {
        raw: JSON.stringify({
          check: 'PRIVATE_CHECK',
          result: {
            resolution: 'comparison',
            recordCount: 2,
            evidence: [
              {
                source: '4:40',
                fragmentCount: 1,
                excerpts: ['PRIVATE_EXCERPT (doc:4:40)'],
              },
              { source: '3:30', fragmentCount: 1, excerpts: ['PRIVATE_OTHER'] },
            ],
            outcome: 'unresolved',
          },
        }),
      },
    }
    const responseBefore = JSON.stringify(reply)
    f.child.emit('message', reply)
    const rows = f.observer.drain()
    expect(rows).toEqual([
      expect.objectContaining({
        status: 'completed',
        capture: expect.objectContaining({
          evidence: [
            expect.objectContaining({
              object: expect.objectContaining({
                knownKeys: ['source', 'fragmentCount', 'excerpts'],
                unknownKeyCount: 0,
              }),
              fragmentCount: { type: 'number', value: 1 },
              excerpts: expect.objectContaining({ type: 'array', length: 1, inspected: 1 }),
            }),
            expect.objectContaining({
              fragmentCount: { type: 'number', value: 1 },
              excerpts: expect.objectContaining({ type: 'array', length: 1, inspected: 1 }),
            }),
          ],
          structure: expect.objectContaining({ recordCount: { type: 'number', value: 2 } }),
          sourceLabelShapes: expect.objectContaining({
            candidates: 0,
            inspectedChars: 0,
            inspectedBlocks: 0,
          }),
        }),
      }),
    ])
    expect(rows[0]).not.toHaveProperty('requestedJsonStringPolicy')
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|4:40|3:30/)
    expect(JSON.stringify(jsonSchema)).toBe(before)
    expect(JSON.stringify(reply)).toBe(responseBefore)
    expect(f.observer.status()).toMatchObject({ observerErrors: 0, pending: 0 })
    f.observer.dispose()
  })

  it('admits the bounded historical v28 32-source catalog only with its explicit bootstrap', () => {
    const schema = historicalBudgetedWithIds(
      Array.from(
        { length: 32 },
        (_, index) => `${8_007_199_254_740_000 + index}:${7_007_199_254_740_000 + index}`,
      ),
      2,
    )
    const encoded = JSON.stringify(schema)
    expect(encoded.length).toBeGreaterThan(64_000)
    expect(encoded.length).toBeLessThanOrEqual(256_000)
    const variants = JSON.parse(encoded).properties.result.oneOf
    expect(variants).toHaveLength(4)
    expect(
      variants
        .slice(1)
        .reduce(
          (count: number, variant: { properties: { evidence: { items: { oneOf: unknown[] } } } }) =>
            count + variant.properties.evidence.items.oneOf.length,
          0,
        ),
    ).toBe(288)
    const f = fixture(sanitizeSyntheticEvidence, budgetedExcerptsOptions())
    f.observer.arm('maximum-catalog')
    f.child.postMessage({ ...request(722), payload: { jsonSchema: schema, noThink: true } })
    f.child.emit('message', { id: 722, ok: true, result: { raw: '{}' } })
    const rows = f.observer.drain()
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toMatch(/8007199|7007199|Alpha|Fixture/)
    expect(JSON.stringify(schema)).toBe(encoded)
    f.observer.dispose()
  })

  it('never admits the retired string policy for the current budgeted contract', () => {
    const f = fixture(sanitizeSyntheticEvidence, {
      ...budgetedExcerptsOptions(),
      historicalExcerptPolicy: 'typed-comparison-v24',
    })
    f.observer.arm('no-current-string-policy')
    f.child.postMessage({
      ...request(723),
      payload: {
        jsonSchema: historicalBudgetedWithIds(['1:10'], 2),
        noThink: true,
        jsonStringPolicy: 'source-excerpts',
      },
    })
    f.child.emit('message', { id: 723, ok: true, result: { raw: 'PRIVATE' } })
    expect(f.observer.drain()).toEqual([])
    expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
    f.observer.dispose()
  })

  it('admits one-record v27 schemas only through an explicit historical bootstrap', () => {
    const install = runInNewContext(
      `(${installSyntheticWorkerObserver.toString()})`,
    ) as typeof installSyntheticWorkerObserver
    const sanitize = runInNewContext(
      `(${sanitizeSyntheticEvidence.toString()})`,
    ) as typeof sanitizeSyntheticEvidence
    const f = fixture(sanitize, historicalBudgetedOptions(), install)
    f.observer.arm('historical-budgeted')
    const message = {
      ...request(724),
      payload: { jsonSchema: historicalBudgetedWithIds(['4:40', '3:30']), noThink: true },
    }
    const before = JSON.stringify(message)
    expect(f.child.postMessage(message)).toBe(f.response)
    f.child.emit('message', {
      id: 724,
      ok: true,
      result: {
        raw: JSON.stringify({
          check: 'PRIVATE_CHECK',
          result: {
            resolution: 'comparison',
            recordCount: 1,
            evidence: [{ source: '4:40', fragmentCount: 1, excerpts: ['PRIVATE_EXCERPT'] }],
            outcome: 'unresolved',
          },
        }),
      },
    })
    const rows = f.observer.drain()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'completed',
      capture: { structure: { recordCount: { type: 'number', value: 1 } } },
    })
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|4:40|3:30/)
    expect(JSON.stringify(message)).toBe(before)
    f.observer.arm('reject-current-under-historical')
    f.child.postMessage({
      ...request(725),
      payload: { jsonSchema: historicalBudgetedWithIds(['1:10'], 2), noThink: true },
    })
    f.child.emit('message', { id: 725, ok: true, result: { raw: 'PRIVATE' } })
    expect(f.observer.drain()).toEqual([])
    f.observer.dispose()

    const withoutExplicitBootstrap = historicalBudgetedOptions()
    delete (withoutExplicitBootstrap as { historicalExcerptBudgets?: string })
      .historicalExcerptBudgets
    expect(() => fixture(sanitize, withoutExplicitBootstrap, install)).toThrow(
      'Invalid synthetic observer schema',
    )
  })

  it('retains only bounded integer count metadata for explicitly budgeted excerpts', () => {
    const capture = (recordCount: unknown, fragmentCount: unknown) =>
      sanitizeSyntheticEvidence(
        JSON.stringify({
          check: 'PRIVATE_CHECK',
          result: {
            resolution: 'comparison',
            recordCount,
            evidence: [
              {
                source: '82716:71625',
                fragmentCount,
                excerpts: ['PRIVATE_EXCERPT'],
              },
            ],
            outcome: 'unresolved',
          },
        }),
        { budgetedExcerptCounts: true, sourceLabelShapes: true },
      )
    expect(capture(4, 3)).toMatchObject({
      structure: { recordCount: { type: 'number', value: 4 } },
      evidence: [{ fragmentCount: { type: 'number', value: 3 } }],
    })
    for (const value of [
      'PRIVATE_COUNT',
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER,
      null,
      { PRIVATE: 'PRIVATE' },
      ['PRIVATE'],
    ]) {
      const result = capture(value, value)
      expect(result).toMatchObject({
        structure: { recordCount: expect.any(Object) },
        evidence: [{ fragmentCount: expect.any(Object) }],
      })
      if (result.envelopeParsed) expect(result.structure.recordCount).not.toHaveProperty('value')
      expect(result.evidence[0]?.fragmentCount).not.toHaveProperty('value')
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE|82716|71625/)
    }
    expect(capture(5, 4)).toMatchObject({
      structure: { recordCount: { type: 'number' } },
      evidence: [{ fragmentCount: { type: 'number' } }],
    })
    expect(
      sanitizeSyntheticEvidence(
        JSON.stringify({
          result: {
            recordCount: 2,
            evidence: [{ source: '1:10', fragmentCount: 1, excerpts: ['PRIVATE'] }],
          },
        }),
      ),
    ).not.toHaveProperty('structure.recordCount')
  })

  it('rejects v28 count, branch, ordering, source and length drift within the bounded dynamic family', () => {
    const fresh = () => JSON.parse(JSON.stringify(historicalBudgetedWithIds(['1:10'], 2)))
    const variants: ReturnType<typeof fresh>[] = []
    const mutate = (change: (schema: ReturnType<typeof fresh>) => void) => {
      const schema = fresh()
      change(schema)
      variants.push(schema)
    }
    mutate((s) => {
      s.properties.result.oneOf[1].properties.recordCount.const = 0
    })
    mutate((s) => {
      const first = s.properties.result.oneOf[1].properties
      first.recordCount.const = 1
      first.evidence.minItems = first.evidence.maxItems = 1
    })
    mutate((s) => {
      s.properties.result.oneOf.splice(1, 1)
    })
    mutate((s) => {
      s.properties.result.oneOf[1].properties.recordCount.const = 'PRIVATE'
    })
    mutate((s) => {
      s.properties.result.oneOf[1].properties.evidence.maxItems = 4
    })
    mutate((s) => {
      s.properties.result.oneOf[1].properties.evidence.items.oneOf = []
    })
    mutate((s) => {
      s.properties.result.oneOf.push(s.properties.result.oneOf[1])
    })
    mutate((s) => {
      s.properties.result.oneOf.reverse()
    })
    mutate((s) => {
      s.properties.result.oneOf[1].properties.outcome = { const: 'compatible' }
    })
    const item = (s: ReturnType<typeof fresh>) =>
      s.properties.result.oneOf[1].properties.evidence.items.oneOf[0]
    mutate((s) => {
      item(s).properties.source.const = '9:90'
    })
    mutate((s) => {
      item(s).properties.source = { enum: ['1:10'] }
    })
    mutate((s) => {
      item(s).properties.fragmentCount.const = 4
    })
    mutate((s) => {
      item(s).properties.fragmentCount.const = 'PRIVATE'
    })
    mutate((s) => {
      item(s).properties.excerpts.minItems = 0
    })
    mutate((s) => {
      item(s).properties.excerpts.maxItems = 3
    })
    mutate((s) => {
      item(s).properties.excerpts.items.maxLength = 161
    })
    mutate((s) => {
      item(s).properties.excerpts.items.maxLength = 0
    })
    mutate((s) => {
      item(s).properties.excerpts.items.maxLength = 1.5
    })
    mutate((s) => {
      item(s).properties.PRIVATE = { type: 'string' }
    })
    mutate((s) => {
      item(s).additionalProperties = true
    })
    mutate((s) => {
      item(s).required = ['source', 'excerpts', 'fragmentCount']
    })
    mutate((s) => {
      const fields = item(s).properties
      item(s).properties = {
        source: fields.source,
        excerpts: fields.excerpts,
        fragmentCount: fields.fragmentCount,
      }
    })
    mutate((s) => {
      const choices = s.properties.result.oneOf[1].properties.evidence.items.oneOf
      choices.push(choices[0])
    })
    mutate((s) => {
      s.properties.result.oneOf[1].properties.evidence.items.oneOf.reverse()
    })
    variants.push(
      excerptsWithIds(['1:10']),
      legacyExcerptsWithIds(['1:10']),
      historicalBudgetedWithIds(['1:10']),
    )
    const f = fixture(sanitizeSyntheticEvidence, budgetedExcerptsOptions())
    f.observer.arm('reject-budget-drift')
    for (const jsonSchema of variants) {
      const message = { ...request(719), payload: { jsonSchema, noThink: true } }
      f.child.postMessage(message)
      f.child.emit('message', { id: 719, ok: true, result: { raw: 'PRIVATE' } })
      expect(f.observer.drain()).toEqual([])
      expect(f.calls.at(-1)?.[0]).toBe(message)
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
    }
    f.observer.dispose()
  })

  it('admits feasible dynamic omissions and bounded lengths only with the current template', () => {
    const f = fixture(sanitizeSyntheticEvidence, budgetedExcerptsOptions())
    for (const ordinaryOnly of [false, true]) {
      const schema = JSON.parse(JSON.stringify(historicalBudgetedWithIds(['1:10'], 2)))
      if (ordinaryOnly) schema.properties.result.oneOf.splice(1)
      else {
        schema.properties.result.oneOf.splice(2)
        const choices = schema.properties.result.oneOf[1].properties.evidence.items.oneOf
        choices.splice(1)
        choices[0].properties.excerpts.items.maxLength = 1
      }
      f.observer.arm('dynamic-budget')
      f.child.postMessage({ ...request(720), payload: { jsonSchema: schema, noThink: true } })
      f.child.emit('message', { id: 720, ok: true, result: { raw: '{}' } })
      expect(f.observer.drain()).toHaveLength(1)
    }
    f.observer.dispose()
    const legacy = fixture(sanitizeSyntheticEvidence, excerptsOptions())
    legacy.observer.arm('no-implicit-current')
    legacy.child.postMessage({
      ...request(720),
      payload: { jsonSchema: historicalBudgetedWithIds(['1:10'], 2), noThink: true },
    })
    legacy.child.emit('message', { id: 720, ok: true, result: { raw: '{}' } })
    expect(legacy.observer.drain()).toEqual([])
    legacy.observer.dispose()
  })

  it('rejects historical v26 excerpts catalog, branch, order and bound drift', () => {
    const variants = []
    for (const ids of [['3:30', '4:40'], ['4:40'], ['4:40', '9:90']]) {
      const value = excerptsWithIds(['4:40', '3:30'])
      value.properties.result.oneOf[1].properties.evidence.items.properties.source.enum = ids
      variants.push(value)
    }
    const mutate = (
      change: (
        branch: ReturnType<typeof excerptsWithIds>['properties']['result']['oneOf'][number],
      ) => void,
    ) => {
      const value = excerptsWithIds(['4:40', '3:30'])
      change(value.properties.result.oneOf[1])
      variants.push(value)
    }
    mutate((branch) => {
      branch.properties.outcome = { enum: ['compatible', 'unresolved'] }
    })
    mutate((branch) => {
      branch.properties.evidence.maxItems = 5
    })
    mutate((branch) => {
      branch.properties.evidence.minItems = 0
    })
    mutate((branch) => {
      branch.properties.evidence.items.properties.label = {
        type: 'string',
        minLength: 1,
        maxLength: 64,
      }
    })
    mutate((branch) => {
      branch.properties.evidence.items.properties.excerpts.maxItems = 4
    })
    mutate((branch) => {
      branch.properties.evidence.items.properties.excerpts.items.maxLength = 161
    })
    mutate((branch) => {
      branch.properties.evidence.items.properties.PRIVATE = { type: 'string' }
    })
    mutate((branch) => {
      branch.properties.evidence.items.additionalProperties = true
    })
    mutate((branch) => {
      branch.properties.evidence.items.required = ['excerpts', 'source']
    })
    mutate((branch) => {
      const fields = branch.properties.evidence.items.properties
      branch.properties.evidence.items.properties = {
        excerpts: fields.excerpts,
        source: fields.source,
      }
    })
    const extraBranch = excerptsWithIds(['4:40', '3:30'])
    extraBranch.properties.result.oneOf.push(extraBranch.properties.result.oneOf[1])
    variants.push(
      extraBranch,
      excerptsWithIds(['0:40']),
      excerptsWithIds(['4:40', '4:40']),
      excerptsWithIds(['9007199254740992:40']),
      summaryWithIds(['4:40']),
      withIds(['4:40'], true),
    )
    const expected = excerptsWithIds(['4:40', '3:30'])
    expect(expected.properties.result.oneOf).toHaveLength(2)
    const branch = expected.properties.result.oneOf[1]
    expect(Object.keys(branch.properties)).toEqual(['resolution', 'evidence', 'outcome'])
    expect(branch.properties.outcome).toEqual({ const: 'unresolved' })
    expect(branch.properties.evidence).toMatchObject({ minItems: 1, maxItems: 4 })
    expect(branch.properties.evidence.items.required).toEqual(['source', 'excerpts'])
    expect(branch.properties.evidence.items.properties).toMatchObject({
      excerpts: { minItems: 1, maxItems: 3, items: { minLength: 1, maxLength: 160 } },
    })
    const f = fixture(sanitizeSyntheticEvidence, excerptsOptions())
    f.observer.arm('reject-excerpts-drift')
    for (const jsonSchema of variants) {
      const message = { ...request(714), payload: { jsonSchema, noThink: true } }
      f.child.postMessage(message)
      f.child.emit('message', { id: 714, ok: true, result: { raw: 'PRIVATE_REPLY' } })
      expect(f.calls.at(-1)?.[0]).toBe(message)
      expect(f.observer.drain()).toEqual([])
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
    }
    f.observer.dispose()
  })

  it('does not implicitly admit excerpts through legacy full/summary templates', () => {
    const f = fixture(sanitizeSyntheticEvidence, summaryOptions())
    f.observer.arm('reject-unconfigured-excerpts')
    f.child.postMessage({
      ...request(715),
      payload: { jsonSchema: excerptsWithIds(['4:40']), noThink: true },
    })
    f.child.emit('message', { id: 715, ok: true, result: { raw: 'PRIVATE_REPLY' } })
    expect(f.observer.drain()).toEqual([])
    expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
    f.observer.dispose()
  })

  it('preserves explicit historical summary admission in serialized capture without changing forwarding', () => {
    const bundle = buildCheckedContextBundle(
      'Compare the alternatives. Answer in one short sentence.',
      [4, 3].map((id) => ({
        document_id: id,
        chunk_id: id * 10,
        document_title: 'PRIVATE_TITLE',
        text: 'PRIVATE_SOURCE',
        ordinal: 0,
        page_from: null,
        page_to: null,
        heading_path: null,
        language: 'en',
        score: 1,
      })),
      'en',
    )
    const jsonSchema = summaryWithIds(['4:40', '3:30'])
    const before = JSON.stringify(jsonSchema)
    const install = runInNewContext(
      `(${installSyntheticWorkerObserver.toString()})`,
    ) as typeof installSyntheticWorkerObserver
    const sanitize = runInNewContext(
      `(${sanitizeSyntheticEvidence.toString()})`,
    ) as typeof sanitizeSyntheticEvidence
    const f = fixture(sanitize, summaryOptions(), install)
    f.observer.arm('summary-admission')
    const message = {
      ...request(710),
      payload: { jsonSchema, prompt: bundle.prompt, noThink: true },
    }
    expect(f.child.postMessage(message)).toBe(f.response)
    expect(f.calls[0]?.[0]).toBe(message)
    const reply = {
      id: 710,
      ok: true,
      result: {
        raw: JSON.stringify({
          check: 'PRIVATE_CHECK',
          result: {
            resolution: 'comparison',
            summary: { text: 'PRIVATE_BODY (doc:4, chunk:40)', sources: ['4:40', '3:30'] },
            outcome: 'unresolved',
          },
        }),
      },
    }
    const responseBefore = JSON.stringify(reply)
    f.child.emit('message', reply)
    const rows = f.observer.drain()
    expect(rows).toEqual([
      expect.objectContaining({
        status: 'completed',
        capture: expect.objectContaining({
          structure: expect.objectContaining({
            summary: expect.objectContaining({ types: { text: 'string', sources: 'array' } }),
          }),
          sourceLabelShapes: expect.objectContaining({
            candidates: 1,
            counts: expect.objectContaining({ comma_chunk_pair: 1 }),
          }),
        }),
      }),
    ])
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|4:40|3:30/)
    expect(JSON.stringify(jsonSchema)).toBe(before)
    expect(JSON.stringify(reply)).toBe(responseBefore)
    expect(f.observer.status()).toMatchObject({ observerErrors: 0, pending: 0 })
    f.observer.dispose()
  })

  it('requires exact summary text/sources order, bounds, catalogs and all other schema fields', () => {
    const variants = []
    for (const index of [1, 2]) {
      for (const ids of [['3:30', '4:40'], ['4:40'], ['4:40', '9:90']]) {
        const value = summaryWithIds(['4:40', '3:30'])
        value.properties.result.oneOf[index].properties.summary.properties.sources.items.enum = ids
        variants.push(value)
      }
      const order = summaryWithIds(['4:40', '3:30'])
      const summary = order.properties.result.oneOf[index].properties.summary
      summary.properties = { sources: summary.properties.sources, text: summary.properties.text }
      variants.push(order)
      const required = summaryWithIds(['4:40', '3:30'])
      required.properties.result.oneOf[index].properties.summary.required = ['sources', 'text']
      variants.push(required)
      const bound = summaryWithIds(['4:40', '3:30'])
      bound.properties.result.oneOf[index].properties.summary.properties.text.maxLength = 513
      variants.push(bound)
      const extra = summaryWithIds(['4:40', '3:30'])
      extra.properties.result.oneOf[index].properties.summary.properties.PRIVATE = {
        type: 'string',
      }
      variants.push(extra)
      const mixed = summaryWithIds(['4:40', '3:30'])
      mixed.properties.result.oneOf[index] = withIds(['4:40', '3:30']).properties.result.oneOf[
        index
      ]
      variants.push(mixed)
    }
    variants.push(
      summaryWithIds(['0:40']),
      summaryWithIds(['4:40', '4:40']),
      withIds(['4:40'], true),
    )
    const expected = summaryWithIds(['4:40', '3:30'])
    for (const branch of expected.properties.result.oneOf.slice(1)) {
      expect(Object.keys(branch.properties)).toEqual(['resolution', 'summary', 'outcome'])
      expect(Object.keys(branch.properties.summary.properties)).toEqual(['text', 'sources'])
      expect(branch.properties.summary.required).toEqual(['text', 'sources'])
      expect(branch.properties.summary.properties.text.maxLength).toBe(512)
    }
    const f = fixture(sanitizeSyntheticEvidence, summaryOptions())
    f.observer.arm('reject-summary-drift')
    for (const jsonSchema of variants) {
      const message = { ...request(711), payload: { jsonSchema, noThink: true } }
      f.child.postMessage(message)
      f.child.emit('message', { id: 711, ok: true, result: { raw: 'PRIVATE_REPLY' } })
      expect(f.calls.at(-1)?.[0]).toBe(message)
      expect(f.observer.drain()).toEqual([])
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
    }
    f.observer.dispose()
  })

  it('does not admit summaries through a legacy full/unit-only template', () => {
    const f = fixture(sanitizeSyntheticEvidence, {
      ...dynamicOptions(),
      alternateExpectedSchemaJson: JSON.stringify(catalogSchema(true)),
    })
    f.observer.arm('reject-unconfigured-summary')
    f.child.postMessage({
      ...request(712),
      payload: { jsonSchema: summaryWithIds(['4:40']), noThink: true },
    })
    f.child.emit('message', { id: 712, ok: true, result: { raw: 'PRIVATE_REPLY' } })
    expect(f.observer.drain()).toEqual([])
    expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
    f.observer.dispose()
  })

  it('adds opt-in shape counts only after exact current request admission, including serialized execution', () => {
    const install = runInNewContext(
      `(${installSyntheticWorkerObserver.toString()})`,
    ) as typeof installSyntheticWorkerObserver
    const sanitize = runInNewContext(
      `(${sanitizeSyntheticEvidence.toString()})`,
    ) as typeof sanitizeSyntheticEvidence
    const f = fixture(sanitize, { ...dynamicOptions(), captureSourceLabelShapes: true }, install)
    const valid = withIds(['4:47'])
    const retired = {
      ...valid,
      properties: { result: valid.properties.result },
      required: ['result'],
    }
    const body = JSON.stringify({
      check: 'PRIVATE_CHECK (doc:91827:82916)',
      result: {
        resolution: 'answered',
        blocks: [{ text: 'PRIVATE_BODY ( doc : 82716 : 71625 )', sources: ['4:47'] }],
      },
    })
    f.observer.arm('shape-admission')
    const message = { ...request(701), payload: { jsonSchema: valid, noThink: true } }
    f.child.postMessage({ ...request(700), payload: { jsonSchema: retired, noThink: true } })
    f.child.emit('message', { id: 700, ok: true, result: { raw: body } })
    expect(f.observer.drain()).toEqual([])
    expect(f.observer.status()).toMatchObject({ armed: true, pending: 0 })
    expect(f.child.postMessage(message)).toBe(f.response)
    expect(f.calls.at(-1)?.[0]).toBe(message)
    f.child.emit('message', { id: 701, ok: true, result: { raw: body } })
    const rows = f.observer.drain()
    expect(rows).toEqual([
      expect.objectContaining({
        status: 'completed',
        capture: expect.objectContaining({
          sourceLabelShapes: expect.objectContaining({
            candidates: 1,
            counts: expect.objectContaining({ spaced_colon_pair: 1, exact_colon_pair: 0 }),
          }),
        }),
      }),
    ])
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|91827|82916|82716|71625|4:47/)
    f.observer.dispose()
  })

  it('does not enable label inspection for historical admission and isolates an opted-in callback failure', () => {
    const seen: unknown[] = []
    const legacy = fixture(
      (raw, options) => {
        seen.push(options)
        return sanitizeSyntheticEvidence(raw, options)
      },
      { ...options, captureSourceLabelShapes: true },
    )
    legacy.observer.arm('legacy')
    legacy.child.postMessage(request(702))
    legacy.child.emit('message', { id: 702, ok: true, result: { raw } })
    expect(seen).toEqual([undefined])
    expect(JSON.stringify(legacy.observer.drain())).not.toContain('sourceLabelShapes')
    legacy.observer.dispose()

    const attemptedOptions: unknown[] = []
    const f = fixture(
      (_raw, options) => {
        attemptedOptions.push(options)
        throw new Error('PRIVATE_SHAPE_ERROR')
      },
      { ...dynamicOptions(), captureSourceLabelShapes: true },
    )
    let delivered = 0
    f.child.on('message', () => {
      delivered++
    })
    f.observer.arm('shape-sink-error')
    const message = { ...request(703), payload: { jsonSchema: actualSchema(), noThink: true } }
    expect(f.child.postMessage(message)).toBe(f.response)
    expect(() => f.child.emit('message', { id: 703, ok: true, result: { raw } })).not.toThrow()
    expect(attemptedOptions).toEqual([{ sourceLabelShapes: true }])
    expect(delivered).toBe(1)
    const rows = f.observer.drain()
    expect(rows).toEqual([expect.objectContaining({ status: 'observer-error' })])
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|SHAPE_ERROR/)
    expect(f.observer.status()).toMatchObject({ pending: 0, observerErrors: 1 })
    f.observer.dispose()
  })

  it('matches the exact full schema after replacing only identical validated catalog enum IDs without changing forwarding', () => {
    const serialized = runInNewContext(
      `(${installSyntheticWorkerObserver.toString()})`,
    ) as typeof installSyntheticWorkerObserver
    const f = fixture(sanitizeSyntheticEvidence, dynamicOptions(), serialized)
    f.observer.arm('synthetic-dynamic')
    const changed = withIds(['4:47', '3:31', '9:9007199254740991'])
    const before = JSON.stringify(changed)
    const message = {
      ...request(99),
      payload: { jsonSchema: changed, prompt: 'PRIVATE_PROMPT', noThink: true },
    }
    const transfer = [{}]
    expect(f.child.postMessage(message, transfer)).toBe(f.response)
    expect(f.calls[0]?.[0]).toBe(message)
    expect(f.calls[0]?.[1]).toBe(transfer)
    expect(JSON.stringify(changed)).toBe(before)
    f.child.emit('message', { id: 99, ok: true, result: { raw } })
    expect(f.observer.drain()).toEqual([
      expect.objectContaining({ caseId: 'synthetic-dynamic', status: 'completed' }),
    ])
    expect(f.observer.status()).toMatchObject({ observerErrors: 0, pending: 0 })
    f.observer.dispose()
  })

  it.each([false, true])(
    'admits only the exact configured full or concise-unit contract: concise=%s',
    (concise) => {
      const serialized = runInNewContext(
        `(${installSyntheticWorkerObserver.toString()})`,
      ) as typeof installSyntheticWorkerObserver
      const config = {
        ...dynamicOptions(),
        alternateExpectedSchemaJson: JSON.stringify(catalogSchema(true)),
      }
      expect(catalogSchema(true).properties.result.oneOf).toHaveLength(3)
      expect(catalogSchema(true).properties.result.oneOf[1]!.properties).toHaveProperty('units')
      expect(actualSchema().properties.result.oneOf).toHaveLength(3)
      const f = fixture(sanitizeSyntheticEvidence, config, serialized)
      const changed = withIds(['4:47', '3:31'], concise)
      const before = JSON.stringify(changed)
      const message = {
        ...request(92),
        payload: { jsonSchema: changed, prompt: 'PRIVATE_PROMPT', noThink: true },
      }
      f.observer.arm('both-exact-contracts')
      expect(f.child.postMessage(message)).toBe(f.response)
      expect(f.calls[0]?.[0]).toBe(message)
      expect(JSON.stringify(changed)).toBe(before)
      f.child.emit('message', { id: 92, ok: true, result: { raw } })
      expect(f.observer.drain()).toEqual([
        expect.objectContaining({ status: 'completed', caseId: 'both-exact-contracts' }),
      ])
      expect(f.observer.status()).toMatchObject({ observerErrors: 0, pending: 0 })
      f.observer.dispose()
    },
  )

  it('does not implicitly authorize the other contract when only one exact template is configured', () => {
    for (const concise of [false, true]) {
      const f = fixture(sanitizeSyntheticEvidence, {
        ...dynamicOptions(),
        expectedSchemaJson: JSON.stringify(catalogSchema(concise)),
      })
      f.observer.arm('single-template')
      f.child.postMessage({
        ...request(93),
        payload: { jsonSchema: withIds(['2:20'], !concise), noThink: true },
      })
      f.child.emit('message', { id: 93, ok: true, result: { raw: 'PRIVATE_RAW' } })
      expect(f.observer.drain()).toEqual([])
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
      f.observer.dispose()
    }
  })

  it.each([false, true])(
    'admits check-first output and rejects the retired result-only schema: concise=%s',
    (concise) => {
      const install = runInNewContext(
        `(${installSyntheticWorkerObserver.toString()})`,
      ) as typeof installSyntheticWorkerObserver
      const config = {
        ...dynamicOptions(),
        alternateExpectedSchemaJson: JSON.stringify(catalogSchema(true)),
      }
      const current = withIds(['4:47', '3:31'], concise)
      expect(Object.keys(current.properties)).toEqual(['check', 'result'])
      expect(current.required).toEqual(['check', 'result'])
      expect(current.properties.check).toEqual({ type: 'string', minLength: 1, maxLength: 120 })
      const historical = {
        ...current,
        properties: {
          result: current.properties.result,
        },
        required: ['result'],
      }
      const reordered = {
        ...current,
        properties: { result: current.properties.result, check: current.properties.check },
        required: ['result', 'check'],
      }
      const enlarged = {
        ...current,
        properties: {
          ...current.properties,
          check: { ...current.properties.check, maxLength: 121 },
        },
      }
      const f = fixture(sanitizeSyntheticEvidence, config, install)
      f.observer.arm('check-first-admission')
      for (const schema of [historical, reordered, enlarged]) {
        f.child.postMessage({ ...request(95), payload: { jsonSchema: schema, noThink: true } })
        f.child.emit('message', { id: 95, ok: true, result: { raw: 'PRIVATE_RETIRED_REPLY' } })
        expect(f.observer.drain()).toEqual([])
        expect(f.observer.status()).toMatchObject({ armed: true, pending: 0 })
      }
      const message = { ...request(96), payload: { jsonSchema: current, noThink: true } }
      f.child.postMessage(message)
      expect(f.calls.at(-1)?.[0]).toBe(message)
      f.child.emit('message', {
        id: 96,
        ok: true,
        result: {
          raw: JSON.stringify({
            check: 'PRIVATE_CHECK',
            result: {
              resolution: 'answered',
              blocks: [{ text: 'PRIVATE_ANSWER', sources: ['4:47'] }],
            },
          }),
        },
      })
      const rows = f.observer.drain()
      expect(rows).toEqual([
        expect.objectContaining({
          status: 'completed',
          capture: expect.objectContaining({
            structure: expect.objectContaining({ check: { type: 'string', codepoints: 13 } }),
          }),
        }),
      ])
      expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|4:47/)
      f.observer.dispose()
    },
  )

  it('rejects branch, bounds, field-order and invalid-ID drift with both exact templates configured', () => {
    const extraBranch = withIds(['2:20'], true)
    extraBranch.properties.result.oneOf.push(actualSchema().properties.result.oneOf[1]!)
    const reordered = withIds(['2:20'], true)
    const properties = reordered.properties.result.oneOf[0]!.properties
    if (!('blocks' in properties)) throw new Error('Ordinary schema absent')
    const block = properties.blocks.items
    block.properties = { sources: block.properties.sources, text: block.properties.text }
    const bounds = withIds(['2:20'], true)
    const boundedOrdinary = bounds.properties.result.oneOf[0]!.properties
    if (!('blocks' in boundedOrdinary)) throw new Error('Ordinary schema absent')
    boundedOrdinary.blocks.items.properties.sources.maxItems = 31
    const extraField = { ...withIds(['2:20'], true), extra: 'PRIVATE' }
    for (const schema of [
      extraBranch,
      reordered,
      bounds,
      extraField,
      withIds(['0:20'], true),
      withIds(['2:20', '2:20'], true),
    ]) {
      const f = fixture(sanitizeSyntheticEvidence, {
        ...dynamicOptions(),
        alternateExpectedSchemaJson: JSON.stringify(catalogSchema(true)),
      })
      f.observer.arm('reject-contract-drift')
      const message = { ...request(94), payload: { jsonSchema: schema, noThink: true } }
      f.child.postMessage(message)
      f.child.emit('message', { id: 94, ok: true, result: { raw: 'PRIVATE_RAW' } })
      expect(f.calls[0]?.[0]).toBe(message)
      expect(f.observer.drain()).toEqual([])
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
      f.observer.dispose()
    }
  })

  it.each(
    [
      [],
      ['1:10', '1:10'],
      ['0:10'],
      ['01:10'],
      ['1:0'],
      ['1:9007199254740992'],
      ['1:10x'],
      [1],
      ['PRIVATE:10'],
      Array.from({ length: 33 }, (_, i) => `${i + 1}:10`),
    ].map((ids) => [ids]),
  )('does not observe a schema with invalid dynamic catalog IDs: %j', (ids) => {
    const f = fixture(sanitizeSyntheticEvidence, dynamicOptions())
    f.observer.arm('synthetic-rejected')
    const message = { ...request(7), payload: { jsonSchema: withIds(ids), noThink: true } }
    f.child.postMessage(message)
    f.child.emit('message', { id: 7, ok: true, result: { raw: 'PRIVATE_RAW' } })
    expect(f.calls[0]?.[0]).toBe(message)
    expect(f.observer.drain()).toEqual([])
    expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
    f.observer.dispose()
  })

  it('rejects added fields, changed bounds and field order outside the sole dynamic enum', () => {
    const extra = { ...withIds(['2:20']), unexpected: 'PRIVATE' }
    const bound = withIds(['2:20'])
    const boundedOrdinary = bound.properties.result.oneOf[0]!.properties
    if (!('blocks' in boundedOrdinary)) throw new Error('Ordinary schema absent')
    boundedOrdinary.blocks.items.properties.sources.maxItems = 31
    const fields = withIds(['2:20'])
    const ordinary = fields.properties.result.oneOf[0]!.properties
    if (!('blocks' in ordinary)) throw new Error('Ordinary schema absent')
    const block = ordinary.blocks.items
    block.properties = { sources: block.properties.sources, text: block.properties.text }
    const itemExtra = JSON.parse(JSON.stringify(withIds(['2:20'])))
    itemExtra.properties.result.oneOf[0].properties.blocks.items.properties.sources.items.private =
      'PRIVATE'
    for (const changed of [extra, bound, fields, itemExtra]) {
      const f = fixture(sanitizeSyntheticEvidence, dynamicOptions())
      f.observer.arm('synthetic-rejected')
      f.child.postMessage({ ...request(1), payload: { jsonSchema: changed, noThink: true } })
      f.child.emit('message', { id: 1, ok: true, result: { raw } })
      expect(f.observer.drain()).toEqual([])
      expect(f.observer.status().armed).toBe(true)
      f.observer.dispose()
    }
  })

  it.each([1, 2])('rejects a different comparison catalog or order at branch %s', (index) => {
    for (const ids of [['3:30', '2:20'], ['2:20'], ['2:20', '9:90']]) {
      const schema = withIds(['2:20', '3:30'])
      const properties = schema.properties.result.oneOf[index]!.properties
      if (!('sources' in properties)) throw new Error('Comparison schema absent')
      properties.sources.items.enum = ids
      const f = fixture(sanitizeSyntheticEvidence, dynamicOptions())
      f.observer.arm('different-catalog')
      const message = { ...request(1), payload: { jsonSchema: schema, noThink: true } }
      f.child.postMessage(message)
      f.child.emit('message', { id: 1, ok: true, result: { raw } })
      expect(f.calls[0]?.[0]).toBe(message)
      expect(f.observer.drain()).toEqual([])
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
      f.observer.dispose()
    }
  })

  it.each([1, 2])(
    'rejects obsolete comparison field order at branch %s without retaining its reply',
    (index) => {
      const schema = withIds(['2:20', '3:30'])
      const branch = schema.properties.result.oneOf[index]!
      const properties = branch.properties
      if (!('sources' in properties)) throw new Error('Comparison schema absent')
      branch.properties = {
        resolution: properties.resolution,
        outcome: properties.outcome,
        sources: properties.sources,
      }
      const f = fixture(sanitizeSyntheticEvidence, dynamicOptions())
      f.observer.arm('obsolete-order')
      const message = { ...request(1), payload: { jsonSchema: schema, noThink: true } }
      f.child.postMessage(message)
      f.child.emit('message', { id: 1, ok: true, result: { raw: 'PRIVATE_RAW' } })
      expect(f.calls[0]?.[0]).toBe(message)
      expect(f.observer.drain()).toEqual([])
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
      f.observer.dispose()
    },
  )

  const withUnits = (units: unknown[], branch?: number) => {
    const schema = withIds(
      branch === undefined && units.length === 1 ? ['4:47'] : ['4:47', '3:31'],
      true,
    )
    for (const index of branch === undefined ? [1, 2] : [branch]) {
      const properties = schema.properties.result.oneOf[index]!.properties
      if (!('units' in properties)) throw new Error('Concise comparison schema absent')
      properties.units.items.enum = units as string[]
    }
    return schema
  }

  it.each([1, 2, 256])(
    'admits the exact concise schema with all %s sequential unit labels',
    (count) => {
      const config = {
        ...dynamicOptions(),
        alternateExpectedSchemaJson: JSON.stringify(catalogSchema(true)),
      }
      const f = fixture(sanitizeSyntheticEvidence, config)
      const changed = withUnits(Array.from({ length: count }, (_, index) => `U${index + 1}`))
      const original = JSON.stringify(changed)
      const message = {
        ...request(76),
        payload: { jsonSchema: changed, prompt: 'PRIVATE', noThink: true },
      }
      f.observer.arm('units-admitted')
      f.child.postMessage(message)
      f.child.emit('message', { id: 76, ok: true, result: { raw } })
      expect(f.calls[0]?.[0]).toBe(message)
      expect(JSON.stringify(changed)).toBe(original)
      expect(f.observer.drain()).toEqual([expect.objectContaining({ status: 'completed' })])
      f.observer.dispose()
    },
  )

  it('rejects unit catalog gaps, duplication, order drift, oversized catalogs and mixed source/unit paths', () => {
    const mixed = withUnits(['U1'])
    mixed.properties.result.oneOf[2] = withIds(['4:47', '3:31']).properties.result.oneOf[2]!
    const underCovered = withIds(['4:47', '3:31'], true)
    for (const branch of underCovered.properties.result.oneOf.slice(1)) {
      if (!('units' in branch.properties)) throw new Error('Units absent')
      branch.properties.units.items.enum = ['U1']
    }
    const extra = JSON.parse(JSON.stringify(withUnits(['U1'])))
    extra.properties.result.oneOf[1].properties.units.items.extra = 'PRIVATE'
    const limit = withUnits(['U1'])
    const selection = limit.properties.result.oneOf[1]!.properties
    if (!('units' in selection)) throw new Error('Units absent')
    selection.units.maxItems = 5
    const changed = [
      ...[
        [],
        ['U0'],
        ['U01'],
        ['U1', 'U1'],
        ['U2', 'U1'],
        ['U1', 'U3'],
        [1],
        ['PRIVATE'],
        Array.from({ length: 257 }, (_, index) => `U${index + 1}`),
      ].map((ids) => withUnits(ids)),
      withUnits(['U1'], 1),
      mixed,
      underCovered,
      extra,
      limit,
    ]
    for (const schema of changed) {
      const f = fixture(sanitizeSyntheticEvidence, {
        ...dynamicOptions(),
        alternateExpectedSchemaJson: JSON.stringify(catalogSchema(true)),
      })
      const before = JSON.stringify(schema)
      const message = { ...request(77), payload: { jsonSchema: schema, noThink: true } }
      f.observer.arm('units-rejected')
      f.child.postMessage(message)
      f.child.emit('message', { id: 77, ok: true, result: { raw: 'PRIVATE_RAW' } })
      expect(f.calls[0]?.[0]).toBe(message)
      expect(JSON.stringify(schema)).toBe(before)
      expect(f.observer.drain()).toEqual([])
      expect(f.observer.status()).toMatchObject({ armed: true, pending: 0, observerErrors: 0 })
      f.observer.dispose()
    }
  })

  it('records unit-field type only, never selected unit values or source material', () => {
    const captured = sanitizeSyntheticEvidence(
      JSON.stringify({
        check: 'PRIVATE_CHECK',
        result: { resolution: 'comparison', units: ['U123'], outcome: 'unresolved' },
      }),
    )
    expect(captured.structure?.result.types).toMatchObject({ units: 'array' })
    expect(captured.evidence).toEqual([])
    expect(JSON.stringify(captured)).not.toMatch(/PRIVATE|U123/)
  })

  it('does not retain source ID values, answer strings or private check contents from ordinary replies', () => {
    const captured = sanitizeSyntheticEvidence(
      JSON.stringify({
        result: {
          resolution: 'answered',
          blocks: [{ text: 'PRIVATE_ANSWER', sources: ['999:999'] }],
        },
      }),
    )
    expect(captured.structure?.blocks).toMatchObject({
      records: [{ types: { text: 'string', sources: 'array' } }],
    })
    // Historical v13/v17 result-only output has no check; diagnostics must not
    // synthesize one. Check-bearing sanitizer inputs above remain supported.
    expect(captured.structure?.check).toEqual({ type: 'undefined' })
    expect(captured.evidence).toEqual([])
    expect(JSON.stringify(captured)).not.toMatch(/PRIVATE|999:999/)
    const comparison = sanitizeSyntheticEvidence(
      JSON.stringify({
        check: 'PRIVATE',
        result: { resolution: 'comparison', outcome: 'unresolved', sources: ['999:999'] },
      }),
    )
    expect(comparison.structure?.result.types).toMatchObject({ sources: 'array' })
    expect(JSON.stringify(comparison)).not.toMatch(/PRIVATE|999:999/)
  })

  it('preserves fork/postMessage receiver, arguments, transfer-list identity and return value', () => {
    const f = fixture()
    f.observer.arm('synthetic-01')
    const message = request(1),
      transfer = [{}]
    expect(f.child.postMessage(message, transfer)).toBe(f.response)
    expect(f.calls[0]?.[0]).toBe(message)
    expect(f.calls[0]?.[1]).toBe(transfer)
    expect(f.forkArgs[0]).toEqual([
      options.workerPath,
      ['unchanged'],
      { serviceName: 'loklm-models' },
    ])
    f.child.emit('message', { id: 1, ok: true, result: { raw } })
    expect(f.observer.drain()[0]).toMatchObject({
      caseId: 'synthetic-01',
      status: 'completed',
      capture: { envelopeParsed: true },
    })
    expect(f.observer.status().pending).toBe(0)
    f.observer.dispose()
  })
  it('ignores unrelated operations, unmatched schemas, backgrounds, unknown replies and pushes', () => {
    const f = fixture()
    f.observer.arm('synthetic-01')
    for (const message of [
      { id: 2, op: 'llm.load' },
      { ...request(3), payload: { jsonSchema: {} } },
      { ...request(4), payload: { jsonSchema: schema, background: true } },
    ])
      f.child.postMessage(message)
    f.child.emit('message', { id: 2, ok: true, result: { raw: 'PRIVATE' } })
    f.child.emit('message', { ev: 'log', message: 'PRIVATE' })
    expect(f.observer.drain()).toEqual([])
    expect(f.observer.status().armed).toBe(true)
    f.child.postMessage(request(5))
    f.child.emit('message', { data: { id: 5, ok: true, result: { raw } } })
    const rows = f.observer.drain()
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('PRIVATE')
    f.observer.dispose()
  })
  it('suppresses sanitizer failures without blocking the real message listener or retaining error text', () => {
    const f = fixture(() => {
      throw new Error('PRIVATE_RAW')
    })
    let delivered = false
    f.child.on('message', () => {
      delivered = true
    })
    f.observer.arm('synthetic-01')
    f.child.postMessage(request(1))
    expect(() => f.child.emit('message', { id: 1, ok: true, result: { raw } })).not.toThrow()
    expect(delivered).toBe(true)
    expect(f.observer.drain()).toEqual([expect.objectContaining({ status: 'observer-error' })])
    expect(f.observer.status().observerErrors).toBe(1)
    f.observer.dispose()
  })
  it('clears IDs on worker exit and restores only its own wrappers/listeners', () => {
    const f = fixture()
    const other = () => undefined
    f.child.on('message', other)
    f.observer.arm('synthetic-01')
    f.child.postMessage(request(1))
    f.child.emit('exit', 0)
    expect(f.observer.drain()[0]).toMatchObject({ status: 'worker-exited' })
    expect(f.observer.status().pending).toBe(0)
    expect(f.child.postMessage).toBe(f.originalPost)
    expect(f.child.listeners('message')).toEqual([other])
    f.observer.dispose()
    f.observer.dispose()
    expect(f.utility.fork).toBe(f.originalFork)
    expect(() => f.observer.arm('late')).toThrow()
  })
  it('does not intercept another worker path/service and preserves original send errors', () => {
    const error = new Error('original'),
      child = new EventEmitter() as EventEmitter & { postMessage: () => never }
    child.postMessage = () => {
      throw error
    }
    const original = child.postMessage,
      utility = { fork: () => child }
    const observer = installSyntheticWorkerObserver(utility, sanitizeSyntheticEvidence, options)
    ;(utility.fork as (...args: unknown[]) => typeof child)('/other.js', [], {
      serviceName: 'loklm-models',
    })
    expect(child.postMessage).toBe(original)
    ;(utility.fork as (...args: unknown[]) => typeof child)(options.workerPath, [], {
      serviceName: 'loklm-models',
    })
    observer.arm('synthetic-01')
    expect(() => (child.postMessage as (...args: unknown[]) => unknown)(request(1))).toThrow(error)
    expect(observer.status().pending).toBe(0)
    observer.dispose()
  })
  it('bounds retained replies, reports worker errors without their private message', () => {
    const f = fixture()
    for (let id = 1; id <= 35; id++) {
      f.observer.arm(`synthetic-${id}`)
      f.child.postMessage(request(id))
      f.child.emit('message', { id, ok: false, error: 'PRIVATE_GENERATION' })
    }
    const rows = f.observer.drain()
    expect(rows).toHaveLength(32)
    expect(f.observer.status().dropped).toBe(3)
    expect(JSON.stringify(rows)).not.toContain('PRIVATE')
    f.observer.dispose()
  })
  it('readonly method restoration failures remain diagnostic and cannot replace fork/cleanup behavior', () => {
    const f = fixture()
    Object.defineProperty(f.child, 'postMessage', {
      value: f.child.postMessage,
      writable: false,
      configurable: true,
    })
    expect(() => f.observer.dispose()).not.toThrow()
    expect(f.observer.status().observerErrors).toBe(1)
    expect(f.child.listeners('message')).toEqual([])
    const frozenChild = new EventEmitter() as EventEmitter & {
      postMessage: (...args: unknown[]) => unknown
    }
    Object.defineProperty(frozenChild, 'postMessage', { value: () => 'unchanged', writable: false })
    const utility: ObservableUtilityProcess = { fork: () => frozenChild }
    const observer = installSyntheticWorkerObserver(utility, sanitizeSyntheticEvidence, options)
    expect(utility.fork(options.workerPath, [], { serviceName: 'loklm-models' })).toBe(frozenChild)
    expect(observer.status().observerErrors).toBe(1)
    expect(frozenChild.postMessage()).toBe('unchanged')
    observer.dispose()
  })
})

import { describe, expect, it } from 'vitest'
import { describeCheckedAnswer } from '../evals/native-calibration/report'

describe('checked QA native treatment diagnostics', () => {
  it.each([
    ['typed-comparison-v31', 'full'],
    ['typed-comparison-v31', 'summary'],
    ['typed-comparison-v32', 'full'],
    ['typed-comparison-v32', 'summary'],
  ] as const)(
    'recognizes %s %s metadata without inferring semantic success',
    (schema, comparisonMode) => {
      const call = {
        schema,
        contextTokens: 4096,
        maxTokens: 2176,
        temperature: 0,
        repeatPenalty: false,
        comparisonMode,
        conciseUnitCount: 0,
        conciseFallbackReason: null,
      }
      const result = { schema, mode: 'comparison', outcome: 'unresolved' }
      const logs = [
        '[qa] checked answer: ' + JSON.stringify({ ...call, privateBody: 'PRIVATE' }),
        '[qa] checked result: ' + JSON.stringify({ ...result, privateBody: 'PRIVATE' }),
      ]
      const original = [...logs]
      const observed = describeCheckedAnswer(logs, [])
      expect(observed.calls).toEqual([call])
      expect(observed.results).toEqual([result])
      expect(observed.malformedLogs).toBe(0)
      expect(observed.malformedResults).toBe(0)
      expect(observed.stageCompleted).toBe(false)
      expect(JSON.stringify(observed)).not.toContain('PRIVATE')
      expect(logs).toEqual(original)
      for (const invalid of [
        { ...call, schema: 'typed-comparison-v33' },
        { ...call, comparisonMode: 'excerpts' },
        { ...call, conciseUnitCount: 1 },
        { ...call, conciseFallbackReason: 'segmentation' },
        { ...call, jsonStringPolicy: 'source-excerpts' },
      ]) {
        expect(
          describeCheckedAnswer(['[qa] checked answer: ' + JSON.stringify(invalid)], [])
            .malformedLogs,
        ).toBe(1)
      }
    },
  )

  it('records the explicit excerpts string policy as request metadata while preserving absent historical v24 calls', () => {
    const call = {
      schema: 'typed-comparison-v24',
      contextTokens: 8192,
      maxTokens: 2176,
      temperature: 0,
      repeatPenalty: false,
      comparisonMode: 'excerpts',
      conciseUnitCount: 0,
      conciseFallbackReason: null,
    }
    const current = { ...call, jsonStringPolicy: 'source-excerpts' }
    const observed = describeCheckedAnswer(
      [call, current].map(
        (value) =>
          '01:15:20.466 > [qa] checked answer: ' +
          JSON.stringify({ ...value, sourceText: 'PRIVATE' }),
      ),
      [],
    )
    expect(observed.calls).toEqual([call, current])
    expect(observed.malformedLogs).toBe(0)
    expect(JSON.stringify(observed)).not.toContain('PRIVATE')
  })

  it('rejects unknown, default or mode/version-mismatched explicit string policies without retaining them', () => {
    const valid = {
      schema: 'typed-comparison-v24',
      contextTokens: 8192,
      maxTokens: 2176,
      temperature: 0,
      repeatPenalty: false,
      comparisonMode: 'excerpts',
      conciseUnitCount: 0,
      conciseFallbackReason: null,
      jsonStringPolicy: 'source-excerpts',
    }
    const invalid = [
      ...['PRIVATE', 'default', '', null, 0, { text: 'PRIVATE' }].map((jsonStringPolicy) => ({
        ...valid,
        jsonStringPolicy,
      })),
      { ...valid, comparisonMode: 'full' },
      { ...valid, schema: 'typed-comparison-v25' },
      { ...valid, schema: 'typed-comparison-v26' },
      { ...valid, schema: 'typed-comparison-v27' },
      { ...valid, schema: 'typed-comparison-v28' },
      { ...valid, schema: 'typed-comparison-v29' },
      { ...valid, schema: 'typed-comparison-v30' },
      ...['typed-comparison-v22', 'typed-comparison-v23'].map((schema) => ({
        ...valid,
        schema,
        comparisonMode: 'summary',
      })),
      { ...valid, schema: 'typed-comparison-v21', comparisonMode: 'concise', conciseUnitCount: 1 },
    ]
    const observed = describeCheckedAnswer(
      invalid.map((value) => '[qa] checked answer: ' + JSON.stringify(value)),
      [],
    )
    expect(observed.calls).toEqual([])
    expect(observed.malformedLogs).toBe(invalid.length)
    expect(JSON.stringify(observed)).not.toContain('PRIVATE')
  })

  it('records exact logged schema/capacity/sampler and completed stage without text', () => {
    const logs = [
      '[qa] checked answer: {"schema":"checked-answer-v1","contextTokens":4096,"maxTokens":384,"temperature":0,"repeatPenalty":false}',
      '[modelsWorker] llm.generateRaw start: task=utility maxTokens=384 noThink=true',
    ]
    const before = [...logs]
    expect(
      describeCheckedAnswer(logs, [
        { type: 'stage', stage: 'evidence', status: 'start' },
        { type: 'stage', stage: 'evidence', status: 'done', durationMs: 123 },
      ]),
    ).toEqual({
      checkedCallLogged: true,
      calls: [
        {
          schema: 'checked-answer-v1',
          contextTokens: 4096,
          maxTokens: 384,
          temperature: 0,
          repeatPenalty: false,
        },
      ],
      malformedLogs: 0,
      results: [],
      malformedResults: 0,
      rawGenerationStarts: 1,
      grammarFallbackLogged: false,
      stageStarted: true,
      stageCompleted: true,
      durationMs: 123,
    })
    expect(logs).toEqual(before)
  })
  it('records the explicit v2 schema and only content-free validated branch metadata', () => {
    const results = [
      { schema: 'typed-comparison-v2', mode: 'answered', outcome: null },
      ...['compatible', 'established', 'unresolved', 'insufficient'].map((outcome) => ({
        schema: 'typed-comparison-v2',
        mode: 'comparison',
        outcome,
      })),
    ]
    const observed = describeCheckedAnswer(
      [
        '[qa] checked answer: {"schema":"typed-comparison-v2","contextTokens":8192,"maxTokens":2176,"temperature":0,"repeatPenalty":false}',
        ...results.map(
          (result) => '[qa] checked result: ' + JSON.stringify({ ...result, answer: 'PRIVATE' }),
        ),
      ],
      [],
    )
    expect(observed).toMatchObject({
      checkedCallLogged: true,
      calls: [
        {
          schema: 'typed-comparison-v2',
          contextTokens: 8192,
          maxTokens: 2176,
          temperature: 0,
          repeatPenalty: false,
        },
      ],
      results,
      malformedLogs: 0,
      malformedResults: 0,
    })
    expect(JSON.stringify(observed)).not.toContain('PRIVATE')
  })

  it.each([
    'typed-comparison-v3',
    'typed-comparison-v4',
    'typed-comparison-v5',
    'typed-comparison-v6',
    'typed-comparison-v7',
    'typed-comparison-v8',
    'typed-comparison-v9',
    'typed-comparison-v10',
    'typed-comparison-v11',
    'typed-comparison-v12',
    'typed-comparison-v13',
    'typed-comparison-v14',
    'typed-comparison-v15',
    'typed-comparison-v16',
    'typed-comparison-v17',
    'typed-comparison-v18',
    'typed-comparison-v19',
    'typed-comparison-v20',
    'typed-comparison-v21',
    'typed-comparison-v22',
    'typed-comparison-v23',
    'typed-comparison-v24',
    'typed-comparison-v25',
    'typed-comparison-v26',
    'typed-comparison-v27',
    'typed-comparison-v28',
    'typed-comparison-v29',
    'typed-comparison-v30',
  ])(
    'admits %s answered/comparison outcomes while rejecting retired established behavior',
    (schema) => {
      const results = [
        { schema, mode: 'answered', outcome: null },
        ...['compatible', 'unresolved', 'insufficient'].map((outcome) => ({
          schema,
          mode: 'comparison',
          outcome,
        })),
      ]
      const observed = describeCheckedAnswer(
        [
          '[qa] checked answer: ' +
            JSON.stringify({
              schema,
              contextTokens: 8192,
              maxTokens: 2176,
              temperature: 0,
              repeatPenalty: false,
              ...([
                'typed-comparison-v11',
                'typed-comparison-v12',
                'typed-comparison-v13',
                'typed-comparison-v14',
                'typed-comparison-v15',
                'typed-comparison-v16',
                'typed-comparison-v17',
                'typed-comparison-v18',
                'typed-comparison-v19',
                'typed-comparison-v20',
                'typed-comparison-v21',
                'typed-comparison-v22',
                'typed-comparison-v23',
                'typed-comparison-v24',
                'typed-comparison-v25',
                'typed-comparison-v26',
                'typed-comparison-v27',
                'typed-comparison-v28',
                'typed-comparison-v29',
                'typed-comparison-v30',
              ].includes(schema)
                ? { comparisonMode: 'full', conciseUnitCount: 0, conciseFallbackReason: null }
                : {}),
            }),
          ...results.map(
            (result) =>
              '[qa] checked result: ' +
              JSON.stringify({ ...result, check: 'PRIVATE CHECK', evidence: ['PRIVATE QUOTE'] }),
          ),
          `[qa] checked result: {"schema":"${schema}","mode":"comparison","outcome":"established"}`,
        ],
        [],
      )
      expect(observed).toMatchObject({
        checkedCallLogged: true,
        calls: [{ schema }],
        results,
        malformedLogs: 0,
        malformedResults: 1,
      })
      expect(JSON.stringify(observed)).not.toContain('PRIVATE')
    },
  )

  it.each([
    { comparisonMode: 'full', conciseUnitCount: 0, conciseFallbackReason: null },
    { comparisonMode: 'concise', conciseUnitCount: 256, conciseFallbackReason: null },
    ...['source_bounds', 'unit_bounds', 'segmentation'].map((conciseFallbackReason) => ({
      comparisonMode: 'full',
      conciseUnitCount: 0,
      conciseFallbackReason,
    })),
  ])('records only validated catalog admission metadata: %j', (metadata) => {
    const call = {
      schema: 'typed-comparison-v11',
      contextTokens: 8192,
      maxTokens: 2176,
      temperature: 0,
      repeatPenalty: false,
      ...metadata,
    }
    const observed = describeCheckedAnswer(
      [
        '[qa] checked answer: ' +
          JSON.stringify({ ...call, sourceText: 'PRIVATE', units: ['PRIVATE'], check: 'PRIVATE' }),
      ],
      [],
    )
    expect(observed.calls).toEqual([call])
    expect(observed.malformedLogs).toBe(0)
    expect(JSON.stringify(observed)).not.toContain('PRIVATE')
  })

  it.each(['typed-comparison-v11', 'typed-comparison-v20', 'typed-comparison-v21'])(
    'rejects missing, invalid, inconsistent or unbounded %s catalog metadata without retaining arbitrary reason text',
    (schema) => {
      const valid = { comparisonMode: 'full', conciseUnitCount: 0, conciseFallbackReason: null }
      const invalid = [
        {},
        { ...valid, comparisonMode: 'PRIVATE' },
        { ...valid, conciseUnitCount: 1 },
        { ...valid, comparisonMode: 'concise' },
        { ...valid, comparisonMode: 'concise', conciseUnitCount: 257 },
        {
          ...valid,
          comparisonMode: 'concise',
          conciseUnitCount: 2,
          conciseFallbackReason: 'unit_bounds',
        },
        { ...valid, conciseUnitCount: 0.5 },
        { ...valid, conciseFallbackReason: 'PRIVATE' },
      ]
      const observed = describeCheckedAnswer(
        invalid.map(
          (metadata) =>
            '[qa] checked answer: ' +
            JSON.stringify({
              schema,
              contextTokens: 8192,
              maxTokens: 2176,
              temperature: 0,
              repeatPenalty: false,
              ...metadata,
            }),
        ),
        [],
      )
      expect(observed.calls).toEqual([])
      expect(observed.malformedLogs).toBe(invalid.length)
      expect(JSON.stringify(observed)).not.toContain('PRIVATE')
    },
  )

  it.each(
    [
      'typed-comparison-v22',
      'typed-comparison-v23',
      'typed-comparison-v24',
      'typed-comparison-v25',
      'typed-comparison-v26',
      'typed-comparison-v27',
      'typed-comparison-v28',
      'typed-comparison-v29',
      'typed-comparison-v30',
    ].flatMap((schema) =>
      [
        'full',
        [
          'typed-comparison-v24',
          'typed-comparison-v25',
          'typed-comparison-v26',
          'typed-comparison-v27',
          'typed-comparison-v28',
        ].includes(schema)
          ? 'excerpts'
          : 'summary',
      ].map((mode) => [schema, mode]),
    ),
  )('records %s %s mode only with zero catalog units and no fallback', (schema, comparisonMode) => {
    const call = {
      schema,
      contextTokens: 8192,
      maxTokens: 2176,
      temperature: 0,
      repeatPenalty: false,
      comparisonMode,
      conciseUnitCount: 0,
      conciseFallbackReason: null,
    }
    const observed = describeCheckedAnswer(
      [
        '01:15:20.466 > [qa] checked answer: ' +
          JSON.stringify({
            ...call,
            summary: 'PRIVATE',
            sourceText: 'PRIVATE',
            check: 'PRIVATE',
          }),
      ],
      [],
    )
    expect(observed.calls).toEqual([call])
    expect(observed.malformedLogs).toBe(0)
    expect(JSON.stringify(observed)).not.toContain('PRIVATE')
  })

  it.each([
    'typed-comparison-v22',
    'typed-comparison-v23',
    'typed-comparison-v24',
    'typed-comparison-v25',
    'typed-comparison-v26',
    'typed-comparison-v27',
    'typed-comparison-v28',
    'typed-comparison-v29',
    'typed-comparison-v30',
  ])('rejects missing or mixed %s unit-catalog metadata without retaining content', (schema) => {
    const shortMode = [
      'typed-comparison-v24',
      'typed-comparison-v25',
      'typed-comparison-v26',
      'typed-comparison-v27',
      'typed-comparison-v28',
    ].includes(schema)
      ? 'excerpts'
      : 'summary'
    const valid = { comparisonMode: shortMode, conciseUnitCount: 0, conciseFallbackReason: null }
    const invalid = [
      {},
      { comparisonMode: 'summary' },
      { ...valid, comparisonMode: 'PRIVATE' },
      { ...valid, comparisonMode: shortMode === 'excerpts' ? 'summary' : 'excerpts' },
      { ...valid, comparisonMode: 'concise' },
      { ...valid, comparisonMode: 'concise', conciseUnitCount: 1 },
      { ...valid, conciseUnitCount: 1 },
      { ...valid, conciseUnitCount: -1 },
      { ...valid, conciseUnitCount: 0.5 },
      { ...valid, conciseUnitCount: '0' },
      { ...valid, comparisonMode: 'full', conciseUnitCount: 1 },
      ...['source_bounds', 'unit_bounds', 'segmentation', 'PRIVATE'].flatMap(
        (conciseFallbackReason) =>
          ['full', shortMode].map((comparisonMode) => ({
            ...valid,
            comparisonMode,
            conciseFallbackReason,
          })),
      ),
    ]
    const observed = describeCheckedAnswer(
      invalid.map(
        (metadata) =>
          '[qa] checked answer: ' +
          JSON.stringify({
            schema,
            contextTokens: 8192,
            maxTokens: 2176,
            temperature: 0,
            repeatPenalty: false,
            ...metadata,
          }),
      ),
      [],
    )
    expect(observed.calls).toEqual([])
    expect(observed.malformedLogs).toBe(invalid.length)
    expect(JSON.stringify(observed)).not.toContain('PRIVATE')
  })

  it.each(Array.from({ length: 11 }, (_, index) => `typed-comparison-v${index + 11}`))(
    'preserves %s catalog admission while rejecting the new summary state',
    (schema) => {
      const treatment = {
        schema,
        contextTokens: 8192,
        maxTokens: 2176,
        temperature: 0,
        repeatPenalty: false,
      }
      const legacyMetadata = [
        { comparisonMode: 'concise', conciseUnitCount: 1, conciseFallbackReason: null },
        { comparisonMode: 'concise', conciseUnitCount: 256, conciseFallbackReason: null },
        ...['source_bounds', 'unit_bounds', 'segmentation'].map((conciseFallbackReason) => ({
          comparisonMode: 'full',
          conciseUnitCount: 0,
          conciseFallbackReason,
        })),
      ]
      const calls = legacyMetadata.map((metadata) => ({ ...treatment, ...metadata }))
      const observed = describeCheckedAnswer(
        [
          ...calls,
          {
            ...treatment,
            comparisonMode: 'summary',
            conciseUnitCount: 0,
            conciseFallbackReason: null,
          },
        ].map((call) => '[qa] checked answer: ' + JSON.stringify(call)),
        [],
      )
      expect(observed.calls).toEqual(calls)
      expect(observed.malformedLogs).toBe(1)
    },
  )

  it('rejects unknown versions and inconsistent completion branches', () => {
    const observed = describeCheckedAnswer(
      [
        '[qa] checked answer: {"schema":"future-unapproved-schema","contextTokens":8192,"maxTokens":2176,"temperature":0,"repeatPenalty":false}',
        ...[
          { schema: 'checked-answer-v1', mode: 'comparison', outcome: 'compatible' },
          { schema: 'typed-comparison-v2', mode: 'answered', outcome: 'unresolved' },
          { schema: 'typed-comparison-v2', mode: 'comparison', outcome: null },
          { schema: 'typed-comparison-v2', mode: 'comparison', outcome: 'certain' },
        ].map((result) => '[qa] checked result: ' + JSON.stringify(result)),
        '[qa] checked result: {broken}',
      ],
      [],
    )
    expect(observed).toMatchObject({
      checkedCallLogged: false,
      calls: [],
      results: [],
      malformedLogs: 1,
      malformedResults: 5,
    })
  })
  it('does not infer checked execution from a shared evidence stage or a utility call', () => {
    expect(
      describeCheckedAnswer(
        ['llm.generateRaw start:', 'grammar build failed, generating without it'],
        [{ type: 'stage', stage: 'evidence', status: 'done' }],
      ),
    ).toMatchObject({
      checkedCallLogged: false,
      calls: [],
      rawGenerationStarts: 1,
      grammarFallbackLogged: true,
    })
  })
  it('rejects malformed or unexpected treatment metadata', () => {
    expect(
      describeCheckedAnswer(
        [
          '[qa] checked answer: {"schema":"checked-answer-v1","contextTokens":8192,"maxTokens":512,"temperature":0,"repeatPenalty":true}',
          '[qa] checked answer: {broken}',
        ],
        [],
      ),
    ).toMatchObject({ checkedCallLogged: false, malformedLogs: 2 })
  })
})

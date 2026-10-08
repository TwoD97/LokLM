import { describe, expect, it } from 'vitest'
import {
  describeBoundedThoughts,
  type BoundedThoughtMetrics,
} from '../evals/native-calibration/boundedThoughts'

function metric(): BoundedThoughtMetrics {
  return {
    task: 'utility',
    route: 'main',
    elapsedMs: 1020,
    grammarMs: 2,
    promptFitMs: 3,
    nativeMs: 1015,
    firstTextMs: 500,
    lastTextMs: 1000,
    firstNonWhitespaceTextMs: null,
    lastNonWhitespaceTextMs: null,
    responseChars: 100,
    responseChunks: 0,
    completionReason: 'stopGenerationTrigger',
    cancelled: false,
    usedInputTokens: 1024,
    usedOutputTokens: 80,
    boundedThoughts: {
      promptTokens: 1024,
      prefillBatches: 5,
      prefillTokens: 1023,
      thoughtTokens: 64,
      thoughtClosingTokens: 0,
      forcedClosingTokens: 2,
      visibleTokens: 16,
      combinedTokens: 82,
      firstVisibleMs: 500,
      lastVisibleMs: 1000,
      thoughtTermination: 'budget',
    },
  }
}
const metricLog = (value: unknown) =>
  '[modelsWorker] llm.generateRaw metrics: ' + JSON.stringify(value)
const statusLog = (value: unknown) => '[modelsWorker] llm.boundedThoughts: ' + JSON.stringify(value)

describe('bounded thought native diagnostic privacy and validity', () => {
  it.each([64, 128] as const)('retains explicit cap%s and bounded completion counters', (cap) => {
    const value = metric()
    value.boundedThoughts.thoughtTokens = cap
    value.boundedThoughts.combinedTokens = cap + 18
    value.usedOutputTokens = cap + 16
    const observed = describeBoundedThoughts([
      statusLog({ status: 'active', maxThoughtTokens: cap }),
      metricLog(value),
    ])
    expect(observed.statuses).toEqual([{ status: 'active', maxThoughtTokens: cap }])
    expect(observed.metrics).toEqual([value])
    expect(observed.malformedStatusLogs).toBe(0)
    expect(observed.malformedMetricsLogs).toBe(0)
  })

  it('allows an intermediate natural stop under128 without inferring a configured cap', () => {
    const value = metric()
    Object.assign(value.boundedThoughts, {
      thoughtTokens: 100,
      thoughtClosingTokens: 1,
      forcedClosingTokens: 0,
      combinedTokens: 118,
      thoughtTermination: 'natural',
    })
    const observed = describeBoundedThoughts([metricLog(value)])
    expect(observed.metrics).toEqual([value])
    expect(observed.statuses).toEqual([])
    expect(observed.activeLogged).toBe(false)
  })

  it('preserves actual active status and complete counters without mutating input', () => {
    const value = metric()
    const logs = Object.freeze([
      statusLog({ status: 'active', maxThoughtTokens: 64 }),
      metricLog(value),
    ])
    expect(describeBoundedThoughts(logs)).toEqual({
      activeLogged: true,
      unsupportedWrapperLogged: false,
      setupFailedLogged: false,
      statuses: [{ status: 'active', maxThoughtTokens: 64 }],
      metrics: [value],
      malformedStatusLogs: 0,
      malformedMetricsLogs: 0,
    })
  })

  it('distinguishes unsupported/setup failure and never infers execution from a request', () => {
    const ordinary = { ...metric(), boundedThoughts: undefined }
    const observed = describeBoundedThoughts([
      '[qa] checked answer: {"maxBoundedThoughtTokens":64}',
      'llm.generateRaw start: noThink=false boundedReasoning=active',
      metricLog(ordinary),
      statusLog({ status: 'unsupported_wrapper', maxThoughtTokens: 0 }),
      statusLog({ status: 'setup_failed', maxThoughtTokens: 0 }),
    ])
    expect(observed).toEqual({
      activeLogged: false,
      unsupportedWrapperLogged: true,
      setupFailedLogged: true,
      statuses: [
        { status: 'unsupported_wrapper', maxThoughtTokens: 0 },
        { status: 'setup_failed', maxThoughtTokens: 0 },
      ],
      metrics: [],
      malformedStatusLogs: 0,
      malformedMetricsLogs: 0,
    })
  })

  it('retains ordered cancelled partial-prefill evidence without claiming thought generation', () => {
    const completed = metric()
    const cancelled = metric()
    Object.assign(cancelled, {
      cancelled: true,
      completionReason: null,
      responseChars: 0,
      firstTextMs: null,
      lastTextMs: null,
    })
    Object.assign(cancelled.boundedThoughts, {
      prefillTokens: 254,
      prefillBatches: 1,
      thoughtTokens: 0,
      forcedClosingTokens: 0,
      visibleTokens: 0,
      combinedTokens: 0,
      firstVisibleMs: null,
      lastVisibleMs: null,
      thoughtTermination: null,
    })
    const observed = describeBoundedThoughts([
      metricLog(completed),
      statusLog({ status: 'active', maxThoughtTokens: 64 }),
      metricLog(cancelled),
    ])
    expect(observed.metrics).toEqual([completed, cancelled])
    const last = observed.metrics.at(-1)!
    expect(last.cancelled).toBe(true)
    expect(last.boundedThoughts.thoughtTokens).toBe(0)
    expect(last.boundedThoughts.prefillTokens).toBeGreaterThan(0)
    expect(last.boundedThoughts.prefillTokens).toBeLessThan(last.boundedThoughts.promptTokens - 1)
  })

  it('retains natural closing tokens and nullable timing without synthesizing missing meters', () => {
    const value = metric()
    delete value.usedInputTokens
    delete value.usedOutputTokens
    Object.assign(value.boundedThoughts, {
      thoughtTokens: 10,
      thoughtClosingTokens: 1,
      forcedClosingTokens: 0,
      combinedTokens: 28, // Includes a native EOG that is not visible prose.
      thoughtTermination: 'natural',
    })
    expect(describeBoundedThoughts([metricLog(value)]).metrics).toEqual([value])
  })

  it.each([
    { status: 'active', maxThoughtTokens: 0 },
    { status: 'active', maxThoughtTokens: 65 },
    { status: 'active', maxThoughtTokens: 129 },
    { status: 'active', maxThoughtTokens: '128' },
    { status: 'unsupported_wrapper', maxThoughtTokens: 64 },
    { status: 'setup_failed', maxThoughtTokens: 64 },
    { status: 'unsupported_wrapper', maxThoughtTokens: 128 },
    { status: 'setup_failed', maxThoughtTokens: 128 },
    { status: 'PRIVATE', maxThoughtTokens: 64 },
    { status: 'active', maxThoughtTokens: '64' },
    { status: 'active', maxThoughtTokens: 64, error: 'PRIVATE' },
    {},
    null,
    [],
  ])('rejects invalid/unknown status metadata: %j', (value) => {
    const result = describeBoundedThoughts([statusLog(value)])
    expect(result.statuses).toEqual([])
    expect(result.activeLogged).toBe(false)
    expect(result.malformedStatusLogs).toBe(1)
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })

  it.each(['check', 'error', 'raw', 'body', 'sourceText', 'tokenIds', 'unknownField'])(
    'rejects private/unknown %s at either metrics level',
    (key) => {
      const top = { ...metric(), [key]: 'PRIVATE' }
      const nested = metric()
      Object.assign(nested.boundedThoughts, { [key]: ['PRIVATE'] })
      const observed = describeBoundedThoughts([metricLog(top), metricLog(nested)])
      expect(observed.metrics).toEqual([])
      expect(observed.malformedMetricsLogs).toBe(2)
      expect(JSON.stringify(observed)).not.toContain('PRIVATE')
      expect(JSON.stringify(observed)).not.toContain(key === 'error' ? '"error"' : `"${key}"`)
    },
  )

  it.each([
    ['thoughtTokens', 129],
    ['promptTokens', -1],
    ['prefillTokens', 2.5],
    ['prefillBatches', '1'],
    ['thoughtClosingTokens', null],
    ['forcedClosingTokens', Number.MAX_SAFE_INTEGER + 1],
    ['combinedTokens', Number.POSITIVE_INFINITY],
    ['visibleTokens', {}],
    ['firstVisibleMs', -1],
    ['lastVisibleMs', 'PRIVATE'],
    ['thoughtTermination', 'PRIVATE'],
    ['promptTokens', undefined],
  ])('rejects invalid bounded counter %s=%j', (key, value) => {
    const candidate = metric()
    Object.assign(candidate.boundedThoughts, { [key as string]: value })
    const observed = describeBoundedThoughts([metricLog(candidate)])
    expect(observed.metrics).toEqual([])
    expect(observed.malformedMetricsLogs).toBe(1)
    expect(JSON.stringify(observed)).not.toContain('PRIVATE')
  })

  it.each([
    ['task', 'PRIVATE'],
    ['route', 'PRIVATE'],
    ['completionReason', 'PRIVATE'],
    ['elapsedMs', -1],
    ['grammarMs', '2'],
    ['nativeMs', 'PRIVATE'],
    ['responseChars', 0.5],
    ['cancelled', 'false'],
    ['usedInputTokens', -1],
    ['boundedThoughts', null],
  ])('rejects invalid enclosing metadata %s=%j', (key, value) => {
    const candidate = { ...metric(), [key as string]: value }
    const observed = describeBoundedThoughts([metricLog(candidate)])
    expect(observed.metrics).toEqual([])
    expect(observed.malformedMetricsLogs).toBe(1)
    expect(JSON.stringify(observed)).not.toContain('PRIVATE')
  })

  it('handles ANSI/multiline worker logs but ignores other log messages and source-like prose', () => {
    const value = metric()
    const logs = [
      '\u001b[32m' +
        statusLog({ status: 'active', maxThoughtTokens: 64 }) +
        '\u001b[0m\r\n' +
        metricLog(value),
      '[qa] source text: ' + statusLog({ status: 'setup_failed', maxThoughtTokens: 0 }),
      'some prose llm.boundedThoughts: {"status":"setup_failed","maxThoughtTokens":0}',
    ]
    const observed = describeBoundedThoughts(logs)
    expect(observed.statuses).toEqual([{ status: 'active', maxThoughtTokens: 64 }])
    expect(observed.metrics).toEqual([value])
  })

  it('reads the real electron-log timestamp prefix without admitting source/debug prefixes', () => {
    const value = metric()
    const observed = describeBoundedThoughts([
      '\u001b[32m01:15:20.465 > ' +
        statusLog({ status: 'active', maxThoughtTokens: 64 }) +
        '\u001b[0m',
      '01:15:20.466 > ' + metricLog(value),
      '01:15:20.467 > [qa] source text: ' +
        statusLog({ status: 'setup_failed', maxThoughtTokens: 0 }),
      '01:15:20.468 > DEBUG ' + metricLog(value),
      'PRIVATE ' + metricLog(value),
      '25:15:20.466 > ' + metricLog(value),
    ])
    expect(observed.statuses).toEqual([{ status: 'active', maxThoughtTokens: 64 }])
    expect(observed.metrics).toEqual([value])
    expect(observed.activeLogged).toBe(true)
    expect(observed.setupFailedLogged).toBe(false)
    expect(observed.malformedMetricsLogs).toBe(0)
    expect(JSON.stringify(observed)).not.toContain('PRIVATE')
  })

  it('counts malformed/oversized records without retaining arbitrary payloads or exceptions', () => {
    const observed = describeBoundedThoughts([
      'llm.boundedThoughts: {PRIVATE',
      'llm.generateRaw metrics: {PRIVATE',
      statusLog({ status: 'PRIVATE'.repeat(2000) }),
      metricLog({ boundedThoughts: 'PRIVATE'.repeat(2000) }),
    ])
    expect(observed).toMatchObject({
      statuses: [],
      metrics: [],
      malformedStatusLogs: 2,
      malformedMetricsLogs: 2,
    })
    expect(JSON.stringify(observed)).not.toContain('PRIVATE')
  })

  it('represents old logs as absent evidence rather than a failure or inferred execution', () => {
    expect(
      describeBoundedThoughts([
        'llm.generateRaw finished: task=utility',
        metricLog({ task: 'utility' }),
      ]),
    ).toEqual({
      activeLogged: false,
      unsupportedWrapperLogged: false,
      setupFailedLogged: false,
      statuses: [],
      metrics: [],
      malformedStatusLogs: 0,
      malformedMetricsLogs: 0,
    })
  })
})

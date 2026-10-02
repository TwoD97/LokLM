import { describe, expect, it } from 'vitest'
import {
  describeTimings,
  describeEvidenceAssessment,
  gradeNativeRun,
  type NativeCalibrationRun,
  type NativeQueryObservation,
} from '../evals/native-calibration/report'
import type { CalibrationManifest } from '../evals/native-calibration/schema'

describe('native assessment log coverage', () => {
  it('recovers colored multiline console fields without mutating original logs', () => {
    const logs = [
      '[qa] evidence coverage: {',
      '  planned: \u001b[33mtrue\u001b[39m,',
      '  passages: \u001b[33m10\u001b[39m, documents: \u001b[33m9\u001b[39m',
      '}',
      "[qa] evidence assessment: { relation: \u001b[32m'unresolved'\u001b[39m }",
    ]
    const original = [...logs]
    expect(describeEvidenceAssessment(logs, [])).toMatchObject({
      coverageLogged: true,
      planned: true,
      passages: 10,
      documents: 9,
      relation: 'unresolved',
      stageStarted: false,
      stageCompleted: false,
      durationMs: null,
    })
    expect(logs).toEqual(original)
    expect(
      describeEvidenceAssessment(
        [
          '[qa] evidence coverage: { planned: \u001b[33mfalse\u001b[39m, passages: 1, documents: 1 }',
        ],
        [],
      ),
    ).toMatchObject({ planned: false, relation: null })
    expect(describeEvidenceAssessment([], []).planned).toBeNull()
  })
})

const manifest: CalibrationManifest = {
  schemaVersion: 1,
  split: 'dev',
  sources: [{ key: 'fees', title: 'Fees', file: 'fees.md', format: 'markdown' }],
  cases: [
    {
      id: 'fee',
      question: 'What is the fee?',
      language: 'en',
      kind: 'exact-amount',
      requiredSourceKeys: ['fees'],
      expectedAbstention: false,
      referenceAnswer: 'The fee is 72 euros.',
      answerChecks: [{ label: '72 euros', pattern: '\\b72\\s+euros\\b' }],
      allowPartial: false,
    },
  ],
}

function observe(patch: Partial<NativeQueryObservation> = {}): NativeCalibrationRun {
  return {
    kind: 'native-rag-calibration',
    runId: 'test',
    split: 'dev',
    requestedContext: 4096,
    documents: [{ sourceKey: 'fees', id: 72, chunks: [{ id: 3, text: 'The fee is 72 euros.' }] }],
    queries: [
      {
        caseId: 'fee',
        question: 'What is the fee?',
        language: 'en',
        repetition: 1,
        answer: 'The fee is 72 euros [doc:72, chunk:3].',
        citations: [{ doc_id: 72, chunk_id: 3 }],
        events: [{ type: 'citation', doc_id: 72, chunk_id: 3 }, { type: 'done' }],
        beforeInfo: { llm: { modelCapacity: { contextSize: 4096, gpuLayers: 14 } } },
        afterInfo: { llm: { modelCapacity: { contextSize: 4096, gpuLayers: 14 } } },
        ttftMs: 1200,
        totalMs: 3200,
        timedOut: false,
        ...patch,
      },
    ],
  }
}

describe('native calibration grading safeguards', () => {
  it('keeps semantically unreviewed output pending even when every pattern and citation matches', () => {
    const result = gradeNativeRun(observe(), manifest)
    expect(result.summary.mechanicalPasses).toBe(1)
    expect(result.summary.manuallyReviewed).toBe(0)
    expect(result.queries[0]?.manualReviewRequired).toBe(true)
  })

  it('does not mistake citation identifiers for numerical answer facts', () => {
    const numericManifest = structuredClone(manifest)
    numericManifest.cases[0]!.answerChecks = [{ label: '72', pattern: '\\b72\\b' }]
    const result = gradeNativeRun(
      observe({ answer: 'It is specified here [doc:72, chunk:3].' }),
      numericManifest,
    )
    expect(result.queries[0]?.factChecks[0]?.matched).toBe(false)
  })

  it('rejects a real corpus citation that was not supplied to this answer', () => {
    const raw = observe({ answer: 'The fee is 72 euros [doc:72, chunk:4].' })
    raw.documents[0]!.chunks.push({ id: 4, text: 'A different passage.' })
    const result = gradeNativeRun(raw, manifest)
    expect(result.queries[0]?.invalidInlineCitations).toEqual([{ doc_id: 72, chunk_id: 4 }])
    expect(result.queries[0]?.reviewFlags).toContain('citation-outside-supplied-evidence')
  })

  it('keeps unsupported extra claims separate from mechanical matches', () => {
    const raw = observe({
      answer: 'The fee is 72 euros [doc:72, chunk:3]. It is always refundable.',
    })
    const report = gradeNativeRun(raw, manifest, [
      {
        caseId: 'fee',
        repetition: 1,
        verdict: 'unsupported',
        citationSupport: 'missing',
        unsupportedExtraClaims: ['It is always refundable.'],
        notes: 'The source gives a fee but no refund policy.',
      },
    ])
    expect(report.queries[0]?.mechanicalChecksPassed).toBe(true)
    expect(report.queries[0]?.manualReview?.verdict).toBe('unsupported')
    expect(report.summary.manualVerdicts).toEqual({ unsupported: 1 })
  })

  it('does not count citation-shaped code literals as claim citations', () => {
    const report = gradeNativeRun(
      observe({ answer: 'The fee is 72 euros. Example: `[doc:72, chunk:3]`.' }),
      manifest,
    )
    expect(report.queries[0]?.inlineCitations).toEqual([])
    expect(report.queries[0]?.reviewFlags).toContain('required-source-not-cited-inline')
  })

  it('requires both conflict sources to be cited even for a safe abstention', () => {
    const conflict = structuredClone(manifest)
    conflict.cases[0]!.expectedAbstention = true
    conflict.cases[0]!.kind = 'conflicting-sources'
    const report = gradeNativeRun(
      observe({ answer: 'The conflicting fee records include 72 euros.' }),
      conflict,
    )
    expect(report.queries[0]?.reviewFlags).toContain('required-source-not-cited-inline')
    expect(report.queries[0]?.suppliedPassages).toEqual([
      { sourceKey: 'fees', documentId: 72, chunkId: 3, text: 'The fee is 72 euros.' },
    ])
    expect(report.queries[0]?.manualReviewRequired).toBe(true)
  })

  it('cannot mechanically pass a cancelled answer or conflicting terminal channels', () => {
    const report = gradeNativeRun(
      observe({ terminalOutcome: 'cancelled', terminalMismatch: true }),
      manifest,
    )
    expect(report.queries[0]?.reviewFlags).toEqual(
      expect.arrayContaining(['cancelled-answer', 'terminal-channel-mismatch']),
    )
    expect(report.summary.mechanicalPasses).toBe(0)
  })

  it('keeps invocation rejection distinct from a pushed successful terminal', () => {
    const report = gradeNativeRun(
      observe({ invokeSettled: true, invokeError: 'Invocation failed' }),
      manifest,
    )
    expect(report.queries[0]?.terminalOutcome).toBe('completed')
    expect(report.queries[0]?.reviewFlags).toContain('invoke-error')
    expect(report.summary.mechanicalPasses).toBe(0)
  })

  it('does not certify abstention just because the model uses a refusal cue', () => {
    const missing = structuredClone(manifest)
    missing.cases[0]!.expectedAbstention = true
    missing.cases[0]!.kind = 'missing-fact'
    missing.cases[0]!.answerChecks = []
    const report = gradeNativeRun(
      observe({ answer: 'Not specified, but probably 72 euros.' }),
      missing,
    )
    expect(report.queries[0]?.abstentionCue).toBe(true)
    expect(report.queries[0]?.manualReviewRequired).toBe(true)
    expect(report.summary.manualVerdicts).toEqual({})
  })

  it('reports actual context mismatch and timed-out empty output without inventing latency', () => {
    const report = gradeNativeRun(
      observe({
        answer: '',
        timedOut: true,
        ttftMs: null,
        afterInfo: { llm: { modelCapacity: { contextSize: 2048, gpuLayers: 20 } } },
      }),
      manifest,
    )
    expect(report.queries[0]?.reviewFlags).toEqual(
      expect.arrayContaining(['timed-out', 'empty-answer', 'actual-context-mismatch']),
    )
    expect(report.summary.ttft.n).toBe(0)
    expect(report.summary.ttft.p50Ms).toBeNull()
  })

  it('keeps recorded profile and KV allocation differences visible without inferring answer depth', () => {
    const report = gradeNativeRun(
      observe({
        beforeInfo: { llm: { profile: 'lite', lastLlmPlan: { kvCacheType: 'f16' } } },
        afterInfo: {
          llm: {
            profile: 'full',
            modelCapacity: { contextSize: 8192, gpuLayers: 14 },
            lastLlmPlan: { kvCacheType: 'q8_0' },
          },
        },
      }),
      manifest,
    )
    expect(report.queries[0]?.allocationBefore).toMatchObject({
      profile: 'lite',
      kvCacheType: 'f16',
    })
    expect(report.queries[0]?.allocationAfter).toMatchObject({
      profile: 'full',
      kvCacheType: 'q8_0',
      contextTokens: 8192,
    })
    expect(report.queries[0]?.allocationAfter).not.toHaveProperty('answerDepth')
  })

  it('does not mix development and held-out manifests', () => {
    expect(() => gradeNativeRun({ ...observe(), split: 'heldout' }, manifest)).toThrow(
      'do not match',
    )
  })

  it('reports missing cases and descriptive percentile sample counts', () => {
    const report = gradeNativeRun({ ...observe(), queries: [] }, manifest)
    expect(report.summary.unobservedCaseIds).toEqual(['fee'])
    expect(describeTimings([null, 10, 100, 30])).toEqual({ n: 3, minMs: 10, p50Ms: 30, p95Ms: 100 })
    expect(describeTimings([10, 30])).toEqual({ n: 2, minMs: 10, p50Ms: 20, p95Ms: 30 })
  })

  it('distinguishes intentionally unrequested controls from requested but unobserved cases', () => {
    const extended = structuredClone(manifest)
    extended.cases.push({ ...extended.cases[0]!, id: 'other' })
    const report = gradeNativeRun(
      { ...observe(), configuration: { selectedCases: ['fee'] } },
      extended,
    )
    expect(report.summary).toMatchObject({
      manifestCases: 2,
      expectedCases: 1,
      requestedCaseIds: ['fee'],
      unrequestedCaseIds: ['other'],
      unobservedCaseIds: [],
    })
    expect(
      gradeNativeRun(
        { ...observe(), queries: [], configuration: { selectedCases: ['fee'] } },
        extended,
      ).summary.unobservedCaseIds,
    ).toEqual(['fee'])
    expect(() =>
      gradeNativeRun({ ...observe(), configuration: { selectedCases: ['other'] } }, extended),
    ).toThrow('not requested')
    expect(() =>
      gradeNativeRun({ ...observe(), configuration: { selectedCases: ['fee', 'fee'] } }, extended),
    ).toThrow('Invalid requested')
  })

  it('flags an invoke that resolves before its terminal stream event is observed', () => {
    const report = gradeNativeRun(
      observe({ events: [{ type: 'citation', doc_id: 72, chunk_id: 3 }] }),
      manifest,
    )
    expect(report.queries[0]?.reviewFlags).toContain('terminal-event-not-observed')
    expect(report.queries[0]?.manualReviewRequired).toBe(true)
  })

  it('separates first-pass and repeated timings without treating absent visible-token timing as zero', () => {
    const raw = observe()
    raw.queries[0]!.repetition = 0
    raw.queries.push({
      ...raw.queries[0]!,
      repetition: 1,
      ttftMs: 200,
      firstVisibleTokenMs: 250,
      totalMs: 500,
    })
    const report = gradeNativeRun(raw, manifest)
    expect(report.summary.byRepetition['0']!.observedQueries).toBe(1)
    expect(report.summary.byRepetition['0']!.firstVisibleToken.n).toBe(0)
    expect(report.summary.byRepetition['1']!.firstVisibleToken.p50Ms).toBe(250)
    expect(report.summary.byRepetition['1']!.total.p50Ms).toBe(500)
    expect(report.summary.observedQueries).toBe(2)
  })
})

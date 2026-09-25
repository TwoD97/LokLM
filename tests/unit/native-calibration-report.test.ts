import { describe, expect, it } from 'vitest'
import {
  describeTimings,
  gradeNativeRun,
  type NativeCalibrationRun,
  type NativeQueryObservation,
} from '../evals/native-calibration/report'
import type { CalibrationManifest } from '../evals/native-calibration/schema'

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

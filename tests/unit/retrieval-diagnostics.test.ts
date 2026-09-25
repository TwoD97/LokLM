import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLAT, hit, retrievalHarness } from './fixtures/retrievalHarness'

const { traces } = vi.hoisted(() => ({ traces: [] as Array<Record<string, unknown>> }))
vi.mock('@main/services/retrieval/trace', () => ({
  retrievalTrace: (build: () => Record<string, unknown>) => traces.push(build()),
}))

afterEach(() => {
  traces.length = 0
  vi.restoreAllMocks()
})

describe('opt-in retrieval calibration diagnostics', () => {
  it('preserves raw native scores before fusion/floor/cap and identifies the retained evidence', async () => {
    const { service, lexical, dense } = retrievalHarness()
    const privateText = 'SOURCE CONTENT MUST NOT BE IN A DIAGNOSTIC TRACE'
    lexical.mockResolvedValue([hit(1, 0.000000123, { text: privateText }), hit(2, 0.0000001)])
    dense.mockResolvedValue([hit(101, 0.1), hit(102, 0.8), hit(1, 0.7)])
    await service.search(1, 'Revenue outlook', 1, FLAT)

    const trace = traces[0]!
    expect(trace).toMatchObject({
      traceVersion: 2,
      embedderIdentity: 'bundled:bge-m3',
      candidateK: 2,
      poolSize: 4,
      flooredOut: 1,
      rerankAttempted: false,
      usedWeakFallback: false,
      thresholds: { nativeCosine: 0.25, rerank: null },
    })
    expect(trace['durationMs']).toEqual(expect.any(Number))
    expect(trace['arms']).toEqual([
      {
        variant: 0,
        lexical: [
          { chunk: 1, doc: 1, rank: 1, score: 0.000000123 },
          { chunk: 2, doc: 2, rank: 2, score: 0.0000001 },
        ],
        dense: [
          { chunk: 101, doc: 101, rank: 1, score: 0.1 },
          { chunk: 102, doc: 102, rank: 2, score: 0.8 },
          { chunk: 1, doc: 1, rank: 3, score: 0.7 },
        ],
      },
    ])
    const candidates = trace['candidates'] as Array<Record<string, unknown>>
    expect(candidates.find((item) => item['chunk'] === 1)).toMatchObject({
      bm25Score: 0.000000123,
      cosineScore: 0.7,
      rrfScore: 1 / 61 + 1 / 63,
      passesNativeFloor: true,
      inScoringPool: true,
      selectedPrimary: true,
      selectedFinal: true,
    })
    expect(candidates.find((item) => item['chunk'] === 101)).toMatchObject({
      bm25Score: null,
      cosineScore: 0.1,
      passesNativeFloor: false,
      inScoringPool: false,
      adjustedScore: null,
      selectedFinal: false,
    })
    expect(candidates.find((item) => item['chunk'] === 102)).toMatchObject({
      passesNativeFloor: true,
      inScoringPool: false,
      selectedFinal: false,
    })
    expect(JSON.stringify(trace)).not.toContain(privateText)
  })

  it('distinguishes failed reranker input, fallback selection, and weak-only retention', async () => {
    const { service, dense, rerankerReady, rank } = retrievalHarness()
    dense.mockResolvedValue([hit(101, 0.1), hit(102, 0.09)])
    rerankerReady.mockReturnValue(true)
    rank.mockRejectedValue(new Error('Reranker unavailable'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await service.search(1, 'Revenue outlook', 2, { ...FLAT, rerank: true })
    expect(traces[0]).toMatchObject({
      rerank: false,
      rerankAttempted: true,
      usedWeakFallback: true,
    })
    const candidates = traces[0]!['candidates'] as Array<Record<string, unknown>>
    expect(candidates).toEqual([
      expect.objectContaining({
        chunk: 101,
        inRerankPool: true,
        rerankScore: null,
        passesNativeFloor: false,
        survivedFloor: true,
        selectedFinal: true,
      }),
      expect.objectContaining({
        chunk: 102,
        inRerankPool: true,
        rerankScore: null,
        passesNativeFloor: false,
        survivedFloor: false,
        selectedFinal: false,
      }),
    ])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { dynamicScoreCutCount } from '@main/services/retrieval/heuristics'
import { FLAT, hit, retrievalHarness } from './fixtures/retrievalHarness'

vi.mock('@main/services/retrieval/trace', () => ({ retrievalTrace: () => {} }))
afterEach(() => vi.restoreAllMocks())

describe('dynamic-K nonnegative score contract', () => {
  const slate = (...scores: number[]) => scores.map((score, i) => hit(i + 1, score))
  const cut = (scores: number[], min = 2, max = 10, tau = 0.6) =>
    dynamicScoreCutCount(slate(...scores), min, max, 'nonnegative', tau)

  it.each([
    [0.034, 0.033, 0.005, 0.0001],
    [0.95, 0.9, 0.1, 0.05],
    [3, 2.9, 0.5, 0.1],
  ])('cuts nonnegative weights without applying another sigmoid: %j', (...scores) => {
    expect(cut(scores)).toBe(2)
  })

  it('keeps the same cutoff across positive scales', () => {
    const scores = [0.034, 0.033, 0.005, 0.0001]
    for (const scale of [1e-10, 0.01, 1, 10, 1e10])
      expect(cut(scores.map((score) => score * scale))).toBe(2)
  })

  it('uses a strict ratio boundary and retains ties', () => {
    expect(cut([0.9, 0.5, 0.3])).toBe(3)
    expect(cut([0.9, 0.5, 0.299])).toBe(2)
    expect(cut([0.4, 0.4, 0.4, 0.4], 2, 3)).toBe(3)
    expect(cut([0, 0, 0, 0], 2, 3)).toBe(3)
    expect(cut([0.9, 0.8, 0, 0])).toBe(2)
    expect(cut([Number.MIN_VALUE, Number.MIN_VALUE, 0])).toBe(2)
  })

  it('respects empty slates, zero maximum, availability and clamped minima', () => {
    expect(cut([], 2, 10)).toBe(0)
    expect(cut([0.9, 0.8], 2, 0)).toBe(0)
    expect(cut([0.9], 2, 10)).toBe(1)
    expect(cut([0.9, 0.01], 2, 10)).toBe(2)
    expect(cut([0.9, 0.8, 0.01], 8, 2)).toBe(2)
    expect(cut([0.9, 0.01, 0], 0, 3)).toBe(1)
    expect(cut([0.9, 0.8, 0.7, 0.01], 2, 3)).toBe(3)
  })

  it.each([
    [0.9, 0.8, Number.NaN, 0.01],
    [0.9, 0.8, Number.POSITIVE_INFINITY, 0.01],
    [0.9, 0.8, Number.NEGATIVE_INFINITY, 0.01],
    [2, 1, -4, -5],
    [0.9, 0.1, 0.8, 0.01],
  ])('does not infer a gap from malformed or unsorted scores: %j', (...scores) => {
    expect(cut(scores)).toBe(scores.length)
  })

  it('declines unknown domains and sparse slates without mutating the input', () => {
    const rows = slate(0.9, 0.8, 0.01)
    const before = structuredClone(rows)
    expect(dynamicScoreCutCount(rows, 2, 3, 'logit' as never)).toBe(3)
    expect(rows).toEqual(before)
    delete rows[1]
    expect(dynamicScoreCutCount(rows, 2, 3, 'nonnegative')).toBe(3)
  })

  it.each([0, -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not cut for invalid tau %s',
    (tau) => expect(cut([0.9, 0.8, 0.01], 2, 3, tau)).toBe(3),
  )

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid bounds %s',
    (value) => {
      expect(() => cut([0.9, 0.8, 0.1], value, 3)).toThrow(RangeError)
      expect(() => cut([0.9, 0.8, 0.1], 2, value)).toThrow(RangeError)
    },
  )
})

function rankedHarness(scores: number[], sourcePatch: Parameters<typeof hit>[2][] = []) {
  const harness = retrievalHarness()
  harness.lexical.mockResolvedValue(
    scores.map((_, index) =>
      hit(index + 1, 10 - index, {
        document_id: index < 2 ? 1 : index,
        ordinal: index === 1 ? 1 : 0,
        ...sourcePatch[index],
      }),
    ),
  )
  harness.rerankerReady.mockReturnValue(true)
  harness.rank.mockImplementation(async (_query, passages) =>
    passages.map((text) => {
      const id = Number(/^Passage (\d+)/u.exec(text)![1])
      return scores[id - 1]!
    }),
  )
  return harness
}

const RANKED = { ...FLAT, rerank: true, dynamicK: true, documentDiversity: true }

describe('dynamic-K in the real retrieval pipeline', () => {
  it('excludes the cliff suffix before diversity chooses another document', async () => {
    const { service } = rankedHarness([0.9, 0.85, 0.2, 0.1])
    const result = await service.search(1, 'measurement', 4, RANKED)
    expect(result.map((item) => item.chunk_id)).toEqual([1, 2])
    expect(result.every((item) => item.document_id === 1)).toBe(true)
  })

  it('sorts provider scores before cutting the primary slate', async () => {
    const { service } = rankedHarness([0.1, 0.9, 0.8, 0.01], [{}, {}, { document_id: 1 }])
    expect(
      (await service.search(1, 'measurement', 4, RANKED)).map((item) => item.chunk_id),
    ).toEqual([2, 3])
  })

  it('does not restore an excluded code hit through code-share injection', async () => {
    const { service } = rankedHarness(
      [0.9, 0.85, 0.01, 0.001],
      [{}, {}, { heading_path: ['utility.ts', 'unrelatedFunction'] }],
    )
    expect(
      (
        await service.search(1, 'Explain parseTask', 4, { ...RANKED, documentDiversity: false })
      ).map((item) => item.chunk_id),
    ).toEqual([1, 2])
  })

  it('cuts an actual small-positive fused RRF cliff without changing the cosine floor', async () => {
    const { service, lexical, dense } = retrievalHarness()
    const rows = [hit(1, 8), hit(2, 7, { document_id: 1, ordinal: 1 }), hit(3, 6), hit(4, 5)]
    lexical.mockResolvedValue(rows)
    dense.mockResolvedValue([
      { ...rows[0]!, score: 0.9 },
      { ...rows[1]!, score: 0.8 },
    ])
    const result = await service.search(1, 'measurement', 4, {
      ...FLAT,
      dynamicK: true,
      documentDiversity: true,
    })
    expect(result.map((item) => item.chunk_id)).toEqual([1, 2])
    expect(result[0]!.score).toBeCloseTo(2 / 61)
    expect(result[1]!.score).toBeCloseTo(2 / 62)
  })

  it('preserves default and explicitly disabled fixed-K diversity behavior', async () => {
    const { service } = rankedHarness([0.9, 0.85, 0.2, 0.1])
    const options = { ...FLAT, rerank: true, documentDiversity: true }
    const defaultResult = await service.search(1, 'measurement', 3, options)
    const disabled = await service.search(1, 'measurement', 3, { ...options, dynamicK: false })
    expect(defaultResult).toEqual(disabled)
    expect(defaultResult.map((item) => item.chunk_id)).toEqual([1, 3, 4])
  })

  it('keeps the wider diversity pool when no score cliff was found', async () => {
    const { service } = rankedHarness([0.9, 0.85, 0.8, 0.75])
    const enabled = await service.search(1, 'measurement', 3, RANKED)
    const disabled = await service.search(1, 'measurement', 3, { ...RANKED, dynamicK: false })
    expect(enabled).toEqual(disabled)
    expect(enabled.map((item) => item.chunk_id)).toEqual([1, 3, 4])
  })

  it('keeps code-share eligibility beyond topK when no score cliff was found', async () => {
    const { service } = rankedHarness(
      [0.9, 0.85, 0.8, 0.75],
      [{}, {}, {}, { heading_path: ['utility.ts', 'unrelatedFunction'] }],
    )
    const options = { ...RANKED, documentDiversity: false }
    const enabled = await service.search(1, 'Explain parseTask', 3, options)
    const disabled = await service.search(1, 'Explain parseTask', 3, {
      ...options,
      dynamicK: false,
    })
    expect(enabled).toEqual(disabled)
    expect(enabled.map((item) => item.chunk_id)).toEqual([1, 2, 4])
  })

  it.each([0.2, 0.95])(
    'retains the existing reranker floor and best-hit fallback at %s',
    async (relevanceFloor) => {
      const { service } = rankedHarness([0.9, 0.1, 0.09, 0.08])
      expect(
        (await service.search(1, 'measurement', 4, { ...RANKED, relevanceFloor })).map(
          (item) => item.chunk_id,
        ),
      ).toEqual([1])
    },
  )

  it('keeps cosine filtering on reranker failure without applying a rerank floor to RRF', async () => {
    const { service, lexical, dense, rerankerReady, rank } = retrievalHarness()
    lexical.mockResolvedValue([hit(1, 9)])
    dense.mockResolvedValue([hit(2, 0.1), hit(3, 0.8)])
    rerankerReady.mockReturnValue(true)
    rank.mockResolvedValue([Number.NaN, 0.9, 0.5])
    const result = await service.search(1, 'measurement', 4, {
      ...RANKED,
      relevanceFloor: 0.99,
      noRerankRelevanceFloor: 0.34,
    })
    expect(result.map((item) => item.chunk_id)).toEqual([1, 3])
  })

  it('does not grow an entirely weak dense fallback to the dynamic minimum', async () => {
    const { service, dense } = retrievalHarness()
    dense.mockResolvedValue([hit(1, 0.2), hit(2, 0.1)])
    expect(
      (
        await service.search(1, 'measurement', 4, {
          ...FLAT,
          dynamicK: true,
          noRerankRelevanceFloor: 0.34,
        })
      ).map((item) => item.chunk_id),
    ).toEqual([1])
  })
})

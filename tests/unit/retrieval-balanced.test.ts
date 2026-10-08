import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLAT, hit, retrievalHarness } from './fixtures/retrievalHarness'

vi.mock('@main/services/retrieval/trace', () => ({ retrievalTrace: () => {} }))
afterEach(() => vi.restoreAllMocks())

describe('production hybrid candidate selection', () => {
  it('keeps a short foreign-language fact ahead of a weaker long same-language passage', async () => {
    const { service, lexical, dense } = retrievalHarness()
    const fact = hit(1, 4, { language: 'de', text: 'Der Plan wurde am 12. Januar genehmigt.' })
    const distractor = hit(2, 1, {
      language: 'en',
      text: 'General background about the service. '.repeat(15),
    })
    lexical.mockResolvedValue([fact, distractor])
    dense.mockResolvedValue([
      { ...fact, score: 0.88 },
      { ...distractor, score: 0.36 },
    ])
    const options = {
      multiQuery: false,
      rerank: false,
      wholeDocFallback: false,
      documentDiversity: false,
    }
    const english = await service.search(1, 'When was the plan approved?', 2, {
      ...options,
      responseLanguage: 'en',
    })
    const german = await service.search(1, 'When was the plan approved?', 2, {
      ...options,
      responseLanguage: 'de',
    })
    expect(english.map((item) => item.chunk_id)).toEqual([1, 2])
    expect(german.map((item) => item.chunk_id)).toEqual([1, 2])
  })

  it('sends only the factual question to lexical and dense search', async () => {
    const { service, lexical, embed } = retrievalHarness()
    await service.search(1, 'When was the plan approved? Answer in one short sentence.', 3, FLAT)
    expect(lexical).toHaveBeenCalledTimes(1)
    expect(lexical.mock.calls[0]![1]).toBe('When plan approved')
    expect(embed).toHaveBeenCalledTimes(1)
    expect(embed.mock.calls[0]![0]).toEqual(['When was the plan approved?'])
  })

  it.each([
    'Briefly explain the evidence.',
    'Bitte erkläre kurz die Belege.',
    'Belege beide Grenzen.',
    'Please support all claims with evidence.',
    'Cite each value with sources.',
  ])('does not let a generic evidence instruction cast independent RRF votes: %s', async (tail) => {
    const { service, lexical, dense, embed } = retrievalHarness()
    const question = 'Which approved contract applies?'
    const lexicalQuestion = 'Which approved contract applies'
    lexical.mockImplementation(async (_workspace, query) =>
      (query === lexicalQuestion ? [1, 2, 3, 4] : [3, 4, 1, 2]).map((id) => hit(id, 1)),
    )
    embed.mockImplementation(async ([query]) => [new Float32Array([query === question ? 1 : 2])])
    dense.mockImplementation(async (_workspace, vector) =>
      (vector[0] === 1 ? [2, 1, 3, 4] : [4, 3, 2, 1]).map((id) => hit(id, 0.5)),
    )
    const result = await service.search(1, `${question} ${tail}`, 4, FLAT)
    expect(result.map((item) => item.chunk_id)).toEqual([1, 2, 3, 4])
    expect(lexical.mock.calls.map((call) => call[1])).toEqual([lexicalQuestion])
    expect(embed.mock.calls.map((call) => call[0])).toEqual([[question]])
    expect(dense).toHaveBeenCalledTimes(1)
  })

  it('does not promote unrelated titles that match only answer-format instructions', async () => {
    const { service, lexical, dense } = retrievalHarness()
    const relevant = hit(1, 5, { document_title: 'Project timeline' })
    const unrelated = hit(2, 1, { document_title: 'Short sentence reference' })
    lexical.mockResolvedValue([relevant, unrelated])
    dense.mockResolvedValue([
      { ...relevant, score: 0.9 },
      { ...unrelated, score: 0.8 },
    ])
    const result = await service.search(
      1,
      'Which deadline applies? Answer in one short sentence.',
      2,
      {
        ...FLAT,
        titleBoostFactor: 1.25,
      },
    )
    expect(result.map((item) => item.chunk_id)).toEqual([1, 2])
  })

  it('keeps lexical anchors and strong semantic-only matches on the 4 GB preset', async () => {
    const { service, lexical, dense, rank } = retrievalHarness()
    lexical.mockResolvedValue(Array.from({ length: 20 }, (_, i) => hit(i + 1, 20 - i)))
    dense.mockResolvedValue(Array.from({ length: 20 }, (_, i) => hit(i + 101, 0.9 - i / 100)))
    const result = await service.search(1, 'Revenue outlook', 10, FLAT)
    expect(result.map((item) => item.chunk_id)).toEqual([1, 101, 2, 102, 3, 103, 4, 104, 5, 105])
    expect(lexical.mock.calls[0]![2]).toBe(20)
    expect(rank).not.toHaveBeenCalled()
  })

  it('keeps date digits in search without promoting incidental filename numbers', async () => {
    const { service, lexical, dense, embed } = retrievalHarness()
    const relevant = hit(4, 5, { document_title: 'record-04.md' })
    const distractor = hit(1, 1, { document_title: 'record-01.md' })
    lexical.mockResolvedValue([relevant, distractor])
    dense.mockResolvedValue([
      { ...relevant, score: 0.9 },
      { ...distractor, score: 0.3 },
    ])
    const query = 'Which license applies on 2034-06-01?'
    const result = await service.search(1, query, 2, { ...FLAT, titleBoostFactor: 1.25 })
    expect(result.map((item) => item.chunk_id)).toEqual([4, 1])
    expect(lexical.mock.calls.map((call) => call[1])).toEqual(['Which license applies 2034 06 01'])
    expect(embed.mock.calls.map((call) => call[0])).toEqual([[query]])
  })

  it('retains cross-variant consensus regardless of question order', async () => {
    const { service, lexical, dense, embed } = retrievalHarness()
    lexical.mockImplementation(async (_workspace: number, q: string) =>
      q.includes('alpha') ? [1, 2, 3, 4].map((id) => hit(id, 9)) : [],
    )
    embed.mockImplementation(async ([q]: string[]) => [
      new Float32Array([q!.includes('alpha') ? 1 : 2]),
    ])
    dense.mockImplementation(async (_workspace: number, vector: number[]) =>
      (vector[0] === 1 ? [5, 6, 7, 8] : [8, 9, 10, 11]).map((id) => hit(id)),
    )
    const first = await service.search(1, 'Where is alpha located? Where is beta located?', 2, FLAT)
    const second = await service.search(
      1,
      'Where is beta located? Where is alpha located?',
      2,
      FLAT,
    )
    expect(first.map((item) => item.chunk_id)).toEqual([8, 1])
    expect(second).toEqual(first)
  })

  it.each(['off', 'throws', 'invalid'] as const)(
    'retains eligible lexical evidence when weak dense consensus fills the rerank pool (%s)',
    async (rerankMode) => {
      const { service, lexical, dense, rank, rerankerReady } = retrievalHarness()
      lexical.mockImplementation(async (_workspace: number, query: string) =>
        Array.from({ length: 20 }, (_, i) => hit((query.includes('alpha') ? 1 : 21) + i, 20 - i)),
      )
      dense.mockResolvedValue(Array.from({ length: 20 }, (_, i) => hit(101 + i, 0.1)))
      rerankerReady.mockReturnValue(rerankMode !== 'off')
      if (rerankMode === 'throws') rank.mockRejectedValue(new Error('Model unavailable'))
      else rank.mockResolvedValue([NaN])
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await service.search(1, 'Where is alpha located? Where is beta located?', 10, {
        ...FLAT,
        rerank: rerankMode !== 'off',
      })

      expect(result).toHaveLength(10)
      expect(result.map((item) => item.chunk_id)).toEqual([1, 21, 2, 22, 3, 23, 4, 24, 5, 25])
      expect(result.some((item) => item.chunk_id < 21)).toBe(true)
      expect(result.some((item) => item.chunk_id >= 21)).toBe(true)
      if (rerankMode !== 'off') expect(rank.mock.calls[0]![1]).toHaveLength(20)
    },
  )

  it('preserves the existing best-hit fallback when every candidate is weak', async () => {
    const { service, dense } = retrievalHarness()
    dense.mockResolvedValue([hit(101, 0.1), hit(102, 0.09)])
    const result = await service.search(1, 'Revenue outlook', 10, FLAT)
    expect(result.map((item) => item.chunk_id)).toEqual([101])
  })

  it('falls back to lexical evidence when asynchronous vector search fails', async () => {
    const { service, lexical, dense } = retrievalHarness()
    lexical.mockResolvedValue([hit(1, 10)])
    dense.mockRejectedValue(new Error('Vector index unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await service.search(1, 'Revenue outlook', 10, FLAT)
    expect(result.map((item) => item.chunk_id)).toEqual([1])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it.each(['throws', 'invalid'] as const)(
    'preserves balanced semantic recall when reranking %s',
    async (failure) => {
      const { service, lexical, dense, rank, rerankerReady } = retrievalHarness()
      lexical.mockResolvedValue(Array.from({ length: 20 }, (_, i) => hit(i + 1, 20 - i)))
      dense.mockResolvedValue(Array.from({ length: 20 }, (_, i) => hit(i + 101, 0.9 - i / 100)))
      rerankerReady.mockReturnValue(true)
      if (failure === 'throws') rank.mockRejectedValue(new Error('Model unavailable'))
      else rank.mockResolvedValue([NaN])
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = await service.search(1, 'Revenue outlook', 10, {
        ...FLAT,
        rerank: true,
        relevanceFloor: 0.2,
      })
      const without = await service.search(1, 'Revenue outlook', 10, FLAT)
      expect(result).toEqual(without)
      expect(result.filter((item) => item.chunk_id > 100)).toHaveLength(5)
    },
  )

  it('uses provider capabilities rather than a missing GPU label and keeps explicit overrides', async () => {
    const { service, lexical, cpu, llm } = retrievalHarness()
    const options = { multiQuery: false, wholeDocFallback: false }
    await service.search(1, 'Revenue outlook', 10, options)
    cpu.mockReturnValue(true)
    await service.search(1, 'Revenue outlook', 10, options)
    await service.search(1, 'Revenue outlook', 10, { ...options, cpuOptimized: false })
    delete (llm as { isCpuInference?: unknown }).isCpuInference
    await service.search(1, 'Revenue outlook', 10, options)
    expect(lexical.mock.calls.map((call) => call[2])).toEqual([40, 20, 40, 40])
  })

  // Use the committed code-query fixture's original phrasings, without loading
  // a model or implying a corpus-wide recall measurement from synthetic ranks.
  const codeQueries = ['loklm.json', 'loklm-de.json'].flatMap((name) => {
    const data = JSON.parse(
      readFileSync(new URL(`../evals/data/code-queries/${name}`, import.meta.url), 'utf8'),
    ) as {
      items: Array<{ id: string; variants: Array<{ type: string; text: string }> }>
    }
    return data.items
      .find((item) => item.id === 'AuthService')!
      .variants.filter(
        (variant) =>
          variant.type === 'exact-symbol' ||
          (name === 'loklm-de.json' && variant.type === 'nl-description'),
      )
      .map((variant) => variant.text)
  })
  it.each(codeQueries)(
    'preserves the AuthService anchor for existing code fixture: %s',
    async (query) => {
      const { service, lexical, dense, rank, rerankerReady } = retrievalHarness({ codebase: true })
      const source = hit(1, 9, {
        document_title: 'AuthService.ts',
        heading_path: ['src/main/services/auth/AuthService.ts', 'AuthService'],
        text: 'export class AuthService {\n  async login() { /* Opens the encrypted vault and session. */ }\n}\n'.repeat(
          4,
        ),
      })
      const prose = hit(2, 0.95, {
        document_title: 'Overview.md',
        text: 'The authentication class manages user login. '.repeat(12),
      })
      lexical.mockResolvedValue([source, prose])
      dense.mockResolvedValue([prose, source])
      rerankerReady.mockReturnValue(true)
      const result = await service.search(1, query, 2, { ...FLAT, rerank: true })
      expect(result[0]!.chunk_id).toBe(1)
      expect(rank).not.toHaveBeenCalled()
    },
  )
})

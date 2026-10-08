import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLAT, hit, retrievalHarness } from './fixtures/retrievalHarness'

vi.mock('@main/services/retrieval/trace', () => ({ retrievalTrace: () => {} }))
afterEach(() => vi.restoreAllMocks())

describe('document lexical filtering in production retrieval', () => {
  it.each([
    ['List the counts with the observation times.', 'List counts observation times'],
    ['Nenne die Bestände mit den Uhrzeiten.', 'Nenne Bestände Uhrzeiten'],
    ['für Łódź und 東京 with Δοκιμή', 'Łódź 東京 Δοκιμή'],
  ])('filters only the lexical arm for %s', async (question, lexicalQuestion) => {
    const { service, lexical, embed, dense } = retrievalHarness()
    await service.search(1, question, 3, FLAT)
    expect(lexical).toHaveBeenCalledOnce()
    expect(lexical.mock.calls[0]![1]).toBe(lexicalQuestion)
    expect(embed).toHaveBeenCalledOnce()
    expect(embed.mock.calls[0]![0]).toEqual([question])
    expect(embed.mock.calls[0]![1]).toMatchObject({ codebase: false })
    expect(dense).toHaveBeenCalledOnce()
  })

  it('does not give function-word-only documents a second vote over semantic evidence', async () => {
    const { service, lexical, dense, embed } = retrievalHarness()
    const question = 'Nenne die Messwerte mit den Uhrzeiten.'
    const unrelated = hit(3, 1, { text: 'Die allgemeine Einführung mit den Regeln.' })
    const first = hit(1, 0.9, { text: 'Morning measurement: twelve samples at 08:00.' })
    const second = hit(2, 0.88, { text: 'Evening measurement: seventeen samples at 18:00.' })
    // A small OR-token fixture reproduces the unwanted lexical vote. The
    // relevant foreign-language facts rely entirely on semantic retrieval.
    lexical.mockImplementation(async (_workspace, query) =>
      query.split(/\s+/u).some((term) => ['die', 'mit', 'den'].includes(term.toLowerCase()))
        ? [unrelated]
        : [],
    )
    dense.mockResolvedValue([first, second, { ...unrelated, score: 0.7 }])
    const result = await service.search(1, question, 3, FLAT)
    expect(result.map((item) => item.chunk_id)).toEqual([1, 2, 3])
    expect(lexical.mock.calls[0]![1]).toBe('Nenne Messwerte Uhrzeiten')
    expect(embed.mock.calls[0]![0]).toEqual([question])
  })

  it('keeps code workspace lexical expansion and semantic query separate', async () => {
    const { service, lexical, embed } = retrievalHarness({ codebase: true })
    const question = 'Find the AuthService in the code'
    await service.search(1, question, 3, FLAT)
    expect(lexical.mock.calls[0]![1]).toBe('Find the AuthService in the code auth service')
    expect(embed.mock.calls[0]![0]).toEqual([question])
    expect(embed.mock.calls[0]![1]).toMatchObject({ codebase: true })
  })

  it.each(['Find "to be" in the play', 'What does `is` mean in the expression?', 'die mit den'])(
    'retains literal and stopword-only lexical behavior for %s',
    async (question) => {
      const { service, lexical, embed } = retrievalHarness()
      await service.search(1, question, 3, FLAT)
      expect(lexical.mock.calls[0]![1]).toBe(question)
      expect(embed.mock.calls[0]![0]).toEqual([question])
    },
  )

  it('does not collapse distinct semantic queries that have identical lexical terms', async () => {
    const { service, lexical, embed, embedder } = retrievalHarness()
    Object.assign(embedder, { queryCacheKey: (query: string) => query })
    await service.search(1, 'the counts in the report', 3, FLAT)
    await service.search(1, 'counts report', 3, FLAT)
    expect(lexical.mock.calls.map((call) => call[1])).toEqual(['counts report', 'counts report'])
    expect(embed.mock.calls.map((call) => call[0])).toEqual([
      ['the counts in the report'],
      ['counts report'],
    ])
  })
})

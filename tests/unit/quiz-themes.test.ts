import { describe, it, expect, vi } from 'vitest'
import {
  allocateSlots,
  dedupThemes,
  extractThemesForDocument,
} from '../../src/main/services/quiz/themes'
import type { QuizTheme } from '../../src/main/services/quiz/types'
import type { ChunkRow } from '../../src/main/db/database'
import type { EmbedderProvider, LlmProvider } from '../../src/main/services/providers/types'

function makeTheme(partial: Partial<QuizTheme> & Pick<QuizTheme, 'title' | 'weight'>): QuizTheme {
  return {
    id: partial.id ?? `t-${partial.title}`,
    docId: partial.docId ?? 1,
    summary: partial.summary ?? `summary of ${partial.title}`,
    groundingChunkIds: partial.groundingChunkIds ?? [],
    ...partial,
  }
}

describe('allocateSlots', () => {
  it('distributes proportional to weight via largest-remainder', () => {
    const themes = [makeTheme({ title: 'A', weight: 3 }), makeTheme({ title: 'B', weight: 1 })]
    const slots = allocateSlots(themes, 4)
    expect(slots.map((s) => [s.theme.title, s.budget])).toEqual([
      ['A', 3],
      ['B', 1],
    ])
  })

  it('floors each theme to at least 1 slot when total >= themes.length', () => {
    const themes = [
      makeTheme({ title: 'A', weight: 100 }),
      makeTheme({ title: 'B', weight: 1 }),
      makeTheme({ title: 'C', weight: 1 }),
    ]
    const slots = allocateSlots(themes, 5)
    const byTitle = Object.fromEntries(slots.map((s) => [s.theme.title, s.budget]))
    expect(byTitle.B).toBeGreaterThanOrEqual(1)
    expect(byTitle.C).toBeGreaterThanOrEqual(1)
    expect(slots.reduce((s, x) => s + x.budget, 0)).toBe(5)
  })

  it('picks top-N by weight when total < themes.length', () => {
    const themes = [
      makeTheme({ title: 'A', weight: 5 }),
      makeTheme({ title: 'B', weight: 3 }),
      makeTheme({ title: 'C', weight: 1 }),
    ]
    const slots = allocateSlots(themes, 2)
    expect(slots.map((s) => s.theme.title).sort()).toEqual(['A', 'B'])
    expect(slots.every((s) => s.budget === 1)).toBe(true)
  })

  it('distributes evenly when all weights are zero', () => {
    const themes = [makeTheme({ title: 'A', weight: 0 }), makeTheme({ title: 'B', weight: 0 })]
    const slots = allocateSlots(themes, 4)
    expect(slots.map((s) => s.budget).sort()).toEqual([2, 2])
  })

  it('returns empty for empty input', () => {
    expect(allocateSlots([], 5)).toEqual([])
    expect(allocateSlots([makeTheme({ title: 'A', weight: 1 })], 0)).toEqual([])
  })
})

describe('dedupThemes', () => {
  // Canned-vector embedder: similar themes get nearly-identical vectors so we
  // can deterministically exercise the 0.85 cosine clustering.
  function fakeEmbedder(vectors: Record<string, Float32Array>): EmbedderProvider {
    return {
      embed: async (texts: string[]) =>
        texts.map((t) => {
          for (const [key, v] of Object.entries(vectors)) {
            if (t.includes(key)) return v
          }
          return new Float32Array([1, 0, 0])
        }),
      dimension: () => 3,
      identity: () => 'fake',
      isReady: () => true,
      ensureReady: async () => undefined,
    }
  }

  it('collapses near-identical themes and sums weights', async () => {
    const v = (a: number, b: number, c: number): Float32Array => new Float32Array([a, b, c])
    const embedder = fakeEmbedder({
      A1: v(1, 0, 0),
      A2: v(0.99, 0.01, 0),
      B: v(0, 1, 0),
    })
    const themes = [
      makeTheme({ id: '1', title: 'A1', weight: 3 }),
      makeTheme({ id: '2', title: 'A2', weight: 2 }),
      makeTheme({ id: '3', title: 'B', weight: 5 }),
    ]
    const result = await dedupThemes(embedder, themes)
    expect(result).toHaveLength(2)
    const aLike = result.find((t) => t.title.startsWith('A'))!
    expect(aLike.weight).toBe(5)
  })

  it('keeps themes apart when cosine < threshold', async () => {
    const v = (a: number, b: number, c: number): Float32Array => new Float32Array([a, b, c])
    const embedder = fakeEmbedder({
      A: v(1, 0, 0),
      B: v(0, 1, 0),
    })
    const themes = [
      makeTheme({ id: '1', title: 'A', weight: 1 }),
      makeTheme({ id: '2', title: 'B', weight: 1 }),
    ]
    const result = await dedupThemes(embedder, themes)
    expect(result).toHaveLength(2)
  })
})

describe('extractThemesForDocument', () => {
  function fakeLlm(response: string): LlmProvider {
    return {
      ask: vi.fn(),
      generateRaw: vi.fn(async () => response),
      generateTitle: vi.fn(),
      isReady: () => true,
      getStatus: () => ({ ready: true, message: null, identity: 'fake' }),
      getModelStatus: () => ({
        state: 'ready',
        modelPath: null,
        modelName: null,
        gpu: null,
        loadProgress: null,
        message: null,
        profile: null,
        source: 'bundled',
        fallback: { active: false, reason: null },
      }),
    } as unknown as LlmProvider
  }

  function chunk(id: number, text: string, tokens: number): ChunkRow {
    return {
      id,
      document_id: 1,
      ordinal: id,
      text,
      token_count: tokens,
      page_from: null,
      page_to: null,
      heading_path: null,
    }
  }

  it('returns themes from a valid JSON array', async () => {
    const llm = fakeLlm(
      '[{"title":"X","summary":"summ X","weight":3},{"title":"Y","summary":"summ Y","weight":2}]',
    )
    const themes = await extractThemesForDocument(
      { llm, documents: {} as never, contextTokens: 8192 },
      {
        docId: 1,
        docTitle: 'Doc',
        chunks: [chunk(1, 'hello world', 50)],
        language: 'en',
        targetCount: 2,
      },
    )
    expect(themes.map((t) => t.title)).toEqual(['X', 'Y'])
    expect(themes[0]!.docId).toBe(1)
  })

  it('returns empty when JSON is malformed', async () => {
    const llm = fakeLlm('not actually json')
    const themes = await extractThemesForDocument(
      { llm, documents: {} as never },
      {
        docId: 1,
        docTitle: 'Doc',
        chunks: [chunk(1, 'hello', 50)],
        language: 'en',
        targetCount: 2,
      },
    )
    expect(themes).toEqual([])
  })

  it('uses outline path when doc tokens exceed budget', async () => {
    const llm = fakeLlm('[{"title":"Big","summary":"s","weight":1}]')
    // Force the outline path: huge token count drives us over the default
    // FALLBACK_CONTEXT_TOKENS budget minus the reserves.
    const chunks = Array.from({ length: 5 }, (_, i) =>
      chunk(i + 1, `chunk ${i + 1} body text`, 100000),
    )
    const themes = await extractThemesForDocument(
      { llm, documents: {} as never },
      {
        docId: 1,
        docTitle: 'Doc',
        chunks,
        language: 'en',
        targetCount: 1,
      },
    )
    // Outline themes have empty groundingChunkIds (filled later by retrieval).
    expect(themes).toHaveLength(1)
    expect(themes[0]!.groundingChunkIds).toEqual([])
  })

  it('attaches all chunk ids in whole-doc path', async () => {
    const llm = fakeLlm('[{"title":"T","summary":"s","weight":1}]')
    const chunks = [chunk(11, 'small', 10), chunk(12, 'small', 10)]
    const themes = await extractThemesForDocument(
      { llm, documents: {} as never },
      {
        docId: 1,
        docTitle: 'Doc',
        chunks,
        language: 'en',
        targetCount: 1,
      },
    )
    expect(themes[0]!.groundingChunkIds).toEqual([11, 12])
  })
})

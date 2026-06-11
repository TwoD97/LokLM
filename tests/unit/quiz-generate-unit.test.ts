import { describe, it, expect, vi } from 'vitest'
import { generateQuestionsForUnit } from '../../src/main/services/quiz/generation'
import type { QuizUnit } from '../../src/main/services/quiz/units'
import type { ChunkRow } from '../../src/main/db/database'
import type { LlmProvider } from '../../src/main/services/providers/types'

function makeChunk(id: number, text: string): ChunkRow {
  return {
    id,
    document_id: 1,
    ordinal: id,
    text,
    token_count: Math.ceil(text.length / 3.5),
    page_from: null,
    page_to: null,
    heading_path: null,
    language: null,
  }
}

function makeUnit(chunks: ChunkRow[], overrides: Partial<QuizUnit> = {}): QuizUnit {
  return {
    docId: 1,
    docTitle: 'Crypto Lecture',
    chunks,
    tokens: chunks.reduce((s, c) => s + (c.token_count ?? 0), 0),
    quota: 1,
    title: 'Key Exchange',
    ...overrides,
  }
}

// `responses` is consumed in order, one per generateRaw call.
function fakeLlm(responses: string[]): LlmProvider {
  const generateRaw = vi.fn(async () => {
    if (responses.length === 0) throw new Error('LLM ran out of canned responses')
    return responses.shift()!
  })
  return {
    ask: vi.fn(),
    generateRaw,
    generateTitle: vi.fn(),
    contextWindowTokens: () => 0,
    isReady: () => true,
    getStatus: () => ({ ready: true, message: null, identity: 'fake' }),
  } as unknown as LlmProvider
}

const mcq = (stem: string, chunkId = 1): Record<string, unknown> => ({
  stem,
  options: ['A', 'B', 'C', 'D'],
  correct_index: 1,
  explanation: 'Because.',
  source_chunk_ids: [chunkId],
})

describe('generateQuestionsForUnit', () => {
  it('returns validated questions from exactly one LLM call', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Q1'), mcq('Q2')])])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X is X.'), makeChunk(2, 'More about X.')]),
      acceptedStems: [],
      count: 2,
    })
    expect(out.map((q) => q.stem)).toEqual(['Q1', 'Q2'])
    expect(llm.generateRaw).toHaveBeenCalledTimes(1)
  })

  it('passes a schema bounded to `count` items and a proportional maxTokens', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Q1')])])
    await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')]),
      acceptedStems: [],
      count: 2,
    })
    const opts = (llm.generateRaw as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      jsonSchema?: { maxItems?: number }
      maxTokens?: number
      noThink?: boolean
    }
    expect(opts.jsonSchema?.maxItems).toBe(2)
    expect(opts.maxTokens).toBeGreaterThanOrEqual(2 * 320)
    expect(opts.noThink).toBe(true)
  })

  it('includes citable chunk markers, the doc title and the unit title in the prompt', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Q1', 7)])])
    await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(7, 'Diffie-Hellman exchanges keys.')]),
      acceptedStems: [],
      count: 1,
    })
    const prompt = (llm.generateRaw as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(prompt).toContain('[chunk:7]')
    expect(prompt).toContain('Crypto Lecture')
    expect(prompt).toContain('Key Exchange')
  })

  it('caps the output at `count` even if the model returns more', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Q1'), mcq('Q2'), mcq('Q3')])])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')]),
      acceptedStems: [],
      count: 2,
    })
    expect(out).toHaveLength(2)
  })

  it('drops stems that duplicate accepted stems after normalization', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('What is TLS?!'), mcq('Fresh question')])])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')]),
      acceptedStems: ['what is tls'],
      count: 2,
    })
    expect(out.map((q) => q.stem)).toEqual(['Fresh question'])
  })

  it('drops intra-batch normalized duplicate stems', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('What is TLS?'), mcq('what is TLS!')])])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')]),
      acceptedStems: [],
      count: 2,
    })
    expect(out.map((q) => q.stem)).toEqual(['What is TLS?'])
  })

  it('returns empty on bad JSON without any retry call', async () => {
    const llm = fakeLlm(['not json at all'])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')]),
      acceptedStems: [],
      count: 2,
    })
    expect(out).toEqual([])
    expect(llm.generateRaw).toHaveBeenCalledTimes(1)
  })

  it('salvages the valid prefix from a truncated batch array', async () => {
    const valid = [mcq('Q1'), mcq('Q2')].map((q) => JSON.stringify(q)).join(',')
    const truncated = `[${valid},{"stem":"Q3","options":["A","B"`
    const llm = fakeLlm([truncated])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')]),
      acceptedStems: [],
      count: 2,
    })
    expect(out.map((q) => q.stem)).toEqual(['Q1', 'Q2'])
    expect(llm.generateRaw).toHaveBeenCalledTimes(1)
  })

  it('returns empty without calling the LLM when the unit has no chunks', async () => {
    const llm = fakeLlm([])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([]),
      acceptedStems: [],
      count: 1,
    })
    expect(out).toEqual([])
    expect(llm.generateRaw).not.toHaveBeenCalled()
  })

  it('attributes accepted questions to the unit title', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Q1')])])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')], { title: 'Hash Functions' }),
      acceptedStems: [],
      count: 1,
    })
    expect(out[0]!.themeTitle).toBe('Hash Functions')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { generateQuestionsForUnit } from '../../src/main/services/quiz/generation'
import { PER_UNIT_MAX_QUESTIONS } from '../../src/main/services/quiz/prompts'
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
  it('returns however many validated questions the model decided to write, in one call', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Q1'), mcq('Q2'), mcq('Q3'), mcq('Q4')])])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X is X.'), makeChunk(2, 'More about X.')]),
      acceptedStems: [],
    })
    expect(out.map((q) => q.stem)).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    expect(llm.generateRaw).toHaveBeenCalledTimes(1)
  })

  it('bounds the call with the per-unit ceiling schema and proportional maxTokens', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Q1')])])
    await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')]),
      acceptedStems: [],
    })
    const opts = (llm.generateRaw as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      jsonSchema?: { maxItems?: number }
      maxTokens?: number
      noThink?: boolean
    }
    expect(opts.jsonSchema?.maxItems).toBe(PER_UNIT_MAX_QUESTIONS)
    expect(opts.maxTokens).toBeGreaterThanOrEqual(PER_UNIT_MAX_QUESTIONS * 320)
    expect(opts.noThink).toBe(true)
  })

  it('keeps at most the per-unit ceiling even if the model returns more', async () => {
    const many = Array.from({ length: PER_UNIT_MAX_QUESTIONS + 3 }, (_, i) => mcq(`Q${i}`))
    const llm = fakeLlm([JSON.stringify(many)])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')]),
      acceptedStems: [],
    })
    expect(out).toHaveLength(PER_UNIT_MAX_QUESTIONS)
  })

  it('includes citable chunk markers, the doc title and the unit title in the prompt', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Q1', 7)])])
    await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(7, 'Diffie-Hellman exchanges keys.')]),
      acceptedStems: [],
    })
    const prompt = (llm.generateRaw as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(prompt).toContain('[chunk:7]')
    expect(prompt).toContain('Crypto Lecture')
    expect(prompt).toContain('Key Exchange')
  })

  it('drops stems that duplicate accepted stems after normalization', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('What is TLS?!'), mcq('Fresh question')])])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')]),
      acceptedStems: ['what is tls'],
    })
    expect(out.map((q) => q.stem)).toEqual(['Fresh question'])
  })

  it('drops intra-batch normalized duplicate stems', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('What is TLS?'), mcq('what is TLS!')])])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')]),
      acceptedStems: [],
    })
    expect(out.map((q) => q.stem)).toEqual(['What is TLS?'])
  })

  it('returns empty on bad JSON without any retry call', async () => {
    const llm = fakeLlm(['not json at all'])
    const out = await generateQuestionsForUnit(llm, {
      language: 'en',
      unit: makeUnit([makeChunk(1, 'X')]),
      acceptedStems: [],
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
    })
    expect(out[0]!.themeTitle).toBe('Hash Functions')
  })
})

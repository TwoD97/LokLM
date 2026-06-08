import { describe, it, expect, vi } from 'vitest'
import { generateQuestionsForTheme } from '../../src/main/services/quiz/generation'
import type { AcceptedQuestion, QuizTheme } from '../../src/main/services/quiz/types'
import type { ChunkRow } from '../../src/main/db/database'
import type { EmbedderProvider, LlmProvider } from '../../src/main/services/providers/types'

function makeChunk(id: number, text: string): ChunkRow {
  return {
    id,
    document_id: 1,
    ordinal: id,
    text,
    token_count: text.length,
    page_from: null,
    page_to: null,
    heading_path: null,
    language: null,
  }
}

function makeTheme(): QuizTheme {
  return {
    id: 'doc1:0',
    docId: 1,
    title: 'Sample theme',
    summary: 'A theme used in tests.',
    weight: 1,
    groundingChunkIds: [1, 2],
  }
}

// `responses` is consumed in order, one per generateRaw call. `ignoreSchema`
// toggles whether the mock records the jsonSchema opt (to assert pass-through).
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

// Each call to embed returns the vector for the input string, looked up in the
// table. Missing keys get [1,0,0,…]. Used to engineer specific cosine values
// against the accepted-question embeddings.
function fakeEmbedder(table: Record<string, Float32Array>): EmbedderProvider {
  return {
    embed: async (texts: string[]) => texts.map((t) => table[t] ?? new Float32Array([1, 0, 0])),
    dimension: () => 3,
    identity: () => 'fake',
    isReady: () => true,
    ensureReady: async () => undefined,
  }
}

const mcq = (stem: string, chunkId = 1): Record<string, unknown> => ({
  stem,
  options: ['A', 'B', 'C', 'D'],
  correct_index: 1,
  explanation: 'Because.',
  source_chunk_ids: [chunkId],
})

describe('generateQuestionsForTheme', () => {
  it('returns multiple validated questions from one batch response', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Q1'), mcq('Q2'), mcq('Q3')])])
    const embedder = fakeEmbedder({
      Q1: new Float32Array([1, 0, 0]),
      Q2: new Float32Array([0, 1, 0]),
      Q3: new Float32Array([0, 0, 1]),
    })
    const out = await generateQuestionsForTheme(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X is X.'), makeChunk(2, 'More about X.')],
      accepted: [],
      count: 3,
    })
    expect(out.map((q) => q.stem)).toEqual(['Q1', 'Q2', 'Q3'])
    // ONE LLM call for the whole batch.
    expect(llm.generateRaw).toHaveBeenCalledTimes(1)
  })

  it('passes the QUESTION_LIST_SCHEMA through as a jsonSchema opt', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Q1')])])
    const embedder = fakeEmbedder({ Q1: new Float32Array([1, 0, 0]) })
    await generateQuestionsForTheme(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted: [],
      count: 1,
    })
    const opts = (llm.generateRaw as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      jsonSchema?: object
      maxTokens?: number
    }
    expect(opts.jsonSchema).toBeDefined()
    expect(opts.maxTokens).toBeGreaterThan(0)
  })

  it('caps the batch at `count` even if the model returns more', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Q1'), mcq('Q2'), mcq('Q3')])])
    const embedder = fakeEmbedder({
      Q1: new Float32Array([1, 0, 0]),
      Q2: new Float32Array([0, 1, 0]),
      Q3: new Float32Array([0, 0, 1]),
    })
    const out = await generateQuestionsForTheme(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted: [],
      count: 2,
    })
    expect(out).toHaveLength(2)
  })

  it('dedups stems within the batch and against accepted', async () => {
    // Q1 collides with an already-accepted stem ([1,0,0]); Q2 is distinct;
    // Q3 collides with Q2 (both [0,1,0]) so it's dropped intra-batch.
    const llm = fakeLlm([JSON.stringify([mcq('Q1'), mcq('Q2'), mcq('Q3')])])
    const embedder = fakeEmbedder({
      Q1: new Float32Array([1, 0, 0]),
      Q2: new Float32Array([0, 1, 0]),
      Q3: new Float32Array([0, 1, 0]),
    })
    const accepted: AcceptedQuestion[] = [
      {
        ordinal: 0,
        stem: 'Accepted prior',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: '...',
        sourceChunkIds: [1],
        themeTitle: 'prior',
        stemEmbedding: new Float32Array([1, 0, 0]),
      },
    ]
    const out = await generateQuestionsForTheme(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted,
      count: 3,
    })
    expect(out.map((q) => q.stem)).toEqual(['Q2'])
  })

  it('retries once on bad JSON and accepts the retry (grammar-fallback path)', async () => {
    // Simulates a provider that ignored jsonSchema (Ollama) and emitted prose:
    // the JSON-only retry restates the contract and parses.
    const llm = fakeLlm(['not actually json', JSON.stringify([mcq('Recovered')])])
    const embedder = fakeEmbedder({ Recovered: new Float32Array([1, 0, 0]) })
    const out = await generateQuestionsForTheme(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted: [],
      count: 1,
    })
    expect(out.map((q) => q.stem)).toEqual(['Recovered'])
    expect(llm.generateRaw).toHaveBeenCalledTimes(2)
  })

  it('returns the valid subset when only some items pass validation', async () => {
    // Q1 is valid; second item has 3 options (invalid) → dropped.
    const bad = { stem: 'Q2', options: ['a', 'b', 'c'], correct_index: 0, explanation: 'x' }
    const llm = fakeLlm([JSON.stringify([mcq('Q1'), bad])])
    const embedder = fakeEmbedder({ Q1: new Float32Array([1, 0, 0]) })
    const out = await generateQuestionsForTheme(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted: [],
      count: 2,
    })
    expect(out.map((q) => q.stem)).toEqual(['Q1'])
  })

  it('returns empty after two consecutive bad-JSON outputs', async () => {
    const llm = fakeLlm(['nope', 'still nope'])
    const embedder = fakeEmbedder({})
    const out = await generateQuestionsForTheme(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted: [],
      count: 2,
    })
    expect(out).toEqual([])
    expect(llm.generateRaw).toHaveBeenCalledTimes(2)
  })

  it('returns empty without calling the LLM when grounding is empty', async () => {
    const llm = fakeLlm([])
    const embedder = fakeEmbedder({})
    const out = await generateQuestionsForTheme(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [],
      accepted: [],
      count: 3,
    })
    expect(out).toEqual([])
    expect(llm.generateRaw).not.toHaveBeenCalled()
  })

  it('salvages the valid prefix from a truncated batch array', async () => {
    // 3 complete question objects then a 4th cut off mid-object (slow CPU model
    // hit maxTokens). The whole-array JSON.parse would throw → 0; brace-matched
    // salvage keeps the 3 complete ones.
    const valid = [mcq('Q1'), mcq('Q2'), mcq('Q3')].map((q) => JSON.stringify(q)).join(',')
    const truncated = `[${valid},{"stem":"Q4","options":["A","B"`
    const llm = fakeLlm([truncated])
    const embedder = fakeEmbedder({
      Q1: new Float32Array([1, 0, 0]),
      Q2: new Float32Array([0, 1, 0]),
      Q3: new Float32Array([0, 0, 1]),
    })
    const out = await generateQuestionsForTheme(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X is X.'), makeChunk(2, 'More about X.')],
      accepted: [],
      count: 4,
    })
    expect(out.map((q) => q.stem)).toEqual(['Q1', 'Q2', 'Q3'])
    // No retry — the salvage parse already returned a non-empty subset.
    expect(llm.generateRaw).toHaveBeenCalledTimes(1)
  })

  it('carries the stem embedding onto each accepted shape', async () => {
    const llm = fakeLlm([JSON.stringify([mcq('Carry me')])])
    const embedder = fakeEmbedder({ 'Carry me': new Float32Array([0.5, 0.5, 0]) })
    const out = await generateQuestionsForTheme(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted: [],
      count: 1,
    })
    expect(out[0]!.stemEmbedding).toBeInstanceOf(Float32Array)
    expect(Array.from(out[0]!.stemEmbedding)).toEqual([0.5, 0.5, 0])
  })
})

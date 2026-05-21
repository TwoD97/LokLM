import { describe, it, expect, vi } from 'vitest'
import { generateQuestion } from '../../src/main/services/quiz/generation'
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

function fakeLlm(responses: string[]): LlmProvider {
  const generateRaw = vi.fn(async () => {
    if (responses.length === 0) throw new Error('LLM ran out of canned responses')
    return responses.shift()!
  })
  return {
    ask: vi.fn(),
    generateRaw,
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

const validQuestion = (stem: string, chunkId = 1): string =>
  JSON.stringify({
    stem,
    options: ['A', 'B', 'C', 'D'],
    correct_index: 1,
    explanation: 'Because.',
    source_chunk_ids: [chunkId],
  })

describe('generateQuestion', () => {
  it('returns the accepted question on a clean first response', async () => {
    const llm = fakeLlm([validQuestion('What is X?')])
    const embedder = fakeEmbedder({ 'What is X?': new Float32Array([1, 0, 0]) })
    const result = await generateQuestion(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X is X.'), makeChunk(2, 'More about X.')],
      accepted: [],
    })
    expect(result.question?.stem).toBe('What is X?')
    expect(result.rejected).toBe(false)
    // Exactly one LLM call when the first response is valid.
    expect(llm.generateRaw).toHaveBeenCalledTimes(1)
  })

  it('retries once on bad JSON and accepts the retry', async () => {
    const llm = fakeLlm(['not actually json', validQuestion('Retry path?')])
    const embedder = fakeEmbedder({ 'Retry path?': new Float32Array([1, 0, 0]) })
    const result = await generateQuestion(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted: [],
    })
    expect(result.question?.stem).toBe('Retry path?')
    expect(llm.generateRaw).toHaveBeenCalledTimes(2)
  })

  it('rejects after two consecutive bad-JSON outputs', async () => {
    const llm = fakeLlm(['nope', 'still nope'])
    const embedder = fakeEmbedder({})
    const result = await generateQuestion(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted: [],
    })
    expect(result.question).toBeNull()
    expect(result.rejected).toBe(true)
    expect(llm.generateRaw).toHaveBeenCalledTimes(2)
  })

  it('rejects a near-duplicate stem and retries with avoid-list, accepting a distinct one', async () => {
    // First proposal is essentially identical to the accepted stem (cosine ≈ 1
    // against [1,0,0]); retry produces a clearly distinct vector ([0,1,0],
    // cosine = 0 against [1,0,0]) so it passes.
    const llm = fakeLlm([validQuestion('Dup-ish stem'), validQuestion('Distinct stem')])
    const embedder = fakeEmbedder({
      'Dup-ish stem': new Float32Array([1, 0, 0]),
      'Distinct stem': new Float32Array([0, 1, 0]),
    })
    const accepted: AcceptedQuestion[] = [
      {
        ordinal: 0,
        stem: 'Already accepted',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: '...',
        sourceChunkIds: [1],
        themeTitle: 'prior',
        stemEmbedding: new Float32Array([1, 0, 0]),
      },
    ]
    const result = await generateQuestion(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted,
    })
    expect(result.question?.stem).toBe('Distinct stem')
    // 1 base call + 1 dup-retry = 2 LLM calls. (Embedder was called twice too,
    // once per candidate stem.)
    expect(llm.generateRaw).toHaveBeenCalledTimes(2)
  })

  it('rejects when both first and dup-retry stems collide with accepted', async () => {
    const llm = fakeLlm([validQuestion('Dup 1'), validQuestion('Dup 2')])
    const embedder = fakeEmbedder({
      'Dup 1': new Float32Array([1, 0, 0]),
      'Dup 2': new Float32Array([1, 0, 0]),
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
    const result = await generateQuestion(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted,
    })
    expect(result.question).toBeNull()
    expect(result.rejected).toBe(true)
  })

  it('returns null without calling the LLM when grounding is empty', async () => {
    const llm = fakeLlm([])
    const embedder = fakeEmbedder({})
    const result = await generateQuestion(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [],
      accepted: [],
    })
    expect(result.question).toBeNull()
    expect(result.rejected).toBe(false)
    expect(llm.generateRaw).not.toHaveBeenCalled()
  })

  it('carries the embedding back onto the accepted shape so the next call can compare', async () => {
    const llm = fakeLlm([validQuestion('Carry me')])
    const embedder = fakeEmbedder({ 'Carry me': new Float32Array([0.5, 0.5, 0]) })
    const result = await generateQuestion(llm, embedder, {
      language: 'en',
      theme: makeTheme(),
      groundingChunks: [makeChunk(1, 'X')],
      accepted: [],
    })
    expect(result.question?.stemEmbedding).toBeInstanceOf(Float32Array)
    expect(Array.from(result.question?.stemEmbedding ?? [])).toEqual([0.5, 0.5, 0])
  })
})

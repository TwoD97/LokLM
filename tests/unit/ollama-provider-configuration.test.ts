import { describe, expect, it } from 'vitest'
import { ollamaProviderAvailability } from '@main/services/providers/ollama/configuration'
import { DEFAULT_SETTINGS } from '@shared/settings'

const connection = { ...DEFAULT_SETTINGS.advanced.ollama, baseUrl: 'http://localhost:11434' }

describe('independent Ollama provider configuration', () => {
  it('allows remote chat without requiring embedding or optional reranking models', () => {
    expect(ollamaProviderAvailability({ ...connection, llmModel: 'qwen:4b' }, true)).toEqual({
      llm: true,
      embedder: false,
      reranker: false,
    })
  })

  it('allows embeddings or reranking independently of the chat model', () => {
    expect(
      ollamaProviderAvailability({ ...connection, embedderModel: 'qwen-embedding' }, true),
    ).toEqual({
      llm: false,
      embedder: true,
      reranker: false,
    })
    expect(ollamaProviderAvailability({ ...connection, rerankerModel: 'ranker' }, true)).toEqual({
      llm: false,
      embedder: false,
      reranker: true,
    })
  })

  it('keeps both connector permission and remote-host consent mandatory for every model', () => {
    const remote = {
      ...connection,
      baseUrl: 'https://models.example.test',
      llmModel: 'chat',
      embedderModel: 'embed',
      rerankerModel: 'rank',
    }
    const unavailable = { llm: false, embedder: false, reranker: false }
    expect(ollamaProviderAvailability(remote, true)).toEqual(unavailable)
    expect(ollamaProviderAvailability({ ...remote, allowRemoteOllama: true }, false)).toEqual(
      unavailable,
    )
    expect(ollamaProviderAvailability({ ...remote, allowRemoteOllama: true }, true)).toEqual({
      llm: true,
      embedder: true,
      reranker: true,
    })
  })

  it('treats blank model names and a missing connection as unconfigured', () => {
    expect(
      ollamaProviderAvailability(
        { ...connection, llmModel: ' ', embedderModel: '', rerankerModel: null },
        true,
      ),
    ).toEqual({
      llm: false,
      embedder: false,
      reranker: false,
    })
    expect(
      ollamaProviderAvailability(
        { ...connection, baseUrl: '', allowRemoteOllama: true, llmModel: 'chat' },
        true,
      ).llm,
    ).toBe(false)
  })
})

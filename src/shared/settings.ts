import type { LlmProfileChoice, LlmContextChoice } from './documents'

export type ProviderSource = 'bundled' | 'ollama'

export interface UserSettings {
  schemaVersion: 1
  basic: {
    language: 'de' | 'en'
    llmProfile: LlmProfileChoice
  }
  advanced: {
    llm: {
      source: ProviderSource
      contextChoice: LlmContextChoice
    }
    embedder: {
      source: ProviderSource
      placement: 'auto' | 'cpu' | 'gpu'
    }
    reranker: {
      source: ProviderSource
      placement: 'auto' | 'cpu' | 'gpu'
    }
    ollama: {
      baseUrl: string
      bearerToken: string | null
      llmModel: string | null
      embedderModel: string | null
      rerankerModel: string | null
      requestTimeoutMs: number
    }
  }
}

export const DEFAULT_SETTINGS: UserSettings = {
  schemaVersion: 1,
  basic: {
    language: 'de',
    llmProfile: 'auto',
  },
  advanced: {
    llm: { source: 'bundled', contextChoice: 'auto' },
    embedder: { source: 'bundled', placement: 'auto' },
    reranker: { source: 'bundled', placement: 'auto' },
    ollama: {
      baseUrl: 'http://localhost:11434',
      bearerToken: null,
      llmModel: null,
      embedderModel: null,
      rerankerModel: null,
      requestTimeoutMs: 60000,
    },
  },
}

export const SETTINGS_KEY = 'user.settings'
export const AVATAR_KEY = 'user.avatar'

import type { LlmProfileChoice, LlmContextChoice } from './documents'

export type ProviderSource = 'bundled' | 'ollama'

export interface UserSettings {
  schemaVersion: 1
  basic: {
    language: 'de' | 'en'
    llmProfile: LlmProfileChoice
    /** When true, the pipeline progress checklist (contextualize → retrieve →
     *  rerank → prefill) stays visible above the assistant bubble after the
     *  first token arrives. Default false — checklist collapses into a single
     *  "pipeline X ms" chip in the metrics row once tokens start streaming. */
    showPipelineSteps: boolean
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
      /** Loopback gate. Default false , the connector refuses non-loopback
       *  hosts. Flipped to true once via the PasswordRetypeGate in
       *  OllamaSection ; that confirmation acknowledges the Lastenheft
       *  offline-grundsatz being relaxed (data leaves this machine). */
      allowRemoteOllama: boolean
    }
  }
}

export const DEFAULT_SETTINGS: UserSettings = {
  schemaVersion: 1,
  basic: {
    language: 'de',
    llmProfile: 'auto',
    showPipelineSteps: false,
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
      allowRemoteOllama: false,
    },
  },
}

export const SETTINGS_KEY = 'user.settings'
export const AVATAR_KEY = 'user.avatar'

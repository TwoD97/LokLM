import type { LlmProfileChoice, LlmContextChoice } from './documents'

export type ProviderSource = 'bundled' | 'ollama'

export interface UserSettings {
  schemaVersion: 1
  basic: {
    /** UI / interface language — drives every translated string via useT.
     *  DE/EN only. Independent of `answerLanguage`. */
    language: 'de' | 'en'
    /** Answer language. 'auto' (default) replies in the language the user
     *  writes in (detected per-turn , mapped to the two supported answer
     *  languages DE/EN) ; 'de'/'en' force that language. Kept separate from
     *  `language` so the UI stays in the user's chosen locale while answers
     *  can follow the prompt. */
    answerLanguage: 'auto' | 'de' | 'en'
    llmProfile: LlmProfileChoice
    /** When true, the pipeline progress checklist (contextualize → retrieve →
     *  rerank → prefill) stays visible above the assistant bubble after the
     *  first token arrives. Default false — checklist collapses into a single
     *  "pipeline X ms" chip in the metrics row once tokens start streaming. */
    showPipelineSteps: boolean
    /** UI colour theme. 'system' follows the OS preference; 'light'/'dark'
     *  force it. Applied instantly in the renderer via
     *  document.documentElement.dataset.theme (see theme/useTheme.ts). */
    theme: 'system' | 'light' | 'dark'
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
      /** Master switch for the rerank stage. When false the cross-encoder is
       *  never warmed/loaded and retrieval falls back to the fused (RRF +
       *  heuristic) ordering , and the TitleBar hides the Reranker status dot.
       *  Defaults true here ; the 'lite' install tier overrides it to false in
       *  SettingsService (see getSettingsService in main/index.ts). */
      enabled: boolean
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
  /** AP-9 retrieval/indexing knobs. Persisted here so the settings table holds
   *  every AP-9 field; the UI controls + backend consumption land in a Partner
   *  ticket (chunker.ts DEFAULT, RetrievalService/QAService.adaptiveTopK). */
  retrieval: {
    chunkSize: number // 500–8000
    chunkOverlap: number // 0–500
    topK: number // 3–30
  }
  /** AP-9 runtime behaviour. Partner ticket wires the model lifecycle. */
  runtime: {
    conversationSwitch: 'unload' | 'keep'
  }
  /** AP-9 security. Partner ticket wires AuthService.setInactivityMs
   *  (autoLockMinutes * 60_000; 0 = never → timer disabled). */
  security: {
    autoLockMinutes: 5 | 15 | 60 | 0 // 0 = never
  }
}

export const DEFAULT_SETTINGS: UserSettings = {
  schemaVersion: 1,
  basic: {
    // English-first UI default ; users can switch to German.
    language: 'en',
    // Auto by default : reply in the language the user writes in ( DE/EN ).
    // Picking 'de'/'en' locks the answer language regardless of the prompt.
    answerLanguage: 'auto',
    llmProfile: 'auto',
    showPipelineSteps: false,
    theme: 'system',
  },
  advanced: {
    llm: { source: 'bundled', contextChoice: 'auto' },
    embedder: { source: 'bundled', placement: 'auto' },
    reranker: { enabled: true, source: 'bundled', placement: 'auto' },
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
  retrieval: { chunkSize: 2000, chunkOverlap: 200, topK: 10 },
  runtime: { conversationSwitch: 'keep' },
  security: { autoLockMinutes: 15 },
}

export const SETTINGS_KEY = 'user.settings'
export const AVATAR_KEY = 'user.avatar'

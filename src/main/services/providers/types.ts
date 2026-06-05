import type { RetrievalHit, ModelStatus } from '../../../shared/documents'
import type { AskOptions, ResponseLanguage } from '../llm/LlamaService'

export interface ProviderStatus {
  ready: boolean
  message: string | null
  identity: string // e.g. "bundled:qwen3-4b" | "ollama:qwen3:8b"
}

export interface LlmProvider {
  ask(question: string, hits: RetrievalHit[], opts: AskOptions): Promise<string>
  generateRaw(
    prompt: string,
    opts: {
      abortSignal?: AbortSignal | undefined
      maxTokens?: number | undefined
      /** Optional node-llama-cpp GbnfJsonSchema. When supplied AND the engine
       *  supports grammar (bundled), output is constrained to valid JSON.
       *  Providers that can't honour it (Ollama) ignore it and fall back to
       *  plain generation — semantic validation/retry remains the safety net. */
      jsonSchema?: object | undefined
      /** Disable the model's reasoning segment. Bundled maps this to
       *  budgets.thoughtTokens=0; providers that can't honour it ignore it. */
      noThink?: boolean | undefined
    },
  ): Promise<string>
  generateTitle(
    user: string,
    assistant: string,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<string | null>
  /** Live max context window in tokens, or 0 if unknown (callers fall back to
   *  FALLBACK_CONTEXT_TOKENS). */
  contextWindowTokens(): number
  isReady(): boolean
  getStatus(): ProviderStatus
  /** Hint for the LLM/QA layer — drives the chat header "via X" pill. */
  getModelStatus(): ModelStatus
  /** Set the answer language. Awaitable so a per-turn switch is guaranteed to
   *  land before the next ask() — the bundled worker holds the system prompt
   *  as session state, so ask() must not race ahead of the language change. */
  setLanguage(lang: ResponseLanguage): Promise<void>
}

export interface EmbedderProvider {
  embed(texts: string[]): Promise<Float32Array[]>
  dimension(): number
  identity(): string // "bundled:bge-m3" | "ollama:nomic-embed-text"
  isReady(): boolean
  ensureReady(): Promise<void>
}

export interface RerankerProvider {
  rerank(query: string, passages: string[]): Promise<number[]>
  isReady(): boolean
  ensureReady(): Promise<void>
}

export interface ProviderFallbackEvent {
  kind: 'llm' | 'reranker'
  reason: string
}

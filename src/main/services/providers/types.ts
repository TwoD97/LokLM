import type { RetrievalHit, ModelStatus } from '../../../shared/documents'
import type { AskOptions, ResponseLanguage } from '../llm/LlamaService'

export interface ProviderStatus {
  ready: boolean
  message: string | null
  identity: string // e.g. "bundled:qwen3-4b" | "ollama:qwen3:8b"
}

/** Options for a one-shot raw generation. `schema`/`pooled` are honoured by the
 *  bundled provider's quiz path; other providers ignore them (Ollama maps
 *  `schema` onto its `format` field and runs serially). */
export interface GenerateRawOptions {
  abortSignal?: AbortSignal
  maxTokens?: number
  /** Constrain output to a quiz JSON shape (bundled GBNF grammar). */
  schema?: 'theme' | 'question'
  /** Route through the parallel quiz-decode pool instead of the chat session. */
  pooled?: boolean
  /** Disable the model's reasoning segment. Bundled maps this to
   *  budgets.thoughtTokens=0; other providers may ignore it. */
  noThink?: boolean
}

export interface LlmProvider {
  ask(question: string, hits: RetrievalHit[], opts: AskOptions): Promise<string>
  generateRaw(prompt: string, opts: GenerateRawOptions): Promise<string>
  /** Warm a parallel decode pool for batched quiz generation; returns the
   *  number of concurrent slots available (1 = serial). Optional — providers
   *  without a pool (Ollama) omit it and callers treat that as a single slot. */
  ensureGenerationPool?(maxSlots: number, contextTokens: number): Promise<number>
  /** Release the pool's resources once a batch completes. */
  releaseGenerationPool?(): Promise<void>
  generateTitle(
    user: string,
    assistant: string,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<string | null>
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

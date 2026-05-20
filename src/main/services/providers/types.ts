import type { RetrievalHit, ModelStatus } from '../../../shared/documents'
import type { AskOptions } from '../llm/LlamaService'

export interface ProviderStatus {
  ready: boolean
  message: string | null
  identity: string // e.g. "bundled:qwen3-4b" | "ollama:qwen3:8b"
}

export interface LlmProvider {
  ask(question: string, hits: RetrievalHit[], opts: AskOptions): Promise<string>
  generateRaw(prompt: string, opts: { abortSignal?: AbortSignal }): Promise<string>
  generateTitle(
    user: string,
    assistant: string,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<string | null>
  isReady(): boolean
  getStatus(): ProviderStatus
  /** Hint for the LLM/QA layer — drives the chat header "via X" pill. */
  getModelStatus(): ModelStatus
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

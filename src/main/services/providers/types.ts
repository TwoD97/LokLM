import type { RetrievalHit, ModelStatus } from '../../../shared/documents'
import type { AskOptions, ResponseLanguage } from '../llm/LlamaService'
import type { IndexingJob, IndexingLease } from '../../../shared/modelActivity'

export interface ProviderStatus {
  ready: boolean
  message: string | null
  identity: string // e.g. "bundled:qwen3-4b" | "ollama:qwen3:8b"
}

export interface ProviderRequestOptions {
  abortSignal?: AbortSignal | undefined
}

export interface LlmProvider {
  ask(question: string, hits: RetrievalHit[], opts: AskOptions): Promise<string>
  /** Prepare chat only after retrieval has finished using the GPU. Returns the
   * actual context window for packing this turn; remote providers may omit it. */
  prepareContext?(opts?: { abortSignal?: AbortSignal }): Promise<number>
  generateRaw(
    prompt: string,
    opts: {
      abortSignal?: AbortSignal | undefined
      maxTokens?: number | undefined
      plannedContextTokens?: number | undefined
      /** Optional node-llama-cpp GbnfJsonSchema. Bundled uses a grammar; Ollama
       *  forwards it as the API format. Provider/model support can vary, and
       *  callers must still validate structure, references and meaning. */
      jsonSchema?: object | undefined
      /** Disable the model's reasoning segment. Bundled uses a zero thought
       *  budget; explicit values map to Ollama's model-dependent think option. */
      noThink?: boolean | undefined
      /** Per-call task instructions; does not change the chat's system prompt. */
      systemPrompt?: string | undefined
      temperature?: number | undefined
      requireComplete?: boolean | undefined
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
  /** True when the loaded model is running on CPU. Optional so test mocks and
   *  providers that can't tell (or are always GPU-class) don't have to
   *  implement it — callers read it as `llm.isCpuInference?.() ?? false` and
   *  treat unknown as not-CPU so a GPU run is never wrongly throttled. */
  isCpuInference?(): boolean
  isReady(): boolean
  getStatus(): ProviderStatus
  /** Hint for the LLM/QA layer — drives the chat header "via X" pill. */
  getModelStatus(): ModelStatus
  /** Set the answer language. Awaitable so a per-turn switch is guaranteed to
   *  land before the next ask() — the bundled worker holds the system prompt
   *  as session state, so ask() must not race ahead of the language change. */
  setLanguage(lang: ResponseLanguage): Promise<void>
  /** Codebase-workspace prompt mode (ADR-0006): appends the CODE section to the
   *  system prompt. Same per-turn await contract as setLanguage. Optional so
   *  test mocks don't have to implement it — callers use
   *  `llm.setCodebaseMode?.(on)` and unknown means document mode. */
  setCodebaseMode?(on: boolean): Promise<void>
}

export interface EmbedderProvider {
  /** Whether work can run without loading this model or evicting chat. Remote
   * providers may omit this local residency capability. */
  isResident?(): boolean
  beginIndexing?(job: Omit<IndexingJob, 'done' | 'total'>): Promise<IndexingLease>
  /** Small local batches keep indexing progress and cancellation responsive. */
  preferredBatchSize?(): number
  /** Embed PASSAGES/documents (raw — no instruction). Used at ingest/backfill. */
  embed(texts: string[], opts?: ProviderRequestOptions): Promise<Float32Array[]>
  /** Embed QUERIES with the model-appropriate query-side instruction (ADR-0006
   *  fix #1 — Qwen3 gets the Instruct/Query template, code vs document by
   *  `opts.codebase`; BGE-M3 gets none). Optional: callers fall back to embed()
   *  when a provider/mock omits it, preserving the legacy "query embedded like a
   *  passage" behaviour. */
  embedQuery?(
    texts: string[],
    opts?: ProviderRequestOptions & { codebase?: boolean },
  ): Promise<Float32Array[]>
  /** Optional opaque model-revision/task/query key for the opt-in session
   * query-vector cache. Providers without a reliable key bypass caching. */
  queryCacheKey?(query: string, opts?: { codebase?: boolean }): string | null
  dimension(): number
  identity(): string // "bundled:bge-m3" | "ollama:nomic-embed-text"
  isReady(): boolean
  ensureReady(): Promise<void>
}

export interface RerankerProvider {
  rerank(query: string, passages: string[], opts?: ProviderRequestOptions): Promise<number[]>
  isReady(): boolean
  ensureReady(): Promise<void>
}

export interface ProviderFallbackEvent {
  kind: 'llm' | 'reranker'
  reason: string
}

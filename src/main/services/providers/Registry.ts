import type {
  LlmProvider,
  EmbedderProvider,
  RerankerProvider,
  ProviderFallbackEvent,
  ProviderStatus,
} from './types'
import type { RetrievalHit, ModelStatus } from '../../../shared/documents'
import type { AskOptions, ResponseLanguage } from '../llm/LlamaService'

export type ProviderSource = 'bundled' | 'ollama'
type LlmPair = { bundled: LlmProvider; ollama: LlmProvider | null }
type EmbedderPair = { bundled: EmbedderProvider; ollama: EmbedderProvider | null }
type RerankerPair = { bundled: RerankerProvider; ollama: RerankerProvider | null }

interface FallbackError {
  kind?: string
}
function isFallbackable(err: unknown): boolean {
  const e = err as FallbackError
  return e?.kind === 'network' || e?.kind === 'timeout' || e?.kind === 'server'
}

interface RegistryDeps {
  llm: LlmPair
  embedder: EmbedderPair
  reranker: RerankerPair
  onFallback?: (ev: ProviderFallbackEvent) => void
}

export class ProviderRegistry {
  private llmSource: ProviderSource = 'bundled'
  private embedderSource: ProviderSource = 'bundled'
  private rerankerSource: ProviderSource = 'bundled'

  constructor(private readonly deps: RegistryDeps) {}

  setLlmSource(s: ProviderSource): void {
    this.llmSource = s
  }
  setEmbedderSource(s: ProviderSource): void {
    this.embedderSource = s
  }
  setRerankerSource(s: ProviderSource): void {
    this.rerankerSource = s
  }

  getLlmSource(): ProviderSource {
    return this.llmSource
  }
  getEmbedderSource(): ProviderSource {
    return this.embedderSource
  }
  getRerankerSource(): ProviderSource {
    return this.rerankerSource
  }

  /** Replace the live Ollama providers after a settings change rebuilds them. */
  replaceOllama(p: {
    llm: LlmProvider | null
    embedder: EmbedderProvider | null
    reranker: RerankerProvider | null
  }): void {
    this.deps.llm.ollama = p.llm
    this.deps.embedder.ollama = p.embedder
    this.deps.reranker.ollama = p.reranker
  }

  llm(): LlmProvider {
    return new RegistryLlmProvider(this.llmSource, this.deps)
  }

  embedder(): EmbedderProvider {
    if (this.embedderSource === 'ollama' && this.deps.embedder.ollama)
      return this.deps.embedder.ollama
    return this.deps.embedder.bundled
  }

  reranker(): RerankerProvider {
    return new RegistryRerankerProvider(this.rerankerSource, this.deps)
  }

  bundledLlm(): LlmProvider {
    return this.deps.llm.bundled
  }
  bundledEmbedder(): EmbedderProvider {
    return this.deps.embedder.bundled
  }
  bundledReranker(): RerankerProvider {
    return this.deps.reranker.bundled
  }

  /** Used by IPC handlers that need to probe a not-yet-active candidate provider. */
  candidateEmbedder(source: ProviderSource): EmbedderProvider | null {
    if (source === 'ollama') return this.deps.embedder.ollama
    return this.deps.embedder.bundled
  }
}

class RegistryLlmProvider implements LlmProvider {
  constructor(
    private readonly source: ProviderSource,
    private readonly deps: RegistryDeps,
  ) {}

  private active(): LlmProvider {
    if (this.source === 'ollama' && this.deps.llm.ollama) return this.deps.llm.ollama
    return this.deps.llm.bundled
  }

  async ask(q: string, hits: RetrievalHit[], opts: AskOptions): Promise<string> {
    const active = this.active()
    if (active === this.deps.llm.bundled) return active.ask(q, hits, opts)
    try {
      return await active.ask(q, hits, opts)
    } catch (err) {
      if (!isFallbackable(err)) throw err
      this.deps.onFallback?.({ kind: 'llm', reason: (err as Error).message })
      return this.deps.llm.bundled.ask(q, hits, opts)
    }
  }

  async generateRaw(
    p: string,
    opts: {
      abortSignal?: AbortSignal | undefined
      maxTokens?: number | undefined
      jsonSchema?: object | undefined
    },
  ): Promise<string> {
    const active = this.active()
    if (active === this.deps.llm.bundled) return active.generateRaw(p, opts)
    try {
      return await active.generateRaw(p, opts)
    } catch (err) {
      if (!isFallbackable(err)) throw err
      this.deps.onFallback?.({ kind: 'llm', reason: (err as Error).message })
      return this.deps.llm.bundled.generateRaw(p, opts)
    }
  }

  async generateTitle(
    u: string,
    a: string,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<string | null> {
    const active = this.active()
    if (active === this.deps.llm.bundled) return active.generateTitle(u, a, opts)
    try {
      return await active.generateTitle(u, a, opts)
    } catch (err) {
      if (!isFallbackable(err)) throw err
      this.deps.onFallback?.({ kind: 'llm', reason: (err as Error).message })
      return this.deps.llm.bundled.generateTitle(u, a, opts)
    }
  }

  async setLanguage(lang: ResponseLanguage): Promise<void> {
    // Set on both providers , not just the active one : ask() can fall back to
    // bundled mid-turn , and that fallback must answer in the same language.
    await this.deps.llm.bundled.setLanguage(lang)
    if (this.deps.llm.ollama) await this.deps.llm.ollama.setLanguage(lang)
  }

  contextWindowTokens(): number {
    // Report the active provider's live window. When Ollama is active this is 0
    // (callers fall back to FALLBACK_CONTEXT_TOKENS); on a mid-turn fallback to
    // bundled the budgeting was already computed for the active provider.
    return this.active().contextWindowTokens()
  }

  isReady(): boolean {
    return this.active().isReady()
  }
  getStatus(): ProviderStatus {
    return this.active().getStatus()
  }
  getModelStatus(): ModelStatus {
    return this.active().getModelStatus()
  }
}

class RegistryRerankerProvider implements RerankerProvider {
  constructor(
    private readonly source: ProviderSource,
    private readonly deps: RegistryDeps,
  ) {}

  private active(): RerankerProvider {
    if (this.source === 'ollama' && this.deps.reranker.ollama) return this.deps.reranker.ollama
    return this.deps.reranker.bundled
  }

  async rerank(q: string, passages: string[]): Promise<number[]> {
    const active = this.active()
    if (active === this.deps.reranker.bundled) return active.rerank(q, passages)
    try {
      return await active.rerank(q, passages)
    } catch (err) {
      if (!isFallbackable(err)) throw err
      // silent — reranking failures are invisible to the user
      return this.deps.reranker.bundled.rerank(q, passages)
    }
  }

  isReady(): boolean {
    return this.active().isReady()
  }
  async ensureReady(): Promise<void> {
    return this.active().ensureReady()
  }
}

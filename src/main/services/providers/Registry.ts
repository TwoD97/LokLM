import type {
  LlmProvider,
  EmbedderProvider,
  RerankerProvider,
  ProviderFallbackEvent,
  ProviderStatus,
  ProviderRequestOptions,
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
  /** Routing state changed, independently of native model residency pushes. */
  onLlmStatusChanged?: () => void
}

/** Status describes the latest admitted external operation. Old completions
 * must not overwrite a newer fallback or a changed provider configuration. */
class LlmFallbackState {
  private sequence = 0
  private configuration = 0
  private enabled = false
  private value: ModelStatus['fallback'] = { active: false, reason: null }

  constructor(private readonly onChanged: () => void) {}

  currentConfiguration(): number {
    return this.configuration
  }

  snapshot(configuration = this.configuration): ModelStatus['fallback'] {
    return configuration === this.configuration
      ? { ...this.value }
      : { active: false, reason: null }
  }

  reset(enabled: boolean, notify = true): void {
    this.sequence++
    this.configuration++
    this.enabled = enabled
    const changed = this.value.active
    this.value = { active: false, reason: null }
    if (changed && notify) this.onChanged()
  }

  begin(configuration: number): number | null {
    return this.enabled && configuration === this.configuration ? ++this.sequence : null
  }

  settle(sequence: number | null, reason: string | null): boolean {
    if (sequence === null || sequence !== this.sequence || !this.enabled) return false
    const next = { active: reason !== null, reason }
    const changed = next.active !== this.value.active || next.reason !== this.value.reason
    this.value = next
    if (changed) this.onChanged()
    return true
  }
}

/** A registry belongs to one unlocked vault session and can never be revived. */
class ProviderSession {
  active = true
  private readonly controller = new AbortController()

  retire(): void {
    this.active = false
    this.controller.abort()
  }

  assertActive(signal?: AbortSignal): void {
    if (!this.active || signal?.aborted) {
      throw Object.assign(new Error('Provider session closed or request cancelled'), {
        name: 'AbortError',
      })
    }
  }

  async run<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertActive(signal)
    const combined = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal
    try {
      const result = await operation(combined)
      this.assertActive(combined)
      return result
    } catch (error) {
      this.assertActive(combined)
      throw error
    }
  }
}

export class ProviderRegistry {
  private readonly session = new ProviderSession()
  // Retrieval's query-vector cache keys by provider object identity. Repeated
  // lookups must retain the same guarded wrapper while a provider is unchanged.
  private readonly embedders = new WeakMap<EmbedderProvider, EmbedderProvider>()
  private llmSource: ProviderSource = 'bundled'
  private embedderSource: ProviderSource = 'bundled'
  private rerankerSource: ProviderSource = 'bundled'
  private readonly llmFallback: LlmFallbackState

  constructor(private readonly deps: RegistryDeps) {
    this.llmFallback = new LlmFallbackState(() => deps.onLlmStatusChanged?.())
  }

  invalidateSession(): void {
    this.session.retire()
    this.llmFallback.reset(false, false)
  }

  setLlmSource(s: ProviderSource): void {
    this.session.assertActive()
    if (this.llmSource !== s) {
      this.llmSource = s
      this.llmFallback.reset(s === 'ollama')
    }
  }
  setEmbedderSource(s: ProviderSource): void {
    this.session.assertActive()
    this.embedderSource = s
  }
  setRerankerSource(s: ProviderSource): void {
    this.session.assertActive()
    this.rerankerSource = s
  }

  getLlmSource(): ProviderSource {
    return this.llmSource
  }
  getLlmFallback(): ModelStatus['fallback'] {
    return this.llmFallback.snapshot()
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
    this.session.assertActive()
    const llmChanged = this.deps.llm.ollama !== p.llm
    this.deps.llm.ollama = p.llm
    this.deps.embedder.ollama = p.embedder
    this.deps.reranker.ollama = p.reranker
    if (llmChanged) this.llmFallback.reset(this.llmSource === 'ollama')
  }

  llm(): LlmProvider {
    return new RegistryLlmProvider(this.llmSource, this.deps, this.session, this.llmFallback)
  }

  embedder(): EmbedderProvider {
    if (this.embedderSource === 'ollama' && this.deps.embedder.ollama)
      return this.guardEmbedder(this.deps.embedder.ollama)
    return this.guardEmbedder(this.deps.embedder.bundled)
  }

  reranker(): RerankerProvider {
    return new RegistryRerankerProvider(this.rerankerSource, this.deps, this.session)
  }

  bundledLlm(): LlmProvider {
    return new RegistryLlmProvider('bundled', this.deps, this.session, this.llmFallback)
  }
  bundledEmbedder(): EmbedderProvider {
    return this.guardEmbedder(this.deps.embedder.bundled)
  }
  bundledReranker(): RerankerProvider {
    return new RegistryRerankerProvider('bundled', this.deps, this.session)
  }

  /** Used by IPC handlers that need to probe a not-yet-active candidate provider. */
  candidateEmbedder(source: ProviderSource): EmbedderProvider | null {
    const provider = source === 'ollama' ? this.deps.embedder.ollama : this.deps.embedder.bundled
    return provider ? this.guardEmbedder(provider) : null
  }

  private guardEmbedder(provider: EmbedderProvider): EmbedderProvider {
    const existing = this.embedders.get(provider)
    if (existing) return existing
    const session = this.session
    const guarded: EmbedderProvider = {
      embed: (texts, opts) =>
        session.run((abortSignal) => provider.embed(texts, { abortSignal }), opts?.abortSignal),
      ensureReady: () => session.run(() => provider.ensureReady()),
      isReady: () => session.active && provider.isReady(),
      dimension: () => {
        session.assertActive()
        return provider.dimension()
      },
      identity: () => {
        session.assertActive()
        return provider.identity()
      },
    }
    if (provider.embedQuery) {
      guarded.embedQuery = (texts, opts) =>
        session.run(
          (abortSignal) => provider.embedQuery!(texts, { ...opts, abortSignal }),
          opts?.abortSignal,
        )
    }
    if (provider.isResident) {
      guarded.isResident = () => session.active && provider.isResident!()
    }
    if (provider.queryCacheKey) {
      guarded.queryCacheKey = (query, opts) =>
        session.active ? provider.queryCacheKey!(query, opts) : null
    }
    if (provider.preferredBatchSize) {
      guarded.preferredBatchSize = () => {
        session.assertActive()
        return provider.preferredBatchSize!()
      }
    }
    if (provider.beginIndexing) {
      guarded.beginIndexing = async (job) => {
        session.assertActive()
        const lease = await provider.beginIndexing!(job)
        if (!session.active) {
          lease.release()
          session.assertActive()
        }
        return {
          update: (done, total) => {
            if (session.active) lease.update(done, total)
          },
          // Cleanup remains legal after retirement.
          release: () => lease.release(),
        }
      }
    }
    this.embedders.set(provider, guarded)
    return guarded
  }
}

class RegistryLlmProvider implements LlmProvider {
  private readonly selected: LlmProvider
  private readonly bundled: LlmProvider
  private readonly remote: LlmProvider | null
  private readonly fallbackConfiguration: number

  constructor(
    private readonly source: ProviderSource,
    private readonly deps: RegistryDeps,
    private readonly session: ProviderSession,
    private readonly fallback: LlmFallbackState,
  ) {
    // A QA turn retains this wrapper from context preparation through ask.
    // Settings may replace the registry's providers meanwhile; that must not
    // change this turn's model, language target, or advertised capacity.
    this.bundled = deps.llm.bundled
    this.remote = deps.llm.ollama
    this.selected = source === 'ollama' && this.remote ? this.remote : this.bundled
    this.fallbackConfiguration = fallback.currentConfiguration()
  }

  private active(): LlmProvider {
    return this.selected
  }

  prepareContext(opts?: { abortSignal?: AbortSignal }): Promise<number> {
    return this.session.run(async (abortSignal) => {
      const provider = this.active()
      return provider.prepareContext
        ? provider.prepareContext({ abortSignal })
        : provider.contextWindowTokens()
    }, opts?.abortSignal)
  }

  async ask(q: string, hits: RetrievalHit[], opts: AskOptions): Promise<string> {
    const guardedOpts: AskOptions = {
      ...opts,
      ...(opts.onChunk && {
        onChunk: (text: string, count: number) => {
          if (this.session.active && !opts.abortSignal?.aborted) opts.onChunk!(text, count)
        },
      }),
    }
    return this.withFallback(
      (provider, abortSignal) => provider.ask(q, hits, { ...guardedOpts, abortSignal }),
      opts.abortSignal,
    )
  }

  async generateRaw(
    p: string,
    opts: {
      abortSignal?: AbortSignal | undefined
      maxTokens?: number | undefined
      plannedContextTokens?: number | undefined
      jsonSchema?: object | undefined
      noThink?: boolean | undefined
      maxBoundedThoughtTokens?: 64 | 128 | 192 | undefined
      /** Explicit per-call opt-out; omission preserves the provider default. */
      repeatPenalty?: false | undefined
      systemPrompt?: string | undefined
      temperature?: number | undefined
      requireComplete?: boolean | undefined
    },
  ): Promise<string> {
    return this.withFallback(
      (provider, abortSignal) => provider.generateRaw(p, { ...opts, abortSignal }),
      opts.abortSignal,
    )
  }

  async generateTitle(
    u: string,
    a: string,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<string | null> {
    return this.withFallback(
      (provider, abortSignal) => provider.generateTitle(u, a, { ...opts, abortSignal }),
      opts?.abortSignal,
    )
  }

  private withFallback<T>(
    operation: (provider: LlmProvider, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.session.run(async (abortSignal) => {
      const active = this.active()
      const attempt =
        active === this.remote && this.source === 'ollama'
          ? this.fallback.begin(this.fallbackConfiguration)
          : null
      try {
        const result = await operation(active, abortSignal)
        this.session.assertActive(signal)
        // Title providers may swallow connection errors into a null title;
        // that optional result does not establish that the remote recovered.
        if (result !== null) this.fallback.settle(attempt, null)
        return result
      } catch (err) {
        this.session.assertActive(signal)
        if (active === this.bundled || !isFallbackable(err)) throw err
        const reason = err instanceof Error ? err.message : String(err)
        if (this.fallback.settle(attempt, reason)) this.deps.onFallback?.({ kind: 'llm', reason })
        this.session.assertActive(signal)
        return operation(this.bundled, abortSignal)
      }
    }, signal)
  }

  async setLanguage(lang: ResponseLanguage): Promise<void> {
    // Set on both providers , not just the active one : ask() can fall back to
    // bundled mid-turn , and that fallback must answer in the same language.
    await this.session.run(() => this.bundled.setLanguage(lang))
    if (this.remote) await this.session.run(() => this.remote!.setLanguage(lang))
  }

  async setCodebaseMode(on: boolean): Promise<void> {
    // Same both-providers contract as setLanguage — a mid-turn fallback to
    // bundled must keep the CODE prompt section of the codebase workspace.
    await this.session.run(async () => {
      await this.bundled.setCodebaseMode?.(on)
    })
    if (this.remote)
      await this.session.run(async () => {
        await this.remote!.setCodebaseMode?.(on)
      })
  }

  contextWindowTokens(): number {
    // Report the captured provider's window (Ollama's configured request size
    // or the bundled model's live context). Bundled fallback revalidates its
    // actual capacity before generation; a retired session reports no window.
    return this.session.active ? this.active().contextWindowTokens() : 0
  }

  isCpuInference(): boolean {
    return this.session.active && (this.active().isCpuInference?.() ?? false)
  }

  isReady(): boolean {
    return this.session.active && this.active().isReady()
  }
  getStatus(): ProviderStatus {
    const status = this.active().getStatus()
    return this.session.active ? status : { ...status, ready: false, message: 'Session closed' }
  }
  getModelStatus(): ModelStatus {
    const fallback =
      this.source === 'ollama'
        ? this.fallback.snapshot(this.fallbackConfiguration)
        : { active: false, reason: null }
    const status = (fallback.active ? this.bundled : this.active()).getModelStatus()
    return this.session.active
      ? { ...status, source: this.source, fallback }
      : {
          ...status,
          state: 'unloaded',
          resident: false,
          loadProgress: null,
          message: 'Session closed',
        }
  }
}

class RegistryRerankerProvider implements RerankerProvider {
  private readonly selected: RerankerProvider
  private readonly bundled: RerankerProvider

  constructor(
    source: ProviderSource,
    deps: RegistryDeps,
    private readonly session: ProviderSession,
  ) {
    this.bundled = deps.reranker.bundled
    this.selected =
      source === 'ollama' && deps.reranker.ollama ? deps.reranker.ollama : this.bundled
  }

  private active(): RerankerProvider {
    return this.selected
  }

  async rerank(q: string, passages: string[], opts?: ProviderRequestOptions): Promise<number[]> {
    return this.session.run(async (abortSignal) => {
      const active = this.active()
      try {
        return await active.rerank(q, passages, { abortSignal })
      } catch (err) {
        this.session.assertActive(abortSignal)
        if (active === this.bundled || !isFallbackable(err)) throw err
        // Silent — reranking failures are invisible to the user.
        return this.bundled.rerank(q, passages, { abortSignal })
      }
    }, opts?.abortSignal)
  }

  isReady(): boolean {
    return this.session.active && this.active().isReady()
  }
  async ensureReady(): Promise<void> {
    return this.session.run(() => this.active().ensureReady())
  }
}

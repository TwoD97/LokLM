import { totalmem } from 'node:os'
import {
  ResourcePlanner,
  ggufWeightBytes,
  type LlmPlan,
  type SystemResources,
} from '../embeddings/ResourcePlanner'
import { getModelSearchDirs, listVisibleGgufs, resolveModelFile } from '../models/paths'
import { readTierMarker, type Tier } from '../tier/TierMarker'
import type { ModelsWorkerClient } from '../workers/ModelsWorkerClient'

// Single source of truth in src/shared/documents.ts so renderer + preload + service agree.
import type {
  ModelState,
  ModelStatus,
  SystemInfo,
  LlmProfileName,
  LlmProfileChoice,
  AvailableProfile,
  LlmContextChoice,
} from '../../../shared/documents'
export type {
  ModelState,
  ModelStatus,
  SystemInfo,
  LlmProfileName,
  LlmProfileChoice,
  AvailableProfile,
  LlmContextChoice,
}

import type { RetrievalHit } from '../../../shared/documents'

import {
  buildPrompt,
  buildSystemPrompt,
  renderFallback,
  ThinkFilter,
  LoopDetector,
  REPETITION_HINT_TEXT,
  stripThink,
  chunkifyForStream,
  answerMaxTokens,
  type ResponseLanguage,
} from './prompt'
export type { ResponseLanguage }

// Heavy GGUF work runs in the modelsWorker utility process , this service is
// a thin facade. Tests that previously did `new LlamaService()` and called
// loadModel in-process will now throw on those calls until they're updated to
// inject a worker-backed bridge.

export interface AskOptions {
  /** Called for each batched token push. `count` is the number of native
   *  llama.cpp chunks coalesced into this push — at most ~8 ms worth. Most
   *  callers can ignore it and just append `text`; the renderer uses it to
   *  keep its tokens/sec metric accurate post-batching. */
  onChunk?: (text: string, count: number) => void
  abortSignal?: AbortSignal
  /**
   * Optional tools the model may call during generation. Worker-mode does not
   * route tool calls back to main yet , callers passing tools will see them
   * silently dropped. QAService does not pass tools today.
   */
  tools?: Record<string, unknown>
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  historyQuestion?: string
}

export interface LlmProfile {
  name: LlmProfileName
  displayName: string
  filenamePatterns: RegExp[]
  contextSize: number
  minTotalMemGB: number
}

// Profile ↔ on-disk-GGUF binding. v0.2.7 added the Qwen3.5 tier lineup the
// wizard now installs ( lite=Qwen3.5-2B , standard=Qwen3.5-4B , pro=Qwen3.5-9B ) ;
// patterns are ordered most-specific-first so a Qwen3.5-9B never accidentally
// matches the bare /qwen3.*9b/ -style fallbacks. The older Qwen3 / Qwen2.5 /
// Llama / Nemotron patterns stay so v0.2.6 installs + side-loaded GGUFs keep
// resolving. Mapping by model size : 2B→lite , 4B→full , 9B→xl.
export const LLM_PROFILES: LlmProfile[] = [
  {
    name: 'lite',
    displayName: 'Lite — Qwen3.5 2B (8 GB target)',
    filenamePatterns: [
      /qwen3\.5.*[-_]?2b/i,
      /qwen3.*[-_]?4b/i,
      /qwen2\.5.*[-_]?3b/i,
      /llama.*3\.2.*[-_]?3b/i,
    ],
    contextSize: 32768,
    minTotalMemGB: 8,
  },
  {
    name: 'full',
    displayName: 'Full — Qwen3.5 4B (16 GB+ target)',
    filenamePatterns: [/qwen3\.5.*[-_]?4b/i, /qwen3.*[-_]?8b/i, /qwen2\.5.*[-_]?7b/i],
    contextSize: 131072,
    minTotalMemGB: 16,
  },
  {
    name: 'xl',
    displayName: 'XL — Qwen3.5 9B (high-end GPU, 32 GB+ RAM)',
    filenamePatterns: [
      /qwen3\.5.*[-_]?9b/i,
      /nemotron.*3.*nano.*30b/i,
      /nemotron.*nano.*30b/i,
      /qwen3.*[-_]?30b.*a3b/i,
      /qwen3.*[-_]?32b/i,
      /qwen2\.5.*[-_]?32b/i,
      /nemotron.*super.*49b/i,
      /llama.*3\.3.*70b/i,
    ],
    contextSize: 262144,
    minTotalMemGB: 32,
  },
]

export function totalMemGB(): number {
  return totalmem() / (1024 * 1024 * 1024)
}

// Wizard tier ( install-time user choice ) → LLM profile. The tiers and
// profiles are separate vocabularies that happen to line up by model size :
//   lite     ( Qwen3.5-2B )  → lite  profile
//   standard ( Qwen3.5-4B )  → full  profile
//   pro      ( Qwen3.5-9B )  → xl    profile
const TIER_TO_PROFILE: Record<Tier, LlmProfileName> = {
  lite: 'lite',
  standard: 'full',
  pro: 'xl',
}

/**
 * The profile the user implicitly chose by picking a tier in the installer
 * wizard. This is AUTHORITATIVE over the RAM heuristic — if someone with
 * 31.9 GB RAM deliberately picked Pro , we honour that instead of letting
 * the `minTotalMemGB: 32` threshold silently demote them to Full. Returns
 * null for v0.2.6 installs / dev ( no marker ) so callers fall back to the
 * hardware heuristic.
 */
export function tierMarkerProfile(): LlmProfileName | null {
  const marker = readTierMarker()
  if (!marker) return null
  return TIER_TO_PROFILE[marker.tier] ?? null
}

export function recommendedProfile(): LlmProfileName {
  const fromTier = tierMarkerProfile()
  if (fromTier) return fromTier
  const gb = totalMemGB()
  const sorted = [...LLM_PROFILES].sort((a, b) => b.minTotalMemGB - a.minTotalMemGB)
  for (const p of sorted) {
    if (gb >= p.minTotalMemGB) return p.name
  }
  return sorted[sorted.length - 1]!.name
}

export function discoverProfiles(): AvailableProfile[] {
  const ggufs = listVisibleGgufs().map((g) => g.name)
  return LLM_PROFILES.map((p) => {
    const match = ggufs.find((f) => p.filenamePatterns.some((re) => re.test(f)))
    return {
      name: p.name,
      displayName: profileDisplayName(p, match ?? null),
      filename: match ?? null,
      contextSize: p.contextSize,
      minTotalMemGB: p.minTotalMemGB,
    }
  })
}

function profileDisplayName(profile: LlmProfile, filename: string | null): string {
  if (!filename) return profile.displayName
  const variant = variantLabel(profile.name, filename)
  if (profile.name === 'lite') return `Lite — ${variant} (8 GB target)`
  if (profile.name === 'full') return `Full — ${variant} (16 GB+ target)`
  return `XL — ${variant} (high-end GPU, 32 GB+ RAM)`
}

function variantLabel(name: LlmProfileName, filename: string): string {
  const f = filename.toLowerCase()
  // Qwen3.5 ( v0.2.7 tier lineup ) checked first so it doesn't fall through
  // to the looser Qwen3 labels below.
  if (/qwen3\.5.*2b/.test(f)) return 'Qwen3.5 2B'
  if (/qwen3\.5.*4b/.test(f)) return 'Qwen3.5 4B'
  if (/qwen3\.5.*9b/.test(f)) return 'Qwen3.5 9B'
  if (name === 'lite') {
    if (/qwen3.*4b/.test(f)) return 'Qwen3 4B'
    if (/qwen2\.5.*3b/.test(f)) return 'Qwen2.5 3B'
    if (/llama.*3\.2.*3b/.test(f)) return 'Llama 3.2 3B'
  }
  if (name === 'full') {
    if (/qwen3.*8b/.test(f)) return 'Qwen3 8B'
    if (/qwen2\.5.*7b/.test(f)) return 'Qwen2.5 7B'
  }
  if (name === 'xl') {
    if (/nemotron.*nano.*30b/.test(f)) return 'Nemotron 3 Nano 30B-A3B'
    if (/qwen3.*30b.*a3b/.test(f)) return 'Qwen3 30B-A3B'
    if (/qwen3.*32b/.test(f)) return 'Qwen3 32B'
    if (/qwen2\.5.*32b/.test(f)) return 'Qwen2.5 32B'
    if (/nemotron.*super.*49b/.test(f)) return 'Nemotron Super 49B'
    if (/llama.*3\.3.*70b/.test(f)) return 'Llama 3.3 70B'
  }
  return filename.replace(/\.gguf$/i, '')
}

function profileByName(name: LlmProfileName): LlmProfile {
  const p = LLM_PROFILES.find((x) => x.name === name)
  if (!p) throw new Error(`Unknown LLM profile: ${name}`)
  return p
}

export class LlamaService {
  private gpuLabel: string | null = null
  private selectedChoice: LlmProfileChoice = 'auto'
  private selectedContext: LlmContextChoice = 'auto'
  // English-first default ( matches DEFAULT_SETTINGS.basic.language ) ; the
  // real value is pushed from settings on startup + on every change.
  private language: ResponseLanguage = 'en'
  private lastResources: SystemResources | null = null
  private lastPlan: LlmPlan | null = null
  private status: ModelStatus = {
    state: 'idle',
    modelPath: null,
    modelName: null,
    gpu: null,
    loadProgress: null,
    message: null,
    profile: null,
    // LlamaService is always the bundled engine — `source` is fixed; the
    // broadcaster in main/index.ts overlays the live `source` from the
    // ProviderRegistry so an active Ollama session reports 'ollama' instead.
    source: 'bundled',
    fallback: { active: false, reason: null },
  }
  private listeners: Array<(s: ModelStatus) => void> = []
  private loadPromise: Promise<void> | null = null
  private lastUsedAt: number = Date.now()
  private idleMs: number = parseIdleMs(process.env['LOKLM_LLM_IDLE_MS']) ?? 30 * 60 * 1000
  private idleTimer: NodeJS.Timeout | null = null
  private planner: ResourcePlanner
  private client: ModelsWorkerClient | null

  constructor(opts: { planner?: ResourcePlanner; client?: ModelsWorkerClient } = {}) {
    this.planner = opts.planner ?? new ResourcePlanner()
    this.client = opts.client ?? null
    if (this.client) {
      this.client.setStatusListener('llm', (patch) => {
        this.setStatus(patch as Partial<ModelStatus>)
      })
    }
  }

  // ---- status / introspection ------------------------------------------------

  subscribe(cb: (s: ModelStatus) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  private setStatus(patch: Partial<ModelStatus>): void {
    let changed = false
    for (const k of Object.keys(patch) as Array<keyof ModelStatus>) {
      if (this.status[k] !== patch[k]) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.status = { ...this.status, ...patch }
    for (const l of this.listeners) {
      try {
        l(this.status)
      } catch {
        /* ignore listener errors */
      }
    }
  }

  getStatus(): ModelStatus {
    return this.status
  }

  systemInfo(): SystemInfo {
    const profiles = discoverProfiles()
    const recommended = this.recommendedProfileFromCache(profiles)
    const resolved = this.resolveSelectedPath(profiles, recommended)
    return {
      ...this.status,
      bundledModelPath: resolved ?? getModelSearchDirs()[0]!,
      bundledModelExists: resolved !== null,
      totalMemGB: Math.round(totalMemGB() * 10) / 10,
      recommendedProfile: recommended,
      selectedProfile: this.selectedChoice,
      profiles,
      resources: this.lastResources,
      lastLlmPlan: this.lastPlan,
      selectedContext: this.selectedContext,
    }
  }

  isReady(): boolean {
    return this.status.state === 'ready'
  }

  setSelectedProfile(choice: LlmProfileChoice): void {
    this.selectedChoice = choice
  }

  setSelectedContext(choice: LlmContextChoice): void {
    this.selectedContext = choice
  }

  async setLanguage(lang: ResponseLanguage): Promise<void> {
    if (this.language === lang) return
    this.language = lang
    // Worker patches its session's system prompt without paying a reload.
    // Awaited so a per-turn switch (QAService , Auto mode) lands before the
    // next llmAsk — the worker holds the system prompt as session state.
    if (this.client && this.isReady()) {
      try {
        await this.client.llmSetLanguage(lang, buildSystemPrompt(lang))
      } catch {
        /* worker status push already reflects reality */
      }
    }
  }

  getLanguage(): ResponseLanguage {
    return this.language
  }

  /** Live max context window in tokens from the last successful load plan, or
   *  0 if no model is loaded (callers fall back to FALLBACK_CONTEXT_TOKENS). */
  contextWindowTokens(): number {
    return this.lastPlan?.contextSize ?? 0
  }

  /** True only when the loaded backend is CPU. The worker sets gpuLabel to
   *  'cpu' when getLlama({ gpu: false }) won — any GPU label (or unknown/null
   *  before a load) is treated as not-CPU so we never wrongly throttle a GPU. */
  isCpuInference(): boolean {
    return this.gpuLabel === 'cpu'
  }

  getPlanner(): ResourcePlanner {
    return this.planner
  }

  private recommendedProfileFromCache(profiles: AvailableProfile[]): LlmProfileName {
    // CPU override comes first: a heavy model on CPU is multi-minutes per
    // inference call ( ~80s prefill + ~100s decode for an 8B at 5 tok/s ),
    // which makes the app effectively unusable. If we already know there's
    // no GPU and lite is on disk, recommend lite ahead of any tier marker
    // so the settings UI and autoLoad converge on the same answer.
    const res = this.lastResources
    if (res && !res.hasGpu) {
      const liteAvailable = profiles.find((x) => x.name === 'lite')?.filename != null
      if (liteAvailable) return 'lite'
    }
    // Install-time tier wins — but only if its profile actually has a GGUF
    // on disk ( guards against a marker pointing at a tier whose download
    // failed ; then we fall through to the hardware heuristic ).
    const fromTier = tierMarkerProfile()
    if (fromTier) {
      const d = profiles.find((x) => x.name === fromTier)
      if (d?.filename) return fromTier
    }
    if (!res) return recommendedProfile()
    const enriched = LLM_PROFILES.map((p) => {
      const d = profiles.find((x) => x.name === p.name)
      const path = d?.filename ? resolveModelFile(d.filename) : null
      return {
        name: p.name,
        minTotalMemGB: p.minTotalMemGB,
        weightsBytes: path ? ggufWeightBytes(path) : 0,
      }
    })
    const picked = this.planner.pickProfile(enriched, res)
    return (picked?.name as LlmProfileName | undefined) ?? recommendedProfile()
  }

  // ---- lifecycle -------------------------------------------------------------

  /**
   * Lazy load: no-op when already loaded, otherwise runs autoLoad. Concurrent
   * callers share the same in-flight load — second-and-later callers get the
   * same promise back rather than triggering an unload/reload race.
   *
   * Used by BundledLlmProvider so the local model spins up on-demand on the
   * first fallback request when the user has external Ollama as their source.
   */
  async ensureLoaded(): Promise<void> {
    if (this.isReady()) return
    if (this.loadPromise) return this.loadPromise
    return this.autoLoad()
  }

  async autoLoad(): Promise<void> {
    const profiles = discoverProfiles()
    // Refreshed snapshot — used to be a RAM-only snapshot() to avoid the
    // GPU-probe cost on main , but profile selection now uses hasGpu to
    // override heavy tiers on CPU-only machines ( an 8B on CPU is multi-
    // minutes per call , effectively unusable ) , so the ~100-500ms probe
    // is worth it. The result is cached on the planner so subsequent
    // callers don't re-probe.
    const snapshot = await this.planner.refreshIfStale(60_000)
    this.lastResources = snapshot

    let preferredName: LlmProfileName
    if (this.selectedChoice === 'auto') {
      const enriched = LLM_PROFILES.map((p) => {
        const d = profiles.find((x) => x.name === p.name)
        const path = d?.filename ? resolveModelFile(d.filename) : null
        return {
          name: p.name,
          minTotalMemGB: p.minTotalMemGB,
          weightsBytes: path ? ggufWeightBytes(path) : 0,
        }
      })
      const picked = this.planner.pickProfile(enriched, snapshot)
      preferredName = (picked?.name as LlmProfileName | undefined) ?? recommendedProfile()
    } else {
      preferredName = this.selectedChoice
    }

    // CPU downgrade: regardless of how we got `preferredName` ( auto-pick OR
    // explicit user choice OR install-time tier marker ) , if there's no GPU
    // and lite is available , force lite. Reasoning: a Full / XL tier was
    // chosen for hardware the user no longer has — running it on CPU is
    // multi-minutes per call. The user can switch back via settings once
    // they're on a GPU machine again.
    if (!snapshot.hasGpu && preferredName !== 'lite') {
      const liteAvailable = profiles.find((x) => x.name === 'lite')?.filename != null
      if (liteAvailable) {
        // eslint-disable-next-line no-console
        console.warn(
          `[llm] no GPU detected — auto-downgrading from '${preferredName}' to 'lite' for usability`,
        )
        preferredName = 'lite'
      }
    }

    const path = this.resolveSelectedPath(profiles, preferredName)
    if (!path) {
      this.setStatus({
        state: 'failed',
        modelPath: null,
        modelName: null,
        profile: null,
        message: `No LLM GGUF found in ${getModelSearchDirs()[0]}. Drop a Qwen3-4B or Qwen3-8B .gguf there.`,
      })
      return
    }
    const profile = profiles.find((p) => p.filename && path.endsWith(p.filename))
    await this.loadModel(path, profile?.name ?? preferredName)
  }

  private resolveSelectedPath(
    profiles: AvailableProfile[],
    preferred: LlmProfileName,
  ): string | null {
    const order = [preferred, ...profiles.filter((p) => p.name !== preferred).map((p) => p.name)]
    for (const name of order) {
      const p = profiles.find((x) => x.name === name)
      if (p && p.filename) {
        const abs = resolveModelFile(p.filename)
        if (abs) return abs
      }
    }
    return null
  }

  async loadModel(modelPath: string, profileName?: LlmProfileName): Promise<void> {
    if (!this.client) {
      throw new Error(
        'LlamaService.loadModel requires a ModelsWorkerClient (in-process loads are gone).',
      )
    }
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.performLoad(modelPath, profileName).finally(() => {
      this.loadPromise = null
    })
    return this.loadPromise
  }

  private async performLoad(modelPath: string, profileName?: LlmProfileName): Promise<void> {
    const profile = profileName ? profileByName(profileName) : null
    const envOverride = parsePositiveInt(process.env['LOKLM_LLM_CONTEXT_SIZE'])
    try {
      const result = await this.client!.llmLoad({
        modelPath,
        profileName: profile?.name ?? null,
        profileDefaultContext: profile?.contextSize ?? 32768,
        weightsBytes: ggufWeightBytes(modelPath),
        userContextChoice: this.selectedContext,
        language: this.language,
        envContextOverride: envOverride,
        systemPrompt: buildSystemPrompt(this.language),
      })
      this.lastPlan = result.plan
      this.lastResources = result.resources
      this.gpuLabel = result.gpuLabel
      this.lastUsedAt = Date.now()
      this.startIdleTimer()
    } catch (err) {
      // Worker already pushed a failed status; record + bubble.
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus({ state: 'failed', loadProgress: null, message: msg })
      throw err
    }
  }

  async unload(): Promise<void> {
    this.stopIdleTimer()
    if (this.client) {
      try {
        await this.client.llmUnload()
      } catch {
        /* worker status push already reflects reality */
      }
    }
  }

  // ---- inference -------------------------------------------------------------

  async ask(question: string, hits: RetrievalHit[], opts: AskOptions = {}): Promise<string> {
    this.touchUsage()
    if (this.isReady() && this.client) {
      try {
        return await this.askWithModel(question, hits, opts)
      } finally {
        this.touchUsage()
      }
    }
    return this.askFallback(question, hits, opts)
  }

  touchUsage(): void {
    this.lastUsedAt = Date.now()
  }

  setIdleMs(ms: number): void {
    this.idleMs = Math.max(0, ms)
    if (this.idleMs === 0) {
      this.stopIdleTimer()
    } else if (this.isReady()) {
      this.startIdleTimer()
    }
  }

  private startIdleTimer(): void {
    this.stopIdleTimer()
    if (this.idleMs <= 0) return
    const tickMs = Math.min(60_000, Math.max(5_000, Math.floor(this.idleMs / 10)))
    this.idleTimer = setInterval(() => {
      if (!this.isReady()) return
      if (Date.now() - this.lastUsedAt < this.idleMs) return
      void this.unload().catch(() => undefined)
    }, tickMs)
    if (typeof this.idleTimer.unref === 'function') this.idleTimer.unref()
  }

  private stopIdleTimer(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  private async askWithModel(
    question: string,
    hits: RetrievalHit[],
    opts: AskOptions,
  ): Promise<string> {
    const client = this.client!
    const ctxSize = this.lastPlan?.contextSize ?? 8192
    const maxTokens = answerMaxTokens(ctxSize)
    const streamId = `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    const filter = new ThinkFilter()
    const detector = new LoopDetector()
    // Accumulated post-ThinkFilter text — used to reconstruct the answer when
    // the loop detector aborts mid-stream (worker throws AbortError before
    // returning `raw`, but the user-visible text up to that point is fine).
    let accumulated = ''
    let loopAborted = false

    const unregister = client.registerStream(streamId, (chunk, count) => {
      this.lastUsedAt = Date.now()
      // After a loop trip the worker is winding down — drop late chunks so
      // the renderer sees a clean cutoff instead of more repetition.
      if (loopAborted) return
      const cleaned = filter.feed(chunk)
      if (!cleaned) return
      accumulated += cleaned
      // `count` is the number of native onTextChunk callbacks the worker
      // coalesced into this batched push — forward it so the renderer's
      // tokens/sec metric reflects native chunk granularity, not the 125 Hz
      // ceiling that batching would otherwise impose.
      if (opts.onChunk) opts.onChunk(cleaned, count)
      if (detector.feed(cleaned)) {
        loopAborted = true
        // eslint-disable-next-line no-console
        console.warn('[llama] repetition loop detected, aborting generation')
        void client.llmAbort(streamId).catch(() => undefined)
      }
    })

    let abortListener: (() => void) | null = null
    if (opts.abortSignal) {
      abortListener = (): void => {
        void client.llmAbort(streamId).catch(() => undefined)
      }
      opts.abortSignal.addEventListener('abort', abortListener, { once: true })
    }

    const runOnce = async (history: AskOptions['conversationHistory']): Promise<string> => {
      filter.reset()
      detector.reset()
      accumulated = ''
      loopAborted = false
      const promptBody = buildPrompt(question, hits, history, this.language)
      const { raw } = await client.llmAsk({ streamId, question, prompt: promptBody, maxTokens })
      if (opts.onChunk) {
        const tail = filter.flush()
        // Synthesized tails count as one batched event (the ThinkFilter
        // buffer held back partial-think markers; flushing emits whatever
        // survived as a single chunk).
        if (tail) opts.onChunk(tail, 1)
      }
      return raw
    }

    const finalizeLoop = (): string => {
      const hint = REPETITION_HINT_TEXT[this.language]
      if (opts.onChunk) opts.onChunk(hint, 1)
      return stripThink(accumulated) + hint
    }

    try {
      try {
        const raw = await runOnce(opts.conversationHistory)
        return stripThink(raw)
      } catch (err) {
        if (loopAborted) return finalizeLoop()
        // Conversation history is embedded into the prompt body by buildPrompt,
        // so when the context overflows it's the one knob we can turn on retry.
        // Dropping it costs the model topical memory of prior turns , the live
        // question + retrieved Context still answer most follow-ups.
        const hasHistory = opts.conversationHistory && opts.conversationHistory.length > 0
        if (!isOverflowError(err) || !hasHistory) throw err
        // eslint-disable-next-line no-console
        console.warn('[llama] context overflowed, retrying without conversation history')
      }
      try {
        const raw = await runOnce(undefined)
        return stripThink(raw)
      } catch (err) {
        if (loopAborted) return finalizeLoop()
        throw err
      }
    } finally {
      unregister()
      if (abortListener && opts.abortSignal) {
        opts.abortSignal.removeEventListener('abort', abortListener)
      }
    }
  }

  async generateRaw(
    prompt: string,
    opts: {
      abortSignal?: AbortSignal | undefined
      maxTokens?: number | undefined
      jsonSchema?: object | undefined
      noThink?: boolean | undefined
    } = {},
  ): Promise<string> {
    this.touchUsage()
    if (!this.isReady() || !this.client) {
      throw new Error('Model is not loaded.')
    }
    const client = this.client
    const streamId = `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    let abortListener: (() => void) | null = null
    if (opts.abortSignal) {
      abortListener = (): void => {
        void client.llmAbort(streamId).catch(() => undefined)
      }
      opts.abortSignal.addEventListener('abort', abortListener, { once: true })
    }
    try {
      const payload: {
        streamId: string
        prompt: string
        maxTokens?: number
        jsonSchema?: object
        noThink?: boolean
      } = {
        streamId,
        prompt,
      }
      if (opts.maxTokens != null) payload.maxTokens = opts.maxTokens
      if (opts.jsonSchema != null) payload.jsonSchema = opts.jsonSchema
      if (opts.noThink) payload.noThink = true
      const { raw } = await client.llmGenerateRaw(payload)
      return stripThink(raw).trim()
    } finally {
      if (abortListener && opts.abortSignal) {
        opts.abortSignal.removeEventListener('abort', abortListener)
      }
    }
  }

  async generateTitle(
    userMessage: string,
    assistantMessage: string,
    opts: { abortSignal?: AbortSignal } = {},
  ): Promise<string | null> {
    if (!this.isReady()) return null
    const u = truncate(userMessage, 1200)
    const a = truncate(assistantMessage, 1200)
    const langWord = this.language === 'de' ? 'Deutsch' : 'English'
    const prompt =
      `Erstelle einen kurzen, prägnanten Titel (3 bis 6 Wörter) für dieses Gespräch in ${langWord}.\n` +
      `Antworte nur mit dem Titel selbst — keine Anführungszeichen, kein Punkt am Ende, keine Einleitung.\n\n` +
      `Benutzer: ${u}\n\n` +
      `Assistent: ${a}\n\n` +
      `Titel:`
    try {
      const raw = await this.generateRaw(prompt, opts)
      return cleanTitle(raw)
    } catch {
      return null
    }
  }

  private async askFallback(
    question: string,
    hits: RetrievalHit[],
    opts: AskOptions,
  ): Promise<string> {
    const out = renderFallback(question, hits, this.language)
    if (opts.onChunk) {
      for (const piece of chunkifyForStream(out)) {
        if (opts.abortSignal?.aborted) break
        opts.onChunk(piece, 1)
        await sleep(8)
      }
    }
    return out
  }
}

// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max).trim()}…`
}

function cleanTitle(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  const firstLine = s.split(/\r?\n/).find((line) => line.trim().length > 0)
  if (!firstLine) return null
  s = firstLine.trim()
  s = s.replace(/^(title|titel)\s*[:\-–—]\s*/i, '')
  s = s.replace(/^["'“”„‘’«»]+|["'“”„‘’«»]+$/g, '')
  s = s.replace(/[.。!?！？\s]+$/u, '').trim()
  if (!s) return null
  if (s.length > 64) s = `${s.slice(0, 63).trimEnd()}…`
  return s
}

function parsePositiveInt(v: string | undefined): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

function parseIdleMs(v: string | undefined): number | null {
  if (v == null) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.floor(n)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isOverflowError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  // `free up space` covers node-llama-cpp's LlamaContext.js "Failed to free up
  // space for new tokens" path — fires when context-shift can't reclaim room.
  return /context shift|context size|history.*fit|too long|free up space/i.test(msg)
}

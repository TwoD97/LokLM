import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { totalmem } from 'node:os'
import {
  ResourcePlanner,
  ggufWeightBytes,
  type LlmPlan,
  type SystemResources,
} from '../embeddings/ResourcePlanner'

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
  stripThink,
  chunkifyForStream,
  condense,
  REFUSAL_TEXT,
  HISTORY_MESSAGE_CHAR_CAP,
  HISTORY_TRUNCATION_MARKER,
  type ResponseLanguage,
} from './prompt'
export type { ResponseLanguage }

export interface AskOptions {
  onChunk?: (text: string) => void
  abortSignal?: AbortSignal
  /**
   * Optional tools the model may call during generation. node-llama-cpp
   * formats them into the chat template, intercepts the model's tool-call
   * tokens, runs the handlers, and feeds the JSON result back as the next
   * model turn — all transparent to the caller, who just gets the final
   * text out of `prompt()`.
   */
  tools?: Record<string, unknown>
  /**
   * Prior conversation turns to inject into the prompt as embedded memory.
   * We run each chat:ask on a freshly-reset session and ship history in the
   * prompt body itself; no reliance on LlamaChatSession's internal accrual.
   * Order: oldest → newest. Caller is responsible for truncating to a
   * sensible window.
   */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  /**
   * Deprecated — kept for back-compat with code paths that still pass it;
   * the per-turn session reset makes post-turn compaction redundant.
   */
  historyQuestion?: string
}

/**
 * RAM tiers we ship LLMs for. Auto-pick at startup uses os.totalmem() so a
 * 16 GB laptop never gets the full-fat 8B (which at Qwen3's default 128k
 * context can swallow ~15 GB by itself once you add the embedder + Electron).
 *
 * The patterns are loose so any common GGUF naming (`Qwen3-4B.gguf`,
 * `Qwen3-4B-Q4_K_M.gguf`, `qwen2.5-3b-instruct-q4_k_m.gguf`, …) auto-binds
 * to the right profile. minTotalMemGB is the *recommended* floor — we'll
 * still load if the user explicitly picks a profile their machine can't
 * comfortably hold, just with a warning in the status message.
 */
export interface LlmProfile {
  name: LlmProfileName
  displayName: string
  filenamePatterns: RegExp[]
  contextSize: number // hard ceiling on KV cache to bound RAM
  minTotalMemGB: number // recommended-floor hint for auto-pick
}

export const LLM_PROFILES: LlmProfile[] = [
  {
    name: 'lite',
    displayName: 'Lite — Qwen3 4B (8 GB target)',
    filenamePatterns: [/qwen3.*[-_]?4b/i, /qwen2\.5.*[-_]?3b/i, /llama.*3\.2.*[-_]?3b/i],
    // 32 K is Qwen3-4B's native context. Q4 KV cache at 32 K ≈ 0.8 GB on
    // top of the 2.5 GB model — comfortable on 8 GB VRAM.
    contextSize: 32768,
    minTotalMemGB: 8,
  },
  {
    name: 'full',
    displayName: 'Full — Qwen3 8B (16 GB+ target)',
    filenamePatterns: [/qwen3.*[-_]?8b/i, /qwen2\.5.*[-_]?7b/i],
    // 128 K is Qwen3-8B's native max. Q4 KV cache at 128 K ≈ 4 GB on top
    // of the 5 GB model — fits in 12+ GB VRAM with breathing room.
    // Mid-generation context-shift compression (the cause of mid-word
    // response truncations on tighter windows) effectively never fires
    // here. Override via LOKLM_LLM_CONTEXT_SIZE if your VRAM disagrees.
    contextSize: 131072,
    minTotalMemGB: 16,
  },
  {
    name: 'xl',
    displayName: 'XL — Nemotron 3 Nano 30B-A3B (high-end GPU, 32 GB+ RAM)',
    // Match preference order: Nemotron-3-Nano-30B (MoE, 3B active — the
    // intended xl model on the 5090) is listed first so it wins over the
    // older Nemotron-Super-49B if both files end up in models/. Other
    // matchers cover Qwen3 alternatives and any Llama-3.3-70B drop-in.
    filenamePatterns: [
      /nemotron.*3.*nano.*30b/i,
      /nemotron.*nano.*30b/i,
      /qwen3.*[-_]?30b.*a3b/i,
      /qwen3.*[-_]?32b/i,
      /qwen2\.5.*[-_]?32b/i,
      /nemotron.*super.*49b/i, // legacy — left in so an existing 49B GGUF still binds
      /llama.*3\.3.*70b/i,
    ],
    // 256 K matches Nemotron 3 Nano 30B-A3B's native max — the hard
    // ceiling that pins user-selected sizes. Auto-mode aims at this same
    // native window and steps KV cache down (fp16 → q8_0 → q4_0) until
    // the chosen context fits in usable VRAM/RAM.
    contextSize: 262144,
    minTotalMemGB: 32,
  },
]

/**
 * Models directory shared with the embedder.
 *  - Dev: <project>/models/
 *  - Packaged: <resources>/models/  (electron-builder copies via extraResources)
 */
function modelsDir(): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(root, 'models')
}

export function totalMemGB(): number {
  return totalmem() / (1024 * 1024 * 1024)
}

/**
 * Walk profiles from largest minTotalMemGB down and pick the first one the
 * machine clears. New profiles slot in automatically.
 */
export function recommendedProfile(): LlmProfileName {
  const gb = totalMemGB()
  const sorted = [...LLM_PROFILES].sort((a, b) => b.minTotalMemGB - a.minTotalMemGB)
  for (const p of sorted) {
    if (gb >= p.minTotalMemGB) return p.name
  }
  return sorted[sorted.length - 1]!.name
}

/**
 * Walk models/ once and bind every GGUF to whatever profile its filename
 * matches. Returns one entry per profile (filename = null if nothing on disk
 * for that tier). Used by the Settings UI and by loadProfile() to decide
 * what to load.
 */
export function discoverProfiles(): AvailableProfile[] {
  const dir = modelsDir()
  let entries: string[] = []
  try {
    if (existsSync(dir)) entries = readdirSync(dir)
  } catch {
    /* fall through with empty list */
  }
  const ggufs = entries.filter((f) => f.toLowerCase().endsWith('.gguf'))
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

/**
 * Build a per-binding profile label. When a GGUF is bound to the slot we
 * derive the model name from the filename so the UI never claims "XL —
 * Nemotron 3 Nano 30B-A3B" while the legacy 49B file is actually loaded.
 * Falls back to the profile's static displayName if nothing is on disk.
 */
function profileDisplayName(profile: LlmProfile, filename: string | null): string {
  if (!filename) return profile.displayName
  const variant = variantLabel(profile.name, filename)
  if (profile.name === 'lite') return `Lite — ${variant} (8 GB target)`
  if (profile.name === 'full') return `Full — ${variant} (16 GB+ target)`
  return `XL — ${variant} (high-end GPU, 32 GB+ RAM)`
}

function variantLabel(name: LlmProfileName, filename: string): string {
  const f = filename.toLowerCase()
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
  private model: unknown = null
  private context: unknown = null
  private session: unknown = null
  private gpuLabel: string | null = null
  private selectedChoice: LlmProfileChoice = 'auto'
  private selectedContext: LlmContextChoice = 'auto'
  private language: ResponseLanguage = 'de'
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
  }
  private listeners: Array<(s: ModelStatus) => void> = []
  // ResourcePlanner is shared across services; injected from index.ts so
  // the same VRAM probe powers every placement decision.
  constructor(private planner: ResourcePlanner = new ResourcePlanner()) {}

  // ---- status / introspection ------------------------------------------------

  subscribe(cb: (s: ModelStatus) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  private setStatus(patch: Partial<ModelStatus>): void {
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
    // For the systemInfo dashboard we use the cached planner snapshot if
    // available, falling back to the cheap RAM-only recommendation.
    const recommended = this.recommendedProfileFromCache(profiles)
    const resolved = this.resolveSelectedPath(profiles, recommended)
    return {
      ...this.status,
      bundledModelPath: resolved ?? join(modelsDir()),
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
    return this.status.state === 'ready' && this.session !== null
  }

  /** Settings calls this when the user changes the profile dropdown. */
  setSelectedProfile(choice: LlmProfileChoice): void {
    this.selectedChoice = choice
  }

  /** Settings calls this when the user changes the context-size choice. */
  setSelectedContext(choice: LlmContextChoice): void {
    this.selectedContext = choice
  }

  /**
   * Locks model responses to the given language. Applied at session creation
   * via the system prompt. If the model is already loaded we swap the system
   * turn in the existing chat history so the change takes effect on the next
   * `ask()` without paying a full model reload.
   */
  setLanguage(lang: ResponseLanguage): void {
    if (this.language === lang) return
    this.language = lang
    const session = this.session as {
      getChatHistory?: () => Array<{ type: string; text?: string }>
      setChatHistory?: (h: Array<{ type: string; text?: string }>) => void
    } | null
    if (!session?.getChatHistory || !session.setChatHistory) return
    try {
      const history = session.getChatHistory()
      // History entries marked `type: 'system'` get rewritten in place. The
      // node-llama-cpp session always seeds one such entry at index 0, so we
      // overwrite it rather than searching by content.
      const next = history.map((h, i) =>
        i === 0 || h.type === 'system'
          ? { ...h, type: 'system', text: buildSystemPrompt(lang) }
          : h,
      )
      session.setChatHistory(next)
    } catch {
      /* swallow — next reload will pick up the language change anyway */
    }
  }

  getLanguage(): ResponseLanguage {
    return this.language
  }

  /** Expose the shared planner so embedder/reranker can plug into it. */
  getPlanner(): ResourcePlanner {
    return this.planner
  }

  private recommendedProfileFromCache(profiles: AvailableProfile[]): LlmProfileName {
    const res = this.lastResources
    if (!res) return recommendedProfile()
    const enriched = LLM_PROFILES.map((p) => {
      const d = profiles.find((x) => x.name === p.name)
      const path = d?.filename ? join(modelsDir(), d.filename) : null
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
   * Picks a profile (per the explicit choice or the auto-recommended one)
   * and loads its GGUF if present. Falls back to the *other* profile if the
   * preferred one has no GGUF on disk — better to load *something* than to
   * fail loudly when the user accidentally bundled only one tier.
   */
  async autoLoad(): Promise<void> {
    const profiles = discoverProfiles()
    // Refresh VRAM/RAM up-front so an `auto` profile pick gets to consider
    // both this run's free VRAM and what's still on disk for each tier.
    const resources = await this.planner.refresh()
    this.lastResources = resources

    let preferredName: LlmProfileName
    if (this.selectedChoice === 'auto') {
      const enriched = LLM_PROFILES.map((p) => {
        const d = profiles.find((x) => x.name === p.name)
        const path = d?.filename ? join(modelsDir(), d.filename) : null
        return {
          name: p.name,
          minTotalMemGB: p.minTotalMemGB,
          weightsBytes: path ? ggufWeightBytes(path) : 0,
        }
      })
      const picked = this.planner.pickProfile(enriched, resources)
      preferredName = (picked?.name as LlmProfileName | undefined) ?? recommendedProfile()
    } else {
      preferredName = this.selectedChoice
    }

    const path = this.resolveSelectedPath(profiles, preferredName)
    if (!path) {
      this.setStatus({
        state: 'failed',
        modelPath: null,
        modelName: null,
        profile: null,
        message: `No LLM GGUF found in ${modelsDir()}. Drop a Qwen3-4B or Qwen3-8B .gguf there.`,
      })
      return
    }
    const profile = profiles.find((p) => p.filename && path.endsWith(p.filename))
    await this.loadModel(path, profile?.name ?? preferredName)
  }

  /**
   * Resolve which file to load: try the preferred profile first; if it has
   * no GGUF on disk, fall back to any other profile that does.
   */
  private resolveSelectedPath(
    profiles: AvailableProfile[],
    preferred: LlmProfileName,
  ): string | null {
    const order = [preferred, ...profiles.filter((p) => p.name !== preferred).map((p) => p.name)]
    for (const name of order) {
      const p = profiles.find((x) => x.name === name)
      if (p && p.filename) return join(modelsDir(), p.filename)
    }
    return null
  }

  async loadModel(modelPath: string, profileName?: LlmProfileName): Promise<void> {
    await this.unload()
    const profile = profileName ? profileByName(profileName) : null
    const filename = modelPath.split(/[\\/]/).pop() ?? 'unknown.gguf'
    const profileLabel = profile ? profileDisplayName(profile, filename) : null
    this.setStatus({
      state: 'loading',
      modelPath,
      modelName: filename,
      profile: profile?.name ?? null,
      loadProgress: 0,
      message: profileLabel ? `Initialising ${profileLabel}…` : 'Initialising llama backend…',
      gpu: null,
    })

    try {
      const lib = await import('node-llama-cpp')
      const llama = await initLlama(lib, (msg) => this.setStatus({ message: msg }))
      this.gpuLabel = describeGpu(llama)

      // contextSize is the single biggest knob on RAM use. Resolution order:
      //   1. LOKLM_LLM_CONTEXT_SIZE env var — power-user escape hatch.
      //   2. User-pinned `selectedContext` number from Settings.
      //   3. Auto: ResourcePlanner sizes against free VRAM, capped by the
      //      profile's native max.
      //
      // Refresh resources BEFORE the weights actually allocate VRAM —
      // planLlm subtracts weightsBytes from freeVramGB to size the KV
      // budget, so if we refreshed post-load the weights would be
      // double-counted and KV would collapse to the MIN floor (the
      // 4096-token regression). The post-load snapshot is taken later so
      // the UI / aux-model placement still see accurate free VRAM.
      const envOverride = parsePositiveInt(process.env.LOKLM_LLM_CONTEXT_SIZE)
      const resources = await this.planner.refresh()
      this.lastResources = resources
      const weightsBytes = ggufWeightBytes(modelPath)

      this.setStatus({ message: 'Loading model weights…', gpu: this.gpuLabel })

      const model = await llama.loadModel({
        modelPath,
        onLoadProgress: (p: number) => {
          this.setStatus({ loadProgress: p })
        },
      })
      const userChoice: LlmContextChoice = envOverride != null ? envOverride : this.selectedContext
      const plan = this.planner.planLlm({
        profileName: profile?.name ?? 'full',
        profileDefaultContext: profile?.contextSize ?? 32768,
        weightsBytes,
        resources,
        userContextChoice: userChoice,
      })
      this.lastPlan = plan
      // KV cache element type is experimental in node-llama-cpp but stable in
      // llama.cpp itself. Q8_0 halves KV memory vs F16 with negligible quality
      // loss; Q4_0 quarters it. Some backends reject Q4 V-cache unless flash
      // attention is enabled. Strategy:
      //   - Pass `contextSize: {min, max}` rather than a hard number — the
      //     library walks the GGUF metadata and picks the largest size that
      //     actually fits given the chosen KV type and runtime overhead. Our
      //     planner is only a coarse pre-filter; node-llama-cpp's estimator
      //     is the ground truth.
      //   - Step KV precision up (q4 → q8 → f16) on rejection, narrowing the
      //     max each time so the next attempt can't request more KV than the
      //     prior failure already proved unavailable.
      //   - Flash attention on by default — required for some quant combos,
      //     and a free perf win otherwise.
      const profileCap = profile?.contextSize ?? 32768
      const createCtx = (opts: Record<string, unknown>): Promise<{ getSequence: () => unknown }> =>
        (
          model as {
            createContext: (o: Record<string, unknown>) => Promise<{ getSequence: () => unknown }>
          }
        ).createContext(opts)
      // node-llama-cpp's experimental KV-quant options take GgmlType enum
      // names (uppercase) rather than the lowercase llama.cpp wire names.
      const enumNameFor = (t: 'f16' | 'q8_0' | 'q4_0'): 'Q8_0' | 'Q4_0' | null =>
        t === 'q8_0' ? 'Q8_0' : t === 'q4_0' ? 'Q4_0' : null

      const fallbackOrder: Array<'q4_0' | 'q8_0' | 'f16'> = ['q4_0', 'q8_0', 'f16']
      const startIdx = fallbackOrder.indexOf(plan.kvCacheType)
      let context: { getSequence: () => unknown } | null = null
      let activePlan = plan
      // Upper bound shrinks as attempts fail — never request more than the
      // last failure proved unavailable.
      let maxCtxBound = Math.min(plan.contextSize, profileCap)
      const minCtxBound = 4096
      for (let i = startIdx; i < fallbackOrder.length; i++) {
        const attemptType = fallbackOrder[i]!
        const attemptPlan =
          i === startIdx
            ? plan
            : this.planner.planLlm({
                profileName: profile?.name ?? 'full',
                profileDefaultContext: maxCtxBound,
                weightsBytes,
                resources,
                userContextChoice: userChoice,
                forceKvType: attemptType,
              })
        // Use the planner's hint as the *upper* bound and let node-llama-cpp
        // resolve downward. min keeps us above a useful floor.
        const attemptMax = Math.min(attemptPlan.contextSize, maxCtxBound)
        const opts: Record<string, unknown> = {
          contextSize: { min: minCtxBound, max: attemptMax },
          flashAttention: true,
        }
        const kvEnum = enumNameFor(attemptType)
        if (kvEnum) {
          opts.experimentalKvCacheKeyType = kvEnum
          opts.experimentalKvCacheValueType = kvEnum
        }
        this.setStatus({
          message: `Creating context (≤${attemptMax} tokens — ${attemptPlan.reason})…`,
          loadProgress: 1,
        })
        try {
          context = await createCtx(opts)
          activePlan = attemptPlan
          break
        } catch (err) {
          // Shrink the bound for the next attempt: halve it so we don't
          // re-attempt the same failing point even when stepping KV up.
          maxCtxBound = Math.max(minCtxBound, Math.floor(attemptMax / 2))
          if (i === fallbackOrder.length - 1) break
          // eslint-disable-next-line no-console
          console.warn(
            `[llama] KV cache ${attemptType} ≤${attemptMax} rejected; stepping up precision`,
            err,
          )
        }
      }
      if (!context) {
        // Final fallback: f16 with library-resolved auto sizing — no max,
        // no min. If even that throws we let it bubble.
        // eslint-disable-next-line no-console
        console.warn('[llama] all bounded attempts failed; falling back to auto context resolution')
        context = await createCtx({ contextSize: 'auto', flashAttention: true })
        activePlan = { ...plan, kvCacheType: 'f16', reason: 'auto fallback after rejection chain' }
      }
      this.lastPlan = activePlan
      const session = new lib.LlamaChatSession({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contextSequence: context.getSequence() as any,
        systemPrompt: buildSystemPrompt(this.language),
      })

      this.model = model
      this.context = context
      this.session = session
      // Post-load VRAM snapshot so the dashboard / aux placement see the
      // remaining free VRAM rather than the pre-allocation reading we
      // sized against above.
      try {
        this.lastResources = await this.planner.refresh()
      } catch {
        /* keep pre-load snapshot on probe failure */
      }
      this.setStatus({
        state: 'ready',
        loadProgress: null,
        message: profileLabel ? `${profileLabel} ready.` : 'Ready.',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.unload()
      this.setStatus({
        state: 'failed',
        loadProgress: null,
        message: msg,
      })
      throw err
    }
  }

  async unload(): Promise<void> {
    try {
      if (this.session && hasDispose(this.session)) await this.session.dispose()
      if (this.context && hasDispose(this.context)) await this.context.dispose()
      if (this.model && hasDispose(this.model)) await this.model.dispose()
    } catch {
      /* ignore */
    }
    this.session = null
    this.context = null
    this.model = null
    if (this.status.state === 'ready') {
      this.setStatus({ state: 'unloaded', message: 'Model unloaded.' })
    }
  }

  // ---- inference -------------------------------------------------------------

  async ask(question: string, hits: RetrievalHit[], opts: AskOptions = {}): Promise<string> {
    if (this.isReady()) return this.askWithModel(question, hits, opts)
    return this.askFallback(question, hits, opts)
  }

  private async askWithModel(
    question: string,
    hits: RetrievalHit[],
    opts: AskOptions,
  ): Promise<string> {
    // node-llama-cpp's prompt() runs the function-calling loop internally:
    // it intercepts the model's tool-call output, executes the handler,
    // appends the result, and continues generation until a final text turn.
    // We only see token streams from the *user-visible* portions, plus the
    // tool side-effects via onCall/onResult hooks the caller wired into
    // each handler.
    const session = this.session as {
      prompt: (
        text: string,
        options: {
          onTextChunk?: (s: string) => void
          signal?: AbortSignal
          functions?: Record<string, unknown>
          maxTokens?: number
        },
      ) => Promise<string>
      getChatHistory?: () => Array<{ type: string; text?: string }>
      setChatHistory?: (h: Array<{ type: string; text?: string }>) => void
      resetChatHistory?: () => void
    }
    // Scale the response budget to the active context window: an XL model
    // (Nemotron 3 Nano in a 256 K window) should be able to draft a long
    // multi-section answer, while a Lite session has to share its window
    // with prompt + history. Floor at 4 K so even the tightest config
    // finishes typical answers cleanly; cap at 32 K so a long-form XL run
    // never hits the cap mid-citation. Quarter of the context leaves
    // comfortable headroom for the prompt + retrieved chunks + history.
    const ctxSize = this.lastPlan?.contextSize ?? 8192
    const MAX_RESPONSE_TOKENS = Math.max(4096, Math.min(32768, Math.floor(ctxSize / 4)))

    const filter = new ThinkFilter()
    const prompt = buildPrompt(question, hits, opts.conversationHistory)

    // ---- stateless turn ------------------------------------------------
    // We embed prior conversation turns directly into the prompt body
    // (see buildPrompt). To keep the model from seeing each turn twice —
    // once via session-internal history, once via the prompt — wipe the
    // session's history before every ask. This also fixes the "feels
    // like the model forgot what we were talking about" problem that
    // hits when the user reopens a saved conversation: the IPC layer
    // hands us the persisted message list, we put it in the prompt, and
    // the model sees the full thread regardless of session state.
    try {
      session.resetChatHistory?.()
    } catch {
      /* best-effort; if reset fails we just have a slightly larger prompt */
    }

    const runOnce = async (withTools: boolean): Promise<string> => {
      filter.reset()
      const promptOpts: {
        onTextChunk?: (s: string) => void
        signal?: AbortSignal
        functions?: Record<string, unknown>
        maxTokens?: number
      } = { maxTokens: MAX_RESPONSE_TOKENS }
      if (opts.onChunk) {
        promptOpts.onTextChunk = (chunk: string) => {
          const cleaned = filter.feed(chunk)
          if (cleaned) opts.onChunk!(cleaned)
        }
      }
      if (opts.abortSignal) promptOpts.signal = opts.abortSignal
      if (withTools && opts.tools) promptOpts.functions = opts.tools
      const raw = await session.prompt(prompt, promptOpts)
      if (opts.onChunk) {
        const tail = filter.flush()
        if (tail) opts.onChunk(tail)
      }
      const cleaned = stripThink(raw)
      // eslint-disable-next-line no-console
      console.info(
        `[llama] response complete: raw=${raw.length} chars, cleaned=${cleaned.length} chars, ` +
          `endsWith=${JSON.stringify(cleaned.slice(-40))}`,
      )
      return cleaned
    }

    const isOverflow = (err: unknown): boolean => {
      const msg = err instanceof Error ? err.message : String(err)
      return /context shift|context size|history.*fit|too long/i.test(msg)
    }

    let raw: string
    try {
      raw = await runOnce(true)
    } catch (err) {
      if (!isOverflow(err)) throw err
      // First fallback: drop history; the system prompt + tools + new prompt
      // sometimes fits when the accumulated turns are gone.
      // eslint-disable-next-line no-console
      console.warn('[llama] context overflowed, resetting history and retrying with tools')
      try {
        session.resetChatHistory?.()
      } catch {
        /* ignore */
      }
      try {
        raw = await runOnce(true)
      } catch (err2) {
        if (!isOverflow(err2)) throw err2
        // Second fallback: also drop the tools schema. The tool definitions
        // are 1–2 K tokens by themselves; the model can still answer from
        // the retrieval Context block alone.
        // eslint-disable-next-line no-console
        console.warn('[llama] still overflowing, dropping tools and retrying')
        try {
          session.resetChatHistory?.()
        } catch {
          /* ignore */
        }
        raw = await runOnce(false)
      }
    }

    // No post-turn history compaction needed: every turn starts with
    // session.resetChatHistory(), and prior turns are embedded into the
    // prompt body via opts.conversationHistory + buildPrompt. The session's
    // internal history is therefore effectively single-turn.
    return raw
  }

  /**
   * One-shot text generation that does not pollute the chat session's
   * history. Used by QAService and any other "background" generator that
   * shouldn't show up in the user's conversation.
   *
   * Implementation: snapshot the chat history, reset, prompt, then restore.
   * If the restore fails for any reason we leave the session reset rather
   * than throwing — better to lose a chat history than to crash a Q&A flow.
   */
  async generateRaw(prompt: string, opts: { abortSignal?: AbortSignal } = {}): Promise<string> {
    if (!this.isReady() || !this.session) {
      throw new Error('Model is not loaded.')
    }
    const session = this.session as {
      prompt: (text: string, options: { signal?: AbortSignal }) => Promise<string>
      getChatHistory?: () => unknown[]
      setChatHistory?: (history: unknown[]) => void
      resetChatHistory?: () => void
    }
    let saved: unknown[] | undefined
    try {
      saved = session.getChatHistory?.()
    } catch {
      saved = undefined
    }
    try {
      session.resetChatHistory?.()
      const rawOpts: { signal?: AbortSignal } = {}
      if (opts.abortSignal) rawOpts.signal = opts.abortSignal
      const raw = await session.prompt(prompt, rawOpts)
      return stripThink(raw).trim()
    } finally {
      if (saved && session.setChatHistory) {
        try {
          session.setChatHistory(saved)
        } catch {
          /* drop history on restore failure */
        }
      }
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
        opts.onChunk(piece)
        await sleep(8)
      }
    }
    return out
  }
}

// ---------------------------------------------------------------------------

function describeGpu(llama: unknown): string | null {
  const obj = llama as { gpu?: string }
  if (typeof obj?.gpu === 'string') return obj.gpu
  return null
}

/**
 * Pick a backend. By default we use node-llama-cpp's `auto` heuristic — on
 * Windows it picks Vulkan (prebuilt, no toolchain required). To force CUDA
 * (needs MSVC + CUDA Toolkit installed so the postinstall can build the CUDA
 * backend) set `LLAMA_GPU=cuda`. Other valid values: `vulkan`, `metal`, `cpu`.
 */
async function initLlama(
  lib: typeof import('node-llama-cpp'),
  onMessage: (msg: string) => void,
): Promise<Awaited<ReturnType<typeof import('node-llama-cpp').getLlama>>> {
  const pinned = (process.env.LLAMA_GPU ?? '').toLowerCase()
  type Gpu = 'cuda' | 'vulkan' | 'metal' | 'auto' | false
  const order: Gpu[] = (() => {
    if (pinned === 'cpu' || pinned === 'false') return [false]
    if (pinned === 'cuda' || pinned === 'vulkan' || pinned === 'metal') return [pinned, 'auto']
    return ['auto']
  })()

  let lastErr: unknown = null
  for (const gpu of order) {
    try {
      onMessage(`Initialising llama backend (${gpu === false ? 'cpu' : gpu})…`)
      const llama = await lib.getLlama({ gpu })
      return llama
    } catch (err) {
      lastErr = err
      console.warn(`[llama] ${gpu} init failed, trying next:`, err)
    }
  }
  throw lastErr ?? new Error('No backend could be initialised')
}

function parsePositiveInt(v: string | undefined): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

function hasDispose(o: unknown): o is { dispose: () => Promise<void> } {
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof (o as { dispose?: unknown }).dispose === 'function'
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

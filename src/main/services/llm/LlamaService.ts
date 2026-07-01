import { totalmem } from 'node:os'
import {
  ResourcePlanner,
  ggufWeightBytes,
  resolveLlmDevicePlan,
  type LlmPlan,
  type SystemResources,
  type LlmDevicePlan,
} from '../embeddings/ResourcePlanner'
import { getModelSearchDirs, listVisibleGgufs, resolveModelFile } from '../models/paths'
import { readGpuInventory, getEffectiveTier, type Tier } from '../tier/TierMarker'
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
  GpuKind,
  LlmPlacementChoice,
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
  bumpDepthForCode,
  renderFallback,
  ThinkFilter,
  LoopDetector,
  REPETITION_HINT_TEXT,
  stripThink,
  chunkifyForStream,
  answerMaxTokens,
  type ResponseLanguage,
  type AnswerDepth,
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
  /** Pinned-doc chunks, kept separate from the positional RAG hits so
   *  buildPrompt can render them as the LEADING prompt section. That makes the
   *  [system][pinned] token prefix byte-stable across turns in a workspace,
   *  which node-llama-cpp's sequence alignment turns into KV-cache reuse —
   *  pinned content is prefilled once, not on every question. */
  pinnedHits?: RetrievalHit[]
  /** Uncited background block rendered above the hits in the Context section
   *  (see buildPrompt / buildSummaryPreamble). Used by the doc_summary route
   *  to feed the cached whole-doc summary without touching the citation
   *  contract — the preamble carries no [doc, chunk] id. Renders AFTER the
   *  pinned section: it is per-turn volatile and must not break the stable
   *  KV prefix pinnedHits exist to provide. */
  contextPreamble?: string
}

export interface LlmProfile {
  name: LlmProfileName
  displayName: string
  filenamePatterns: RegExp[]
  contextSize: number
  minTotalMemGB: number
}

// Profile ↔ on-disk-GGUF binding. The profiles map onto the Qwen3.5 lineup the
// installer wizard ships ( installer-wizard/model-manifest.json ) :
//   lite → Qwen3.5-4B @ 8K ( 2B fallback ) , full → Qwen3.5-4B @ 128K , xl → 9B.
// (0.6.3: lite moved 2B → 4B; lite and full now share the 4B weight, differing
// only in runtime — lite caps context at 8K for the iGPU. See ADR-0007/0008.)
// Patterns are deliberately Qwen3.5-only — the legacy Qwen3 / Qwen2.5 / Llama /
// Nemotron fallbacks were removed so a side-loaded Qwen3-8B can never resolve
// as a tier model ( that mismatch loaded an 8B under a "lite" install ).
export const LLM_PROFILES: LlmProfile[] = [
  {
    name: 'lite',
    displayName: 'Lite — Qwen3.5 4B @ 8K (12 GB target)',
    // 0.6.3: lite now runs the 4B (Q4_K_M — the SAME 4-bit weight the standard
    // tier ships), at lite's 8K runtime. The 2B it replaced hallucinated badly;
    // the 4B is far more grounded and, unlike the 2B, answers cleanly at
    // 'standard' depth (PROFILE_TO_DEPTH). Pattern ORDER is preference: the 4B
    // wins when present; the 2B stays as a fallback so existing 2B-only installs
    // keep working (they stay 'concise' — see answerDepth). All other lite
    // runtime (8K cap, reranker, signal contextualize, iGPU-safe batch) is gated
    // on the lite TIER, not the model, so it carries over unchanged.
    filenamePatterns: [/qwen3\.5.*[-_]?4b/i, /qwen3\.5.*[-_]?2b/i],
    // 8K, not 32K. The context window sizes both the KV cache AND the retrieval
    // pack budget (QAService packs RAG context proportional to the window). On an
    // iGPU-only target a 32K window means ~23K tokens of retrieved text get
    // packed into every prompt — minutes of prefill on the iGPU, and the KV
    // allocation can OOM the device outright (empty answer / worker crash). 8K
    // bounds the prompt to ~3–4K RAG tokens: still ample for a focused QA turn,
    // fast to prefill, and memory-safe. Standard/pro keep their large windows.
    contextSize: 8192,
    // 12, not 8: the 4B (~2.6 GB) + embedder (0.44) + reranker (0.44) + 8K KV +
    // Electron is a ~6 GB working set; 12 GB leaves safe headroom (10 GB is the
    // edge once the OS takes its share). True 8 GB machines fall back to the 2B.
    minTotalMemGB: 12,
  },
  {
    name: 'full',
    displayName: 'Full — Qwen3.5 4B (16 GB+ target)',
    filenamePatterns: [/qwen3\.5.*[-_]?4b/i],
    contextSize: 131072,
    minTotalMemGB: 16,
  },
  {
    name: 'xl',
    displayName: 'XL — Qwen3.5 9B (high-end GPU, 32 GB+ RAM)',
    filenamePatterns: [/qwen3\.5.*[-_]?9b/i],
    contextSize: 262144,
    minTotalMemGB: 32,
  },
]

export function totalMemGB(): number {
  return totalmem() / (1024 * 1024 * 1024)
}

// Wizard tier ( install-time user choice ) → LLM profile. The tiers and
// profiles are separate vocabularies :
//   lite     ( Qwen3.5-4B @ 8K )  → lite  profile
//   standard ( Qwen3.5-4B )       → full  profile
//   pro      ( Qwen3.5-9B )       → xl    profile
const TIER_TO_PROFILE: Record<Tier, LlmProfileName> = {
  lite: 'lite',
  standard: 'full',
  pro: 'xl',
}

// Tier-aware AUTO context targets (0.6.5). The profile's NATIVE window (131K /
// 262K) is the wrong auto target: it is practically never reachable in VRAM, so
// chasing it either quantises the KV cache down to q4_0 or leaves the planner
// clamped at whatever scraps fit — while the QA packer (answer reserve = half
// the window) starves the RAG context down to a handful of chunks. Realistic
// per-tier targets keep KV at f16/q8_0 and give each tier the window its
// hardware class actually affords: lite 8K (iGPU, unchanged), standard 32K,
// pro 64K. Auto sizes DOWN from the target when VRAM is tight; an explicit
// settings choice still picks any size up to the target; LOKLM_LLM_CONTEXT_SIZE
// overrides everything (dev escape hatch past the target too).
const TIER_CONTEXT_TARGET: Record<Tier, number> = {
  lite: 8192,
  standard: 32768,
  pro: 65536,
}

// How fully each profile is allowed to answer (system-prompt verbosity). Bigger
// window → more room to develop the answer: Lite answers in full at 'standard'
// depth (bounded to its iGPU-safe 8K window); Standard and Pro/XL develop the
// explanation at 'thorough'. 0.6.3: lite moved 'concise' → 'standard' because it
// now runs the 4B — the earlier 2B rambled into unclosed <think> loops at
// 'standard' (swallowed into a blank answer), the reason lite was pinned terse.
// 0.6.4: full moved 'standard' → 'thorough'. Since 0.6.3 Standard runs the SAME
// 4B weight as Lite (differing only in the 8K-vs-128K window), so an identical
// depth prompt made Standard answers as terse as Lite's — the exact complaint.
// Depth is the lever that separates them: Lite stays focused for the iGPU;
// Standard uses its large window to answer fully. The 2B FALLBACK is kept at
// 'concise' by answerDepth() so an old 2B-only install doesn't regress; the
// recovery net in askWithModel still guarantees a non-blank turn regardless.
const PROFILE_TO_DEPTH: Record<LlmProfileName, AnswerDepth> = {
  lite: 'standard',
  full: 'thorough',
  xl: 'thorough',
}

/** The legacy 2B that the lite profile still accepts as a fallback. It only
 *  produces clean output at 'concise' depth — answerDepthFor() demotes it. */
const LITE_FALLBACK_2B = /qwen3\.5.*[-_]?2b/i

/**
 * Pattern-priority GGUF pick: returns the first filename matching the EARLIEST
 * pattern, so the lite profile (which lists the 4B before the 2B) prefers the 4B
 * when both are on disk. A flat `.some()` would instead return whichever GGUF the
 * directory happened to list first. Exported for unit tests.
 */
export function pickProfileGguf(
  patterns: readonly RegExp[],
  ggufs: readonly string[],
): string | null {
  for (const re of patterns) {
    const m = ggufs.find((f) => re.test(f))
    if (m) return m
  }
  return null
}

/**
 * Answer-verbosity depth for a loaded (profile, model-file) pair. The lite
 * profile can resolve to the 4B (preferred → 'standard') OR the legacy 2B
 * fallback, which must stay 'concise' (it think-loops at 'standard'). Everything
 * else follows PROFILE_TO_DEPTH. Exported for unit tests.
 */
export function answerDepthFor(
  profile: LlmProfileName | null,
  modelPath: string | null,
): AnswerDepth {
  if (!profile) return 'concise'
  if (profile === 'lite' && modelPath != null && LITE_FALLBACK_2B.test(modelPath)) {
    return 'concise'
  }
  return PROFILE_TO_DEPTH[profile]
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
  const tier = getEffectiveTier()
  if (!tier) return null
  return TIER_TO_PROFILE[tier] ?? null
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
    // Pattern ORDER is preference: lite lists the 4B before the 2B fallback, so
    // when both are on disk the 4B wins (see pickProfileGguf).
    const match = pickProfileGguf(p.filenamePatterns, ggufs) ?? undefined
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
  if (profile.name === 'lite') return `Lite — ${variant} (12 GB target)`
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
  private selectedPlacement: LlmPlacementChoice = 'auto'
  // Resolved device plan (backend + pin) for the current choice + GPU inventory.
  // Recomputed by applyDevicePlan(); handed to the worker (which restarts when
  // the physical device changes).
  private devicePlan: LlmDevicePlan = resolveLlmDevicePlan('auto', [])
  // Where the last load actually landed + why — surfaced in systemInfo for the
  // status bar / settings. Null until a load has happened.
  private resolvedPlacement: 'cpu' | 'gpu' | null = null
  private placementReason: string | null = null
  // Resolved device name + class + whether the requested device was confirmed,
  // from the last load. Surfaced in systemInfo + the TitleBar chip.
  private resolvedGpuName: string | null = null
  private resolvedGpuKind: GpuKind | null = null
  private pinnedDeviceVerified = true
  // English-first default ( matches DEFAULT_SETTINGS.basic.language ) ; the
  // real value is pushed from settings on startup + on every change.
  private language: ResponseLanguage = 'en'
  /** True while the active chat workspace is a codebase — appends the CODE
   *  system-prompt section. Set per turn by QAService via setCodebaseMode. */
  private codebaseMode = false
  // Profile of the currently loaded model. Drives the answer-verbosity depth in
  // the system prompt ( PROFILE_TO_DEPTH ) so a per-turn language switch rebuilds
  // the prompt at the right tier. Null until a load lands.
  private activeProfile: LlmProfileName | null = null
  // Path of the loaded GGUF. Lets answerDepth() tell the lite 4B (→ 'standard')
  // from the legacy 2B fallback (→ 'concise') — same profile, different depth.
  private activeModelPath: string | null = null
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
      placementChoice: this.selectedPlacement,
      resolvedPlacement: this.resolvedPlacement,
      placementReason: this.placementReason,
      gpuName: this.resolvedGpuName,
      gpuKind: this.resolvedGpuKind,
      availableGpus: readGpuInventory().map((g) => ({ name: g.name, kind: g.kind })),
      pinnedDeviceVerified: this.pinnedDeviceVerified,
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

  setSelectedPlacement(choice: LlmPlacementChoice): void {
    // CPU is no longer a user-selectable LLM placement — a GPU is required and
    // the picker chooses a device CLASS. Anything that isn't a real class (e.g.
    // a legacy persisted 'cpu'/'gpu', or a value from a newer build) coerces to
    // 'auto'. (Pure-CPU timing evals drive the worker via LLAMA_GPU=cpu, not
    // this field, so they're unaffected.)
    this.selectedPlacement = choice === 'dedicated' || choice === 'integrated' ? choice : 'auto'
  }

  getSelectedPlacement(): LlmPlacementChoice {
    return this.selectedPlacement
  }

  /**
   * Recompute the device plan from the current choice + the install-time GPU
   * inventory and push it to the worker. The worker bakes the pin into its spawn
   * env, so this restarts the worker when the PHYSICAL device changes (a no-op
   * otherwise). Safe to call before any worker exists (it just stores the plan,
   * so the first spawn already carries the right env). Called from applySettings
   * (startup + on change) and defensively at the head of autoLoad.
   */
  async applyDevicePlan(): Promise<void> {
    this.devicePlan = resolveLlmDevicePlan(this.selectedPlacement, readGpuInventory())
    if (this.client) {
      try {
        await this.client.setDevicePlan(this.devicePlan)
      } catch {
        /* worker status push already reflects reality */
      }
    }
  }

  /** Answer-verbosity depth for the loaded model's tier — Lite terse, Standard
   *  full, Pro/XL thorough. Falls back to the terse default before a load lands
   *  so the prompt never over-promises on an unknown model. */
  private answerDepth(): AnswerDepth {
    return answerDepthFor(this.activeProfile, this.activeModelPath)
  }

  async setLanguage(lang: ResponseLanguage): Promise<void> {
    if (this.language === lang) return
    this.language = lang
    // Worker patches its session's system prompt without paying a reload.
    // Awaited so a per-turn switch (QAService , Auto mode) lands before the
    // next llmAsk — the worker holds the system prompt as session state.
    await this.pushSystemPrompt()
  }

  /** Codebase-workspace prompt mode (ADR-0006): appends the CODE section to the
   *  system prompt so the model gets code-reading guidance instead of the pure
   *  document-library framing. Same per-turn contract as setLanguage — QAService
   *  awaits it before ask(), and the worker patches session state, no reload. */
  async setCodebaseMode(on: boolean): Promise<void> {
    if (this.codebaseMode === on) return
    this.codebaseMode = on
    await this.pushSystemPrompt()
  }

  /** Effective depth for the current prompt mode: codebase workspaces get one
   *  level more room (bumpDepthForCode) — a class walkthrough at the doc-QA
   *  depths reads as a fragment (observed: 400-token answers under a 4096
   *  budget, capped purely by the LENGTH rule). */
  private effectiveDepth(): AnswerDepth {
    const depth = this.answerDepth()
    return this.codebaseMode ? bumpDepthForCode(depth) : depth
  }

  private async pushSystemPrompt(): Promise<void> {
    if (this.client && this.isReady()) {
      try {
        await this.client.llmSetLanguage(
          this.language,
          buildSystemPrompt(this.language, this.effectiveDepth(), { codebase: this.codebaseMode }),
        )
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

    // Resolve the device plan (choice + install-time GPU inventory) and pin it on
    // the worker BEFORE loading — this restarts the worker when the physical
    // device changed so the next getLlama latches the right one.
    await this.applyDevicePlan()

    // GPU required: the bundled LLM only runs on a GPU (dedicated or integrated).
    // Block only when there's genuinely no usable GPU — when the marker inventory
    // is present it's authoritative (plan.noGpu); without a marker we trust the
    // runtime VRAM probe. Running a multi-GB model on CPU is multi-minutes per
    // answer and effectively unusable. CPU-only timing evals still work via
    // LLAMA_GPU=cpu, which drives the worker backend directly and bypasses this.
    const inventory = readGpuInventory()
    const noUsableGpu = inventory.length > 0 ? this.devicePlan.noGpu : !snapshot.hasGpu
    if (noUsableGpu) {
      // eslint-disable-next-line no-console
      console.warn('[llm] no GPU detected — refusing to load (GPU is required)')
      this.setStatus({
        state: 'failed',
        modelPath: null,
        modelName: null,
        profile: null,
        message:
          'No GPU detected. LokLM requires a GPU (dedicated or integrated) to run the language model.',
      })
      return
    }

    let preferredName: LlmProfileName
    if (this.selectedChoice === 'auto') {
      // Tier marker ( install-time choice , or `pnpm dev --lite` via LOKLM_TIER )
      // is AUTHORITATIVE when its GGUF is on disk — otherwise fall back to the
      // hardware heuristic. Shared with the settings UI ( recommendedProfileFrom
      // Cache ) so the recommended label and the actually-loaded model agree.
      // Previously this called planner.pickProfile() directly, which is purely
      // VRAM/RAM-driven and ignored the tier — so `--lite` still loaded the
      // largest model that fit ( an 8B under a lite install ).
      preferredName = this.recommendedProfileFromCache(profiles)
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
    // Pin the tier + model before building the prompt so the verbosity depth
    // matches the model being loaded ( 4B → 'standard', 2B fallback → 'concise' ;
    // and so a later setLanguage rebuilds at the same depth ).
    this.activeProfile = profile?.name ?? null
    this.activeModelPath = modelPath
    const envOverride = parsePositiveInt(process.env['LOKLM_LLM_CONTEXT_SIZE'])
    // Tier-aware context target (TIER_CONTEXT_TARGET): lite hard-caps at 8K
    // (iGPU — a giant KV cache + a packer-filled prompt means minutes of
    // prefill or an OOM), standard aims 32K, pro 64K. planLlm clamps the final
    // context to this value, so it bounds the plan regardless of how the
    // profile resolved (a persisted 'full' llmProfile would otherwise win) or
    // what "Auto" sizes to. No-marker installs (dev/test/pre-0.3.0) keep the
    // profile's native window — the legacy behaviour.
    const tier = getEffectiveTier()
    const baseDefaultContext = profile?.contextSize ?? 32768
    const profileDefaultContext = tier
      ? Math.min(baseDefaultContext, TIER_CONTEXT_TARGET[tier])
      : baseDefaultContext
    try {
      const result = await this.client!.llmLoad({
        modelPath,
        profileName: profile?.name ?? null,
        profileDefaultContext,
        weightsBytes: ggufWeightBytes(modelPath),
        userContextChoice: this.selectedContext,
        device: this.devicePlan,
        language: this.language,
        envContextOverride: envOverride,
        systemPrompt: buildSystemPrompt(this.language, this.effectiveDepth(), {
          codebase: this.codebaseMode,
        }),
      })
      this.lastPlan = result.plan
      // Surface WHY auto picked this window ("manual 8192-tok context" vs
      // "auto: sized to free memory …") — the one line that turns a
      // too-small-context report from guesswork into a diagnosis.
      // eslint-disable-next-line no-console
      console.log(
        `[llm] context plan (tier=${tier ?? 'none'}, target=${profileDefaultContext}): ${result.plan.reason}`,
      )
      this.lastResources = result.resources
      this.gpuLabel = result.gpuLabel
      this.resolvedPlacement = result.resolvedPlacement
      this.placementReason = result.placementReason
      this.resolvedGpuName = result.gpuName
      this.resolvedGpuKind = result.gpuKind
      this.pinnedDeviceVerified = result.pinnedDeviceVerified
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
      const promptBody = buildPrompt(
        question,
        hits,
        history,
        this.language,
        opts.pinnedHits,
        opts.contextPreamble,
      )
      // noThink: the system prompt already ends in /no_think, but this GGUF
      // honours the tag unreliably — the segment budget is the switch that
      // actually sticks (mirrors the quiz path). Without it the model can
      // spend hundreds of decode-tokens inside <think>…</think>, which the
      // ThinkFilter hides — so the renderer's "prefill" stage stays open and
      // bills all that thinking time to prefill.
      const { raw } = await client.llmAsk({
        streamId,
        question,
        prompt: promptBody,
        maxTokens,
        noThink: true,
      })
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

    // Turn a raw generation into the final answer, NEVER a silent blank. The
    // lite 2B GGUF (whose vocab is "missing newline token") sometimes ignores
    // /no_think and emits a pure or UNCLOSED <think> block: the streaming
    // ThinkFilter then swallows every chunk (zero tokens reach the renderer) and
    // stripThink — which only matches CLOSED <think>…</think> — returns '' or the
    // literal tag. Left alone that produces an empty turn that the main process
    // doesn't persist and the renderer wipes on re-sync (the invisible blank).
    // Recover: strip any surviving (unclosed) think tag and keep its content
    // (usually the model's actual answer); if nothing usable remains, render the
    // retrieved Context as the answer. Re-emit via onChunk when the stream was
    // empty so the recovered text both renders and persists.
    const finalize = async (raw: string): Promise<string> => {
      let text = stripThink(raw).trim()
      if (text.includes('<think')) text = text.replace(/<\/?think>/g, '').trim()
      if (!text) return this.askFallback(question, hits, opts)
      if (accumulated.trim() === '' && opts.onChunk) {
        for (const piece of chunkifyForStream(text)) opts.onChunk(piece, 1)
      }
      return text
    }
    try {
      try {
        const raw = await runOnce(opts.conversationHistory)
        return await finalize(raw)
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
        return await finalize(raw)
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
    // Pinned hits are part of what the user expects the model to "see" — list
    // them in the fallback snippet view too, ahead of the ranked RAG hits.
    const allHits =
      opts.pinnedHits && opts.pinnedHits.length > 0 ? [...opts.pinnedHits, ...hits] : hits
    const out = renderFallback(question, allHits, this.language)
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

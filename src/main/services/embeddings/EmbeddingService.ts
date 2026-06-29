import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ResourcePlanner,
  ggufWeightBytes,
  type PlacementChoice,
  type Placement,
} from './ResourcePlanner'
import { getModelSearchDirs, resolveModelFile } from '../models/paths'
import {
  CODE_EMBEDDER_FILE,
  CODE_EMBEDDER_IDENTITY,
  CODE_QUERY_INSTRUCTION,
  DOC_QUERY_INSTRUCTION,
  isCodeEmbedderFile,
} from '../codebase/codeEmbedder'
import { isCodebaseIndexingEnabled } from '../tier/TierMarker'
import type { ModelsWorkerClient } from '../workers/ModelsWorkerClient'
import { EmbedderSidecar } from './EmbedderSidecar'
import { isPytorchEmbedderEnabled, pytorchEmbedderConfig } from './pytorchEmbedderGate'

export const BUNDLED_EMBEDDER_FILE = 'bge-m3-Q4_K_M.gguf'
export const EMBEDDING_DIM = 1024
/**
 * Identity string written to chunks.embedder_identity for vectors produced by
 * the bundled BGE-M3 embedder. Must match the DEFAULT on that column so
 * existing rows keep round-tripping cleanly when the provider layer is wired
 * up. Update both together if the bundled embedder ever changes.
 */
export const BUNDLED_EMBEDDER_IDENTITY = 'bundled:bge-m3'

/**
 * Normalises an embedder identity string down to the underlying model stem so
 * the backfill can tell "bundled bge-m3" and "ollama bge-m3" apart from a real
 * model swap. Two identities with the same stem produce vectors in the same
 * semantic space — different quantisations of BGE-M3 still cosine-match at
 * >0.99 — so we keep the existing vectors and skip the re-embed.
 *
 *   bundled:bge-m3                            → bge-m3
 *   ollama:hf.co/lm-kit/bge-m3-gguf:Q4_K_M    → bge-m3
 *   ollama:nomic-embed-text                   → nomic-embed-text
 *   ollama:nomic-embed-text:latest            → nomic-embed-text
 *   ollama:mxbai-embed-large:f16              → mxbai-embed-large
 */
export function embedderModelStem(identity: string): string {
  // Strip provider prefix (bundled:/ollama:); leave bare model strings as-is.
  const afterPrefix = identity.replace(/^(bundled|ollama):/, '')
  // For HF-style paths (hf.co/owner/repo:tag) take the last path component.
  const lastSegment = afterPrefix.split('/').pop() ?? afterPrefix
  // Drop the trailing :TAG (quant / version marker) and any -gguf suffix.
  const noTag = lastSegment.split(':')[0] ?? lastSegment
  return noTag.toLowerCase().replace(/-gguf$/i, '')
}

// /jina/ keeps a leftover jina-code GGUF from ever being picked as the DOC
// embedder: it is no longer matched by isCodeEmbedderFile (the code embedder is
// Qwen3-Embedding now), and it native-crashes on the iGPU Vulkan, so it must
// never load. /qwen/ keeps Qwen3-Embedding out of the doc-embedder pool too — it
// is resolved separately as the code embedder via resolveCodeEmbedderPath.
const NON_EMBEDDER_PATTERNS = [
  /qwen/i,
  /jina/i,
  /llama/i,
  /mistral/i,
  /phi/i,
  /gemma/i,
  /reranker/i,
]

import type { EmbedderState, EmbedderStatus, EmbedderInfo } from '../../../shared/documents'
export type { EmbedderState, EmbedderStatus, EmbedderInfo }

// Passages/documents embed raw (matches the corpus that's already on disk — so
// the query-side instruction below needs NO re-embed). The query instruction is
// resolved per-model in queryInstruction(): the code embedder (Qwen3) gets its
// asymmetric Instruct/Query template; BGE-M3 gets none (it isn't instruction-tuned).
const PASSAGE_PREFIX = ''
const EMBED_CONTEXT_SIZE = 2048
const SANITIZE_MAX_CHARS = 6000
// Inputs the sidecar mini-batches per forward pass. 64 is near the throughput
// sweet spot measured on a 5090 (peak ~74k tok/s at batch 16-64, 2026-06-29).
const SIDECAR_BATCH = 64

export function bundledEmbedderPath(): string {
  return join(getModelSearchDirs()[0]!, BUNDLED_EMBEDDER_FILE)
}

// TTL-cached because info() / isAvailable() are called from IPC status polls
// — the directory walk used to run on every renderer status query.
let resolvedEmbedderPathCache: { value: string | null; at: number } | null = null
const EMBEDDER_PATH_TTL_MS = 5000

export function resolveEmbedderPath(): string | null {
  if (
    resolvedEmbedderPathCache &&
    Date.now() - resolvedEmbedderPathCache.at < EMBEDDER_PATH_TTL_MS
  ) {
    return resolvedEmbedderPathCache.value
  }
  const value = resolveEmbedderPathUncached()
  resolvedEmbedderPathCache = { value, at: Date.now() }
  return value
}

function resolveEmbedderPathUncached(): string | null {
  const override = process.env['LOKLM_EMBEDDER_PATH']
  if (override && existsSync(override)) return override

  const canonical = resolveModelFile(BUNDLED_EMBEDDER_FILE)
  if (canonical) return canonical

  for (const dir of getModelSearchDirs()) {
    if (!existsSync(dir)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    const candidates = entries
      .filter((f) => f.toLowerCase().endsWith('.gguf'))
      .filter((f) => /embed/i.test(f))
      .filter((f) => !NON_EMBEDDER_PATTERNS.some((re) => re.test(f)))
      .filter((f) => !isCodeEmbedderFile(f)) // the code model is resolved separately
      .sort()
    if (candidates.length > 0) return join(dir, candidates[0]!)
  }
  return null
}

/** Resolves the code-specialised embedder GGUF (jina-code), or null when it
 *  isn't on disk — in which case codebase workspaces fall back to BGE-M3
 *  (ADR-0006). */
export function resolveCodeEmbedderPath(): string | null {
  const canonical = resolveModelFile(CODE_EMBEDDER_FILE)
  if (canonical) return canonical
  for (const dir of getModelSearchDirs()) {
    if (!existsSync(dir)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    const hit = entries.filter(isCodeEmbedderFile).sort()[0]
    if (hit) return join(dir, hit)
  }
  return null
}

export class EmbeddingService {
  private status: EmbedderStatus = {
    kind: 'embedder',
    state: 'idle',
    modelPath: null,
    modelName: null,
    loadProgress: null,
    message: null,
    // ProviderRegistry overlays the live source in main/index.ts —
    // see composeEmbedderStatus / LlamaService comment for the same pattern.
    source: 'bundled',
  }
  private listeners: Array<(s: EmbedderStatus) => void> = []
  private loadPromise: Promise<void> | null = null
  private placement: PlacementChoice = 'cpu'
  private lastResolvedPlacement: Placement | null = null
  private lastReason: string | null = null
  private planner: ResourcePlanner
  private client: ModelsWorkerClient | null
  // Path of the GGUF actually loaded (drives activeIdentity + swap detection).
  private loadedPath: string | null = null
  // PyTorch embedding sidecar (Pro/NVIDIA, see pytorchEmbedderGate). When active
  // it owns embedding and the node-llama-cpp embedder is never loaded (saves
  // VRAM). On any failure — start or mid-session — sidecarFailed latches and we
  // transparently fall back to the llama.cpp path for the rest of the session.
  private sidecar: EmbedderSidecar | null = null
  private sidecarActive = false
  private sidecarFailed = false
  private sidecarStartPromise: Promise<void> | null = null

  constructor(opts: { planner?: ResourcePlanner; client?: ModelsWorkerClient } = {}) {
    this.planner = opts.planner ?? new ResourcePlanner()
    this.client = opts.client ?? null
    if (this.client) {
      this.client.setStatusListener('embedder', (patch) => {
        this.setStatus(patch as Partial<EmbedderStatus>)
      })
    }
  }

  setPlacement(p: PlacementChoice): void {
    this.placement = p
  }

  getPlacement(): PlacementChoice {
    return this.placement
  }

  resolvedPlacement(): Placement | null {
    return this.lastResolvedPlacement
  }

  subscribe(cb: (s: EmbedderStatus) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  private setStatus(patch: Partial<EmbedderStatus>): void {
    // Short-circuit identity patches — worker pushes the same status object
    // multiple times during load (progress ticks) and the renderer treats
    // every fan-out as a re-render.
    let changed = false
    for (const k of Object.keys(patch) as Array<keyof EmbedderStatus>) {
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
        /* ignore */
      }
    }
  }

  getStatus(): EmbedderStatus {
    return this.status
  }

  info(): EmbedderInfo {
    const resolved = resolveEmbedderPath()
    return {
      ...this.status,
      bundledModelPath: resolved ?? bundledEmbedderPath(),
      bundledModelExists: resolved !== null,
      resolvedPlacement: this.lastResolvedPlacement,
      placementChoice: this.placement,
      placementReason: this.lastReason,
    }
  }

  isReady(): boolean {
    return this.status.state === 'ready'
  }

  isAvailable(): boolean {
    return this.resolveTargetPath() !== null || this.isReady()
  }

  /** Identity of the currently-loaded bundled embedder — code (Qwen3) vs doc
   *  (BGE-M3) model — so chunks get the right embedder_identity for model-swap
   *  detection. Reflects the model actually resident, not the tier intent. */
  activeIdentity(): string {
    // The sidecar embeds with Qwen3-Embedding (same model as the resident code
    // embedder); fp16 vs Q8 cosine-match >0.99, so it shares the code identity
    // and its vectors live in the same space as existing node-llama-cpp ones.
    if (this.sidecarActive) return CODE_EMBEDDER_IDENTITY
    return this.loadedPath && isCodeEmbedderFile(this.loadedPath)
      ? CODE_EMBEDDER_IDENTITY
      : BUNDLED_EMBEDDER_IDENTITY
  }

  /** Single-embedder-per-tier (chosen 2026-06-26): the resident embedder is fixed
   *  by install tier, NOT swapped per workspace. Standard/Pro (and dev/no-marker
   *  → full access) load Qwen3-Embedding and use it for EVERY workspace (library +
   *  codebase); Lite loads BGE-M3 only. Fallback-safe: if the Qwen GGUF isn't on
   *  disk we transparently use BGE-M3, so search still works. No runtime swap ⇒
   *  no model-reload churn and only one embedder model is ever resident. */
  private resolveTargetPath(): string | null {
    if (isCodebaseIndexingEnabled()) {
      const code = resolveCodeEmbedderPath()
      if (code) return code
    }
    return resolveEmbedderPath()
  }

  async ensureReady(): Promise<boolean> {
    if (this.sidecarActive) return true
    // Pro/NVIDIA: prefer the PyTorch sidecar (~12x throughput). On any failure
    // sidecarFailed latches and we drop to the node-llama-cpp embedder below.
    if (!this.sidecarFailed && isPytorchEmbedderEnabled()) {
      if (await this.ensureSidecar()) return true
    }
    return this.ensureLlamaEmbedder()
  }

  /** The original node-llama-cpp embedder load path. Used directly on Lite/
   *  Standard/non-NVIDIA, and as the fallback when the sidecar is unavailable. */
  private async ensureLlamaEmbedder(): Promise<boolean> {
    if (!this.sidecarActive && this.isReady()) return true
    if (this.loadPromise) {
      try {
        await this.loadPromise
      } catch {
        /* status reflects failure */
      }
      return this.isReady()
    }
    const path = this.resolveTargetPath()
    if (!path) {
      const expected = bundledEmbedderPath()
      this.setStatus({
        state: 'failed',
        modelPath: expected,
        modelName: BUNDLED_EMBEDDER_FILE,
        message: `No embedder GGUF found in ${getModelSearchDirs()[0]}. Drop a *embed*.gguf file there (e.g. ${BUNDLED_EMBEDDER_FILE}, arctic-embed-l, multilingual-e5-large). Vector search disabled — keyword search still works.`,
      })
      return false
    }
    this.loadPromise = this.loadModel(path).finally(() => {
      this.loadPromise = null
    })
    try {
      await this.loadPromise
    } catch {
      /* status already updated */
    }
    return this.isReady()
  }

  /** Lazily spawn + warm the PyTorch sidecar. Returns whether it's active.
   *  Concurrent callers share one start; a failed start latches sidecarFailed. */
  private async ensureSidecar(): Promise<boolean> {
    if (this.sidecarActive) return true
    if (this.sidecarFailed) return false
    if (!this.sidecarStartPromise) {
      this.sidecarStartPromise = this.startSidecar().finally(() => {
        this.sidecarStartPromise = null
      })
    }
    try {
      await this.sidecarStartPromise
    } catch {
      /* sidecarFailed already set in startSidecar */
    }
    return this.sidecarActive
  }

  private async startSidecar(): Promise<void> {
    const cfg = pytorchEmbedderConfig()
    if (!cfg) {
      this.sidecarFailed = true
      return
    }
    this.setStatus({
      state: 'loading',
      source: 'bundled',
      modelName: cfg.model.split('/').pop() ?? cfg.model,
      modelPath: cfg.model,
      message: 'Starting PyTorch embedder…',
      loadProgress: 0,
    })
    const sc = new EmbedderSidecar({
      ...cfg,
      events: {
        // eslint-disable-next-line no-console
        onLog: (l) => console.log('[embed-sidecar]', l),
        onStateChange: (s, d) => {
          if (s === 'exited') this.onSidecarExit(d)
        },
      },
    })
    this.sidecar = sc
    try {
      await sc.start()
      this.sidecarActive = true
      this.lastResolvedPlacement = 'gpu'
      this.lastReason = `PyTorch sidecar (${cfg.model}, cuda:${cfg.cudaDeviceIndex ?? 0})`
      this.setStatus({ state: 'ready', loadProgress: null, message: 'PyTorch embedder ready.' })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[embedder] PyTorch sidecar failed to start, using llama.cpp:', err)
      this.sidecarFailed = true
      this.sidecar = null
      // Don't leave a 'failed' status — ensureLlamaEmbedder will set the real one.
      this.setStatus({ state: 'idle', loadProgress: null, message: null })
    }
  }

  /** The sidecar process died (crash / OOM / disposed). Latch off so further
   *  embeds fall back to llama.cpp rather than thrashing restarts. */
  private onSidecarExit(detail?: string): void {
    if (this.sidecarActive) {
      // eslint-disable-next-line no-console
      console.warn('[embedder] PyTorch sidecar exited:', detail)
    }
    this.sidecarActive = false
    this.sidecar = null
    this.sidecarFailed = true
  }

  async loadModel(modelPath: string): Promise<void> {
    if (!this.client) {
      throw new Error(
        'EmbeddingService.loadModel requires a ModelsWorkerClient (in-process loads are gone).',
      )
    }
    try {
      const result = await this.client.embedderLoad({
        modelPath,
        placement: this.placement,
        weightsBytes: ggufWeightBytes(modelPath),
        contextSize: EMBED_CONTEXT_SIZE,
      })
      this.lastResolvedPlacement = result.resolvedPlacement
      this.lastReason = result.reason
      this.loadedPath = modelPath
      void result.resources
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus({ state: 'failed', loadProgress: null, message: msg })
      throw err
    }
  }

  async unload(): Promise<void> {
    if (this.sidecar) {
      try {
        await this.sidecar.dispose()
      } catch {
        /* exiting anyway */
      }
      this.sidecar = null
      this.sidecarActive = false
    }
    if (this.client) {
      try {
        await this.client.embedderUnload()
      } catch {
        /* worker status push reflects reality */
      }
    }
  }

  /** Query-side instruction for the resident embedder (ADR-0006, fix #1). The
   *  code model (Qwen3) is instruction-tuned and wants the asymmetric
   *  Instruct/Query template — the code instruction for a codebase query, the
   *  document instruction for a library query (Qwen serves BOTH on Standard/Pro,
   *  single-embedder-per-tier). BGE-M3 (Lite) gets none — empty string ⇒ query
   *  embeds exactly like a passage (the legacy behaviour, still correct for BGE). */
  private queryInstruction(codebase: boolean): string {
    if (this.activeIdentity() !== CODE_EMBEDDER_IDENTITY) return ''
    return codebase ? CODE_QUERY_INSTRUCTION : DOC_QUERY_INSTRUCTION
  }

  async embedQuery(text: string, opts: { codebase?: boolean } = {}): Promise<number[] | null> {
    const out = await this.embedQueries([text], opts)
    return out[0] ?? null
  }

  /** Batch query embedding WITH the model-appropriate query instruction. The
   *  retrieval hot path uses this (via the provider's embedQuery) so a natural-
   *  language question aligns with the raw passages. `opts.codebase` selects the
   *  code vs document instruction for the Qwen model. Mirrors embedPassages'
   *  null-on-empty contract. */
  async embedQueries(
    texts: string[],
    opts: { codebase?: boolean } = {},
  ): Promise<Array<number[] | null>> {
    if (texts.length === 0) return []
    if (!(await this.ensureReady())) return texts.map(() => null)
    const instruction = this.queryInstruction(opts.codebase ?? false)
    const prepared = texts.map((raw) => {
      const cleaned = sanitize(raw)
      return cleaned.length === 0 ? '' : instruction + cleaned
    })
    return this.runEmbed(prepared)
  }

  async embedPassages(texts: string[]): Promise<Array<number[] | null>> {
    if (texts.length === 0) return []
    if (!(await this.ensureReady())) return texts.map(() => null)
    const prepared = texts.map((raw) => {
      const cleaned = sanitize(raw)
      return cleaned.length === 0 ? '' : PASSAGE_PREFIX + cleaned
    })
    return this.runEmbed(prepared)
  }

  /** Route a prepared batch to the active backend. Sidecar first when active;
   *  on a sidecar error, latch it off, warm the llama.cpp embedder, and retry
   *  there so a mid-session sidecar crash never drops vectors silently. */
  private async runEmbed(prepared: string[]): Promise<Array<number[] | null>> {
    if (this.sidecarActive && this.sidecar) {
      try {
        return await this.sidecar.embed(prepared, SIDECAR_BATCH)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[embedder] sidecar embed failed, falling back to llama.cpp:', err)
        this.failSidecar()
        if (!(await this.ensureLlamaEmbedder())) return prepared.map(() => null)
      }
    }
    if (!this.client) return prepared.map(() => null)
    try {
      return await this.client.embedderEmbed(prepared)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[embedder] embed failed:', err)
      return prepared.map(() => null)
    }
  }

  private failSidecar(): void {
    const sc = this.sidecar
    this.sidecarActive = false
    this.sidecar = null
    this.sidecarFailed = true
    if (sc) void sc.dispose().catch(() => {})
  }
}

// ---------------------------------------------------------------------------

function sanitize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, SANITIZE_MAX_CHARS)
}

import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import {
  ResourcePlanner,
  ggufWeightBytes,
  type Placement,
  type PlacementChoice,
} from '../embeddings/ResourcePlanner'

/**
 * Cross-encoder reranker on top of BM25 + dense retrieval. Pipeline:
 *   1. RetrievalService gathers top-K with RRF fusion (cheap)
 *   2. RerankerService scores each (query, chunk) pair (expensive but sharp)
 *   3. Caller takes the top-N reranked hits
 *
 * Lifecycle mirrors EmbeddingService — lazy-load on first use, idempotent
 * `ensureReady`, optional (degrades silently to "no rerank" if the model
 * file is missing). Same pattern keeps the surfacing in ModelStatusBanner
 * uniform.
 */
export const BUNDLED_RERANKER_FILE = 'bge-reranker-v2-m3-Q4_K_M.gguf'

const NON_RERANKER_PATTERNS = [/qwen/i, /llama/i, /mistral/i, /phi/i, /gemma/i, /embed/i]

// RerankerState / RerankerStatus / RerankerInfo are the canonical shapes that
// also travel over IPC to the renderer. Single source of truth lives in
// src/shared/documents.ts so renderer + preload + service all agree.
import type { RerankerState, RerankerStatus, RerankerInfo } from '../../../shared/documents'
export type { RerankerState, RerankerStatus, RerankerInfo }
// Placement / PlacementChoice are kept locally re-exported from ResourcePlanner
// — they're not renderer-visible so no need to push to shared.
export type { Placement, PlacementChoice }

const RERANK_CONTEXT_SIZE = 1024

function modelsDir(): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(root, 'models')
}

export function bundledRerankerPath(): string {
  return join(modelsDir(), BUNDLED_RERANKER_FILE)
}

/** Resolve a reranker GGUF on disk. Returns null when none is present. */
export function resolveRerankerPath(): string | null {
  const override = process.env.LOKLM_RERANKER_PATH
  if (override && existsSync(override)) return override
  const preferred = bundledRerankerPath()
  if (existsSync(preferred)) return preferred
  const dir = modelsDir()
  if (!existsSync(dir)) return null
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  const candidates = entries
    .filter((f) => f.toLowerCase().endsWith('.gguf'))
    .filter((f) => /reranker/i.test(f))
    .filter((f) => !NON_RERANKER_PATTERNS.some((re) => re.test(f)))
    .sort()
  if (candidates.length === 0) return null
  return join(dir, candidates[0]!)
}

export class RerankerService {
  private model: unknown = null
  private context: unknown = null
  private status: RerankerStatus = {
    kind: 'reranker',
    state: 'idle',
    modelPath: null,
    modelName: null,
    loadProgress: null,
    message: null,
  }
  private listeners: Array<(s: RerankerStatus) => void> = []
  private loadPromise: Promise<void> | null = null
  private placement: PlacementChoice = 'auto'
  private lastResolvedPlacement: Placement | null = null
  private lastReason: string | null = null

  constructor(private planner: ResourcePlanner = new ResourcePlanner()) {}

  setPlacement(p: PlacementChoice): void {
    this.placement = p
  }

  getPlacement(): PlacementChoice {
    return this.placement
  }

  resolvedPlacement(): Placement | null {
    return this.lastResolvedPlacement
  }

  getStatus(): RerankerStatus {
    return this.status
  }

  subscribe(cb: (s: RerankerStatus) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  private setStatus(patch: Partial<RerankerStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const l of this.listeners) {
      try {
        l(this.status)
      } catch {
        /* ignore */
      }
    }
  }

  info(): RerankerInfo {
    const resolved = resolveRerankerPath()
    return {
      ...this.status,
      bundledModelPath: resolved ?? bundledRerankerPath(),
      bundledModelExists: resolved !== null,
      resolvedPlacement: this.lastResolvedPlacement,
      placementChoice: this.placement,
      placementReason: this.lastReason,
    }
  }

  isReady(): boolean {
    return this.status.state === 'ready' && this.context !== null
  }

  isAvailable(): boolean {
    return resolveRerankerPath() !== null || this.isReady()
  }

  async ensureReady(): Promise<boolean> {
    if (this.isReady()) return true
    if (this.loadPromise) {
      try {
        await this.loadPromise
      } catch {
        /* status reflects failure */
      }
      return this.isReady()
    }
    const path = resolveRerankerPath()
    if (!path) {
      this.setStatus({
        state: 'failed',
        modelPath: bundledRerankerPath(),
        modelName: BUNDLED_RERANKER_FILE,
        message:
          `No reranker GGUF found in ${modelsDir()}. Drop a *reranker*.gguf there ` +
          `(e.g. ${BUNDLED_RERANKER_FILE}). Reranking disabled — RRF retrieval still works.`,
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

  async loadModel(modelPath: string): Promise<void> {
    await this.unload()
    this.setStatus({
      state: 'loading',
      modelPath,
      modelName: modelPath.split(/[\\/]/).pop() ?? BUNDLED_RERANKER_FILE,
      loadProgress: 0,
      message: 'Initialising reranker backend…',
    })
    try {
      const resources = await this.planner.refresh()
      const weightsBytes = ggufWeightBytes(modelPath)
      const plan = this.planner.planAux({
        weightsBytes,
        resources,
        userChoice: this.placement,
        estimatedFreeVramGB: resources.freeVramGB,
      })
      this.lastResolvedPlacement = plan.placement
      this.lastReason = plan.reason

      const lib = await import('node-llama-cpp')
      const llama = await initLlamaForReranking(
        lib,
        (msg) => this.setStatus({ message: msg }),
        plan.placement === 'cpu',
      )
      this.setStatus({
        message: `Loading reranker weights (${plan.placement}: ${plan.reason})…`,
      })
      const model = await llama.loadModel({
        modelPath,
        onLoadProgress: (p: number) => this.setStatus({ loadProgress: p }),
      })
      this.setStatus({ message: 'Creating ranking context…', loadProgress: 1 })
      const context = await (
        model as {
          createRankingContext: (opts?: { contextSize?: number }) => Promise<unknown>
        }
      ).createRankingContext({ contextSize: RERANK_CONTEXT_SIZE })
      this.model = model
      this.context = context
      this.setStatus({ state: 'ready', loadProgress: null, message: 'Reranker ready.' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.unload()
      this.setStatus({ state: 'failed', loadProgress: null, message: msg })
      throw err
    }
  }

  async unload(): Promise<void> {
    try {
      if (this.context && hasDispose(this.context)) await this.context.dispose()
      if (this.model && hasDispose(this.model)) await this.model.dispose()
    } catch {
      /* ignore */
    }
    this.context = null
    this.model = null
    if (this.status.state === 'ready') {
      this.setStatus({ state: 'unloaded', message: 'Reranker unloaded.' })
    }
  }

  /**
   * Score N (query, document) pairs in one pass. Returns a parallel array of
   * scores in [0,1]; on failure (or when the reranker is unavailable) returns
   * null so the caller can fall back to the original RRF order without a
   * second code path.
   */
  async rank(query: string, documents: string[]): Promise<number[] | null> {
    if (documents.length === 0) return []
    if (!(await this.ensureReady())) return null
    try {
      const ctx = this.context as {
        rankAll: (q: string, docs: string[]) => Promise<number[]>
      }
      const scores = await ctx.rankAll(query, documents)
      return Array.from(scores)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[reranker] rank failed, falling back to RRF order:', err)
      return null
    }
  }
}

// ---------------------------------------------------------------------------

function hasDispose(o: unknown): o is { dispose: () => Promise<void> } {
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof (o as { dispose?: unknown }).dispose === 'function'
  )
}

async function initLlamaForReranking(
  lib: typeof import('node-llama-cpp'),
  onMessage: (msg: string) => void,
  forceCpu: boolean,
): Promise<Awaited<ReturnType<typeof import('node-llama-cpp').getLlama>>> {
  const pinned = (process.env.LLAMA_GPU ?? '').toLowerCase()
  type Gpu = 'cuda' | 'vulkan' | 'metal' | 'auto' | false
  const order: Gpu[] = (() => {
    if (pinned === 'cpu' || pinned === 'false') return [false]
    if (pinned === 'cuda' || pinned === 'vulkan' || pinned === 'metal') return [pinned, 'auto']
    if (forceCpu) return [false]
    return ['auto']
  })()
  let lastErr: unknown = null
  for (const gpu of order) {
    try {
      onMessage(`Initialising reranker backend (${gpu === false ? 'cpu' : gpu})…`)
      return await lib.getLlama({ gpu })
    } catch (err) {
      lastErr = err
      // eslint-disable-next-line no-console
      console.warn(`[reranker] ${gpu} init failed, trying next:`, err)
    }
  }
  throw lastErr ?? new Error('No backend could be initialised for the reranker')
}

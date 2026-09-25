import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ResourcePlanner,
  ggufWeightBytes,
  type Placement,
  type PlacementChoice,
} from '../embeddings/ResourcePlanner'
import { getModelSearchDirs, resolveModelFile } from '../models/paths'
import type { ModelsWorkerClient } from '../workers/ModelsWorkerClient'
import {
  assessRerankerPolicy,
  describeRerankerDecision,
  type RerankerDecision,
  type RerankerPolicy,
} from '../../../shared/modelCapabilities'

export const BUNDLED_RERANKER_FILE = 'bge-reranker-v2-m3-Q4_K_M.gguf'

const NON_RERANKER_PATTERNS = [/qwen/i, /llama/i, /mistral/i, /phi/i, /gemma/i, /embed/i]

import type { RerankerState, RerankerStatus, RerankerInfo } from '../../../shared/documents'
export type { RerankerState, RerankerStatus, RerankerInfo }
export type { Placement, PlacementChoice }

const RERANK_CONTEXT_SIZE = 1024

export function bundledRerankerPath(): string {
  return join(getModelSearchDirs()[0]!, BUNDLED_RERANKER_FILE)
}

// TTL-cached because status() / info() hit the directory walk on every IPC
// status poll. Same pattern as resolveEmbedderPath.
let resolvedRerankerPathCache: { value: string | null; at: number } | null = null
const RERANKER_PATH_TTL_MS = 5000

export function resolveRerankerPath(): string | null {
  if (
    resolvedRerankerPathCache &&
    Date.now() - resolvedRerankerPathCache.at < RERANKER_PATH_TTL_MS
  ) {
    return resolvedRerankerPathCache.value
  }
  const value = resolveRerankerPathUncached()
  resolvedRerankerPathCache = { value, at: Date.now() }
  return value
}

function resolveRerankerPathUncached(): string | null {
  const override = process.env['LOKLM_RERANKER_PATH']
  if (override && existsSync(override)) return override

  const canonical = resolveModelFile(BUNDLED_RERANKER_FILE)
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
      .filter((f) => /reranker/i.test(f))
      .filter((f) => !NON_RERANKER_PATTERNS.some((re) => re.test(f)))
      .sort()
    if (candidates.length > 0) return join(dir, candidates[0]!)
  }
  return null
}

export class RerankerService {
  private status: RerankerStatus = {
    kind: 'reranker',
    state: 'idle',
    modelPath: null,
    modelName: null,
    loadProgress: null,
    message: null,
    // ProviderRegistry overlays the live source in main/index.ts —
    // see composeRerankerStatus.
    source: 'bundled',
  }
  private listeners: Array<(s: RerankerStatus) => void> = []
  private loadPromise: Promise<void> | null = null
  private placement: PlacementChoice = 'auto'
  private lastResolvedPlacement: Placement | null = null
  private lastReason: string | null = null
  private planner: ResourcePlanner
  private client: ModelsWorkerClient | null
  private policy = {
    enabled: true,
    mode: 'auto' as RerankerPolicy,
    source: 'bundled' as 'bundled' | 'ollama',
  }
  private policyDecision: RerankerDecision = assessRerankerPolicy({
    ...this.policy,
    resources: null,
  })
  private policyRevision = 0

  constructor(opts: { planner?: ResourcePlanner; client?: ModelsWorkerClient } = {}) {
    this.planner = opts.planner ?? new ResourcePlanner()
    this.client = opts.client ?? null
    if (this.client) {
      this.client.setStatusListener('reranker', (patch) => {
        // A native load already in flight may finish after settings changed.
        // Never advertise that now-disabled model as available to retrieval.
        if (!this.bundledAllowed() && patch.state === 'ready') return
        this.setStatus(patch as Partial<RerankerStatus>)
      })
    }
  }

  setPlacement(p: PlacementChoice): void {
    this.placement = p === 'cpu' ? 'auto' : p
  }

  getPlacement(): PlacementChoice {
    return this.placement
  }

  async setPolicy(policy: typeof this.policy): Promise<void> {
    const wasConfigured =
      this.status.state === 'ready' || this.status.state === 'loading' || this.loadPromise !== null
    this.policy = { ...policy }
    const revision = ++this.policyRevision
    this.policyDecision = assessRerankerPolicy({ ...this.policy, resources: null })
    await this.refreshPolicy()
    if (revision !== this.policyRevision) return
    if (!this.bundledAllowed()) {
      // Wait for any outstanding native load before dropping its configuration.
      await this.loadPromise?.catch(() => undefined)
      if (revision !== this.policyRevision) return
      if (wasConfigured) await this.unload()
      this.publishPolicyStatus()
    }
  }

  private bundledAllowed(): boolean {
    return this.policy.source === 'bundled' && this.policyDecision.allowed
  }

  private publishPolicyStatus(): void {
    if (JSON.stringify(this.status.policyDecision) !== JSON.stringify(this.policyDecision)) {
      this.setStatus({ policyDecision: this.policyDecision })
    }
    if (this.bundledAllowed()) return
    this.lastResolvedPlacement = null
    this.lastReason = describeRerankerDecision(this.policyDecision)
    this.setStatus({
      state: 'unloaded',
      resident: false,
      loadProgress: null,
      message: this.lastReason,
    })
  }

  async refreshPolicy(): Promise<RerankerDecision> {
    const revision = this.policyRevision
    let resources: Awaited<ReturnType<ModelsWorkerClient['refreshResources']>> | null = null
    // Do not initialise a local GPU for an external provider or a disabled feature.
    if (this.policy.enabled && this.policy.source === 'bundled' && this.client) {
      try {
        resources = await this.client.refreshResources()
      } catch {
        // Unknown capability is reported honestly; never guess from system RAM.
      }
    }
    if (revision === this.policyRevision) {
      this.policyDecision = assessRerankerPolicy({ ...this.policy, resources })
      this.publishPolicyStatus()
    }
    return this.policyDecision
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
    let changed = false
    for (const k of Object.keys(patch) as Array<keyof RerankerStatus>) {
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

  info(): RerankerInfo {
    const resolved = resolveRerankerPath()
    return {
      ...this.status,
      bundledModelPath: resolved ?? bundledRerankerPath(),
      bundledModelExists: resolved !== null,
      resolvedPlacement: this.lastResolvedPlacement,
      placementChoice: this.placement,
      placementReason: this.lastReason,
      policyDecision: this.policyDecision,
    }
  }

  isReady(): boolean {
    return this.bundledAllowed() && this.status.state === 'ready'
  }

  isAvailable(): boolean {
    return this.bundledAllowed() && (resolveRerankerPath() !== null || this.isReady())
  }

  async ensureReady(): Promise<boolean> {
    await this.refreshPolicy()
    if (!this.bundledAllowed()) return false
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
      // An absent model is NOT an error — reranking is optional (the lite tier
      // ships without it) and RRF retrieval still works. Report the neutral
      // 'unloaded' state so the TitleBar dot renders grey, not the red 'failed'
      // we reserve for a model that IS present but fails to load (loadModel
      // catch below). 'failed' here painted a red "reranker broken" dot on lite.
      this.setStatus({
        state: 'unloaded',
        modelPath: bundledRerankerPath(),
        modelName: BUNDLED_RERANKER_FILE,
        message:
          `No reranker GGUF found in ${getModelSearchDirs()[0]}. Drop a *reranker*.gguf there ` +
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
    await this.refreshPolicy()
    if (!this.bundledAllowed()) return
    if (!this.client) {
      throw new Error(
        'RerankerService.loadModel requires a ModelsWorkerClient (in-process loads are gone).',
      )
    }
    try {
      const result = await this.client.rerankerLoad({
        modelPath,
        placement: this.placement,
        weightsBytes: ggufWeightBytes(modelPath),
        contextSize: RERANK_CONTEXT_SIZE,
        policy: this.policy.mode,
      })
      this.lastResolvedPlacement = result.resolvedPlacement
      this.lastReason = result.reason
      void result.resources
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus({ state: 'failed', loadProgress: null, message: msg })
      throw err
    }
  }

  async unload(): Promise<void> {
    if (this.client) {
      try {
        await this.client.rerankerUnload()
      } catch {
        /* worker status push reflects reality */
      }
    }
    this.setStatus({ state: 'unloaded', resident: false, loadProgress: null })
    this.publishPolicyStatus()
  }

  async rank(query: string, documents: string[]): Promise<number[] | null> {
    if (documents.length === 0) return []
    if (!(await this.ensureReady())) return null
    try {
      return await this.client!.rerankerRank(query, documents)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[reranker] rank failed:', err)
      return null
    }
  }
}

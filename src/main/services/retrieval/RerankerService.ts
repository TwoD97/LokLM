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

export const BUNDLED_RERANKER_FILE = 'bge-reranker-v2-m3-Q4_K_M.gguf'

const NON_RERANKER_PATTERNS = [/qwen/i, /llama/i, /mistral/i, /phi/i, /gemma/i, /embed/i]

import type { RerankerState, RerankerStatus, RerankerInfo } from '../../../shared/documents'
export type { RerankerState, RerankerStatus, RerankerInfo }
export type { Placement, PlacementChoice }

const RERANK_CONTEXT_SIZE = 1024

export function bundledRerankerPath(): string {
  return join(getModelSearchDirs()[0]!, BUNDLED_RERANKER_FILE)
}

export function resolveRerankerPath(): string | null {
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
  }
  private listeners: Array<(s: RerankerStatus) => void> = []
  private loadPromise: Promise<void> | null = null
  private placement: PlacementChoice = 'auto'
  private lastResolvedPlacement: Placement | null = null
  private lastReason: string | null = null
  private planner: ResourcePlanner
  private client: ModelsWorkerClient | null

  constructor(opts: { planner?: ResourcePlanner; client?: ModelsWorkerClient } = {}) {
    this.planner = opts.planner ?? new ResourcePlanner()
    this.client = opts.client ?? null
    if (this.client) {
      this.client.setStatusListener('reranker', (patch) => {
        this.setStatus(patch as Partial<RerankerStatus>)
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
    return this.status.state === 'ready'
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

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ResourcePlanner,
  ggufWeightBytes,
  type PlacementChoice,
  type Placement,
} from './ResourcePlanner'
import { getModelSearchDirs, resolveModelFile } from '../models/paths'
import type { ModelsWorkerClient } from '../workers/ModelsWorkerClient'

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

const NON_EMBEDDER_PATTERNS = [/qwen/i, /llama/i, /mistral/i, /phi/i, /gemma/i, /reranker/i]

import type { EmbedderState, EmbedderStatus, EmbedderInfo } from '../../../shared/documents'
export type { EmbedderState, EmbedderStatus, EmbedderInfo }

const QUERY_PREFIX = ''
const PASSAGE_PREFIX = ''
const EMBED_CONTEXT_SIZE = 2048
const SANITIZE_MAX_CHARS = 6000

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
      .sort()
    if (candidates.length > 0) return join(dir, candidates[0]!)
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
    return resolveEmbedderPath() !== null || this.isReady()
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
    const path = resolveEmbedderPath()
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
        await this.client.embedderUnload()
      } catch {
        /* worker status push reflects reality */
      }
    }
  }

  async embedQuery(text: string): Promise<number[] | null> {
    if (!(await this.ensureReady())) return null
    const cleaned = sanitize(text)
    if (cleaned.length === 0) return null
    try {
      const vecs = await this.client!.embedderEmbed([QUERY_PREFIX + cleaned])
      return vecs[0] ?? null
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[embedder] embedQuery failed:', err)
      return null
    }
  }

  async embedPassages(texts: string[]): Promise<Array<number[] | null>> {
    if (texts.length === 0) return []
    if (!(await this.ensureReady())) return texts.map(() => null)
    const prepared = texts.map((raw) => {
      const cleaned = sanitize(raw)
      return cleaned.length === 0 ? '' : PASSAGE_PREFIX + cleaned
    })
    try {
      return await this.client!.embedderEmbed(prepared)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[embedder] embedPassages failed:', err)
      return texts.map(() => null)
    }
  }
}

// ---------------------------------------------------------------------------

function sanitize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, SANITIZE_MAX_CHARS)
}

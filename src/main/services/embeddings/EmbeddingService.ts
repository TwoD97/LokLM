import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ResourcePlanner,
  ggufWeightBytes,
  type PlacementChoice,
  type Placement,
} from './ResourcePlanner'
import { getModelSearchDirs, resolveModelFile } from '../models/paths'

/**
 * Preferred filename — what we ship in the bundled installer if available.
 * Auto-discovery (see resolveEmbedderPath) falls back to any other file in
 * `models/` matching *embed*.gguf, so users can drop in alternative embedders
 * (arctic-embed-l, multilingual-e5-large, etc.) without code changes.
 */
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
 * Files in `models/` that are *not* embedders — excluded from auto-discovery
 * so we don't accidentally pick the LLM as the embedder.
 */
const NON_EMBEDDER_PATTERNS = [/qwen/i, /llama/i, /mistral/i, /phi/i, /gemma/i, /reranker/i]

// EmbedderState / EmbedderStatus / EmbedderInfo are the canonical shapes that
// also travel over IPC to the renderer. Single source of truth lives in
// src/shared/documents.ts so renderer + preload + service all agree.
import type { EmbedderState, EmbedderStatus, EmbedderInfo } from '../../../shared/documents'
export type { EmbedderState, EmbedderStatus, EmbedderInfo }

/**
 * BGE-M3 uses no prefix for either retrieval queries or passages (unlike
 * arctic-embed which wanted `query: ` on the query side). Keep these
 * constants colocated so the convention is obvious if we swap models —
 * e.g. arctic needs `QUERY_PREFIX = 'query: '`, e5 needs `'query: '` /
 * `'passage: '`.
 */
const QUERY_PREFIX = ''
const PASSAGE_PREFIX = ''

/**
 * Hard upper bound for tokens fed to the embedder per call. BGE-M3
 * supports 8192. The chunker emits ≤2000 chars (~500 tokens) for normal
 * paragraph text, but a single dense chunk in a Wochenbuch / table / code
 * block can tokenise to 1500+. 2048 tokens with the SANITIZE_MAX_CHARS cap
 * below means we never feed more than ~75% of the window — leaves room for
 * tokeniser surprises (umlauts, emoji, weird PDF residue) without silently
 * truncating useful text.
 */
const EMBED_CONTEXT_SIZE = 2048

/**
 * Truncation cap on input before tokenising. Conservative ratio: ~3 chars
 * per token for German + fat chunks, so 6 000 chars ≈ 2 000 tokens — sits
 * under the 2 048-token context with a safety margin. The original 8 000
 * regularly overflowed dense chunks ("Embedder returned no usable vectors"
 * during backfill).
 */
const SANITIZE_MAX_CHARS = 6000

export function bundledEmbedderPath(): string {
  // Returns the *primary* on-disk location of the canonical embedder file.
  // Used by status reporting; the real load path goes through
  // `resolveEmbedderPath()` which walks all search dirs.
  return join(getModelSearchDirs()[0]!, BUNDLED_EMBEDDER_FILE)
}

/**
 * Pick the embedder GGUF to load. Order of preference:
 *   1. $LOKLM_EMBEDDER_PATH if set (absolute override for power users)
 *   2. The canonical filename (BUNDLED_EMBEDDER_FILE) in any search dir
 *   3. Any other *embed*.gguf in any search dir (excluding obvious LLMs)
 * Returns null if nothing usable is on disk.
 */
export function resolveEmbedderPath(): string | null {
  const override = process.env.LOKLM_EMBEDDER_PATH
  if (override && existsSync(override)) return override

  const canonical = resolveModelFile(BUNDLED_EMBEDDER_FILE)
  if (canonical) return canonical

  // Fallback: any *embed*.gguf that isn't obviously an LLM. Walk each search
  // dir explicitly so a blocked match in dir 1 doesn't prevent dir 2 from
  // contributing a valid candidate.
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
  private model: unknown = null
  private context: unknown = null
  private status: EmbedderStatus = {
    kind: 'embedder',
    state: 'idle',
    modelPath: null,
    modelName: null,
    loadProgress: null,
    message: null,
  }
  private listeners: Array<(s: EmbedderStatus) => void> = []
  private loadPromise: Promise<void> | null = null
  // 'auto' lets ResourcePlanner decide based on free VRAM after the LLM
  // loads; 'cpu' / 'gpu' are manual overrides that bypass the planner.
  // Defaults to 'auto' so a fresh install gets the smart behavior; manual
  // settings always win once the user picks them.
  private placement: PlacementChoice = 'auto'
  /** Resolved placement of the most recent load. Surfaced for the UI. */
  private lastResolvedPlacement: Placement | null = null
  /** Reason string from the last planner decision — surfaced in status. */
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

  // ---- status / introspection ----

  subscribe(cb: (s: EmbedderStatus) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  private setStatus(patch: Partial<EmbedderStatus>): void {
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
    return this.status.state === 'ready' && this.context !== null
  }

  isAvailable(): boolean {
    // True iff a model file exists or is already loaded — false here means
    // callers should silently fall back to BM25-only paths.
    return resolveEmbedderPath() !== null || this.isReady()
  }

  // ---- lifecycle ----

  /**
   * Lazy load: idempotent, dedupes concurrent callers via loadPromise.
   * Returns true if ready after the call, false if model file missing or
   * load failed (caller should fall back to BM25-only).
   */
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
    await this.unload()
    this.setStatus({
      state: 'loading',
      modelPath,
      modelName: modelPath.split(/[\\/]/).pop() ?? BUNDLED_EMBEDDER_FILE,
      loadProgress: 0,
      message: 'Initialising embedder backend…',
    })

    try {
      // Decide CPU vs GPU before initing the backend. 'auto' consults the
      // planner against current free VRAM (which already accounts for the
      // LLM if it loaded first); 'cpu' / 'gpu' short-circuit.
      const resources = await this.planner.refresh()
      const weightsBytes = ggufWeightBytes(modelPath)
      const plan = this.planner.planAux({
        weightsBytes,
        resources,
        userChoice: this.placement,
        // freeVramGB already reflects whatever the LLM consumed earlier
        // because node-llama-cpp's getVramState reads the live driver.
        estimatedFreeVramGB: resources.freeVramGB,
      })
      this.lastResolvedPlacement = plan.placement
      this.lastReason = plan.reason

      const lib = await import('node-llama-cpp')
      const llama = await initLlamaForEmbedding(
        lib,
        (msg) => this.setStatus({ message: msg }),
        plan.placement === 'cpu',
      )
      this.setStatus({ message: `Loading embedder weights (${plan.placement}: ${plan.reason})…` })

      const model = await llama.loadModel({
        modelPath,
        onLoadProgress: (p: number) => this.setStatus({ loadProgress: p }),
      })
      this.setStatus({ message: 'Creating embedding context…', loadProgress: 1 })
      const context = await (
        model as {
          createEmbeddingContext: (opts?: { contextSize?: number }) => Promise<unknown>
        }
      ).createEmbeddingContext({ contextSize: EMBED_CONTEXT_SIZE })

      void llama
      this.model = model
      this.context = context
      this.setStatus({
        state: 'ready',
        loadProgress: null,
        message: 'Embedder ready.',
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
      if (this.context && hasDispose(this.context)) await this.context.dispose()
      if (this.model && hasDispose(this.model)) await this.model.dispose()
    } catch {
      /* ignore */
    }
    this.context = null
    this.model = null
    if (this.status.state === 'ready') {
      this.setStatus({ state: 'unloaded', message: 'Embedder unloaded.' })
    }
  }

  // ---- embedding ----

  async embedQuery(text: string): Promise<number[] | null> {
    if (!(await this.ensureReady())) return null
    const cleaned = sanitize(text)
    if (cleaned.length === 0) return null
    try {
      return await this.embedRaw(QUERY_PREFIX + cleaned)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[embedder] embedQuery failed:', err)
      return null
    }
  }

  async embedPassages(texts: string[]): Promise<Array<number[] | null>> {
    if (texts.length === 0) return []
    if (!(await this.ensureReady())) return texts.map(() => null)
    const out: Array<number[] | null> = []
    for (let i = 0; i < texts.length; i++) {
      const raw = texts[i]!
      const cleaned = sanitize(raw)
      // Empty-after-sanitize means the chunk was pure whitespace (PDF page
      // break, table residue). Don't waste a forward pass — the embedder
      // either rejects empty input or returns a zero vector either way.
      if (cleaned.length === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[embedder] skipped passage #${i}: empty after sanitize (${raw.length} raw chars)`,
        )
        out.push(null)
        continue
      }
      try {
        out.push(await this.embedRaw(PASSAGE_PREFIX + cleaned))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // eslint-disable-next-line no-console
        console.warn(`[embedder] failed passage #${i} (${cleaned.length} chars): ${msg}`)
        out.push(null)
      }
    }
    return out
  }

  private async embedRaw(text: string): Promise<number[]> {
    const ctx = this.context as {
      getEmbeddingFor: (text: string) => Promise<{ vector: Float32Array | number[] }>
    }
    const result = await ctx.getEmbeddingFor(text)
    const v = result.vector
    return Array.from(v)
  }
}

// ---------------------------------------------------------------------------

function sanitize(text: string): string {
  // node-llama-cpp tokenizes raw text; just collapse whitespace and trim.
  // Keep this cheap — heavy normalization belongs in the chunker.
  // SANITIZE_MAX_CHARS sits under EMBED_CONTEXT_SIZE in tokens with
  // headroom; see the comment on those constants for the math.
  return text.replace(/\s+/g, ' ').trim().slice(0, SANITIZE_MAX_CHARS)
}

function hasDispose(o: unknown): o is { dispose: () => Promise<void> } {
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof (o as { dispose?: unknown }).dispose === 'function'
  )
}

/**
 * Same backend selection as LlamaService — embedder runs on the same llama
 * binary, so accept the same env override. `forceCpu` (driven by the user
 * setting) overrides the default `auto` so the embedder leaves the GPU to
 * the LLM. An explicit LLAMA_GPU=cuda|vulkan|metal still wins over the
 * setting — power-user override beats UI toggle.
 */
async function initLlamaForEmbedding(
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
      onMessage(`Initialising embedder backend (${gpu === false ? 'cpu' : gpu})…`)
      return await lib.getLlama({ gpu })
    } catch (err) {
      lastErr = err
      console.warn(`[embedder] ${gpu} init failed, trying next:`, err)
    }
  }
  throw lastErr ?? new Error('No embedder backend could be initialised')
}

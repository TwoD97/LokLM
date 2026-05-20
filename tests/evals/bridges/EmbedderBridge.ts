// EmbedderBridge — loads bge-m3 (or any *embed*.gguf) directly via
// node-llama-cpp. Bypasses the production EmbeddingService so the eval
// keeps working when the production code switches to a worker-process
// architecture.
//
// The bridge owns its own llama instance per placement: passing
// `placement: 'cpu'` calls getLlama({ gpu: false }), which is independent
// from any other bridge in the same process (node-llama-cpp tolerates
// multiple backends concurrently).

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Embedder } from '../pipeline/Embedder'

const REPO_MODELS_DIR = join(process.cwd(), 'models')
const DEFAULT_FILENAME = 'bge-m3-Q4_K_M.gguf'
const NON_EMBEDDER_PATTERNS = [
  /qwen/i,
  /llama/i,
  /mistral/i,
  /phi/i,
  /gemma/i,
  /reranker/i,
  /nemotron/i,
]
const EMBED_CONTEXT_SIZE = 2048
const SANITIZE_MAX_CHARS = 6000
const EMBEDDING_DIM = 1024

export type Placement = 'cpu' | 'gpu' | 'auto'

export interface EmbedderBridgeOpts {
  /** explicit placement override. defaults to 'cpu' (mirrors the app default
   *  set during the VRAM-headroom work — embedder stays off the GPU so the
   *  LLM gets all the VRAM). */
  placement?: Placement
  /** absolute path to the GGUF. defaults to resolveEmbedderPath(). */
  modelPath?: string
  /** label baked into `name`. */
  label?: string
}

export class EmbedderBridge implements Embedder {
  readonly dim = EMBEDDING_DIM
  readonly name: string
  private model: unknown = null
  private context: unknown = null
  private warmed = false
  private readonly placement: Placement

  constructor(private readonly opts: EmbedderBridgeOpts = {}) {
    this.placement = opts.placement ?? 'cpu'
    this.name = opts.label ? `bge-m3:${opts.label}` : `bge-m3:${this.placement}`
  }

  async warm(): Promise<void> {
    if (this.warmed) return
    const modelPath = this.opts.modelPath ?? resolveEmbedderPath()
    if (!modelPath) {
      throw new Error(
        `embedder bridge: no GGUF found in ${REPO_MODELS_DIR} ; expected ${DEFAULT_FILENAME} or another *embed*.gguf`,
      )
    }
    const lib = await import('node-llama-cpp')
    const gpu = this.placement === 'cpu' ? false : this.placement === 'gpu' ? 'auto' : 'auto'
    const llama = await lib.getLlama({ gpu })
    this.model = await llama.loadModel({ modelPath })
    this.context = await (
      this.model as {
        createEmbeddingContext: (o?: { contextSize?: number }) => Promise<unknown>
      }
    ).createEmbeddingContext({ contextSize: EMBED_CONTEXT_SIZE })
    this.warmed = true
  }

  async embed(text: string): Promise<number[]> {
    await this.warm()
    const cleaned = sanitize(text)
    if (cleaned.length === 0) return new Array<number>(this.dim).fill(0)
    const ctx = this.context as {
      getEmbeddingFor: (text: string) => Promise<{ vector: Float32Array | number[] }>
    }
    const result = await ctx.getEmbeddingFor(cleaned)
    return Array.from(result.vector)
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.warm()
    const out: number[][] = []
    for (const t of texts) {
      // bge-m3 has no batching API surface via node-llama-cpp; serial calls
      // are the standard pattern. The corpus-build path in sweep.ts caches
      // the result across configs so this only pays once per (embedder ×
      // chunker × corpus) combo.
      out.push(await this.embed(t))
    }
    return out
  }

  async unload(): Promise<void> {
    try {
      if (this.context && hasDispose(this.context)) await this.context.dispose()
      if (this.model && hasDispose(this.model)) await this.model.dispose()
    } catch {
      /* best-effort */
    }
    this.context = null
    this.model = null
    this.warmed = false
  }
}

/**
 * Find an embedder GGUF in repo-local models/ folder. Prefers the canonical
 * bge-m3 file; falls back to any *embed*.gguf that doesn't look like an LLM.
 * Eval-only — production uses resolveEmbedderPath from EmbeddingService which
 * walks userData + resourcesPath; we don't need that complexity here.
 */
export function resolveEmbedderPath(): string | null {
  const env = process.env.LOKLM_EMBEDDER_PATH
  if (env && existsSync(env)) return env
  const canonical = join(REPO_MODELS_DIR, DEFAULT_FILENAME)
  if (existsSync(canonical)) return canonical
  if (!existsSync(REPO_MODELS_DIR)) return null
  let entries: string[] = []
  try {
    entries = readdirSync(REPO_MODELS_DIR)
  } catch {
    return null
  }
  const candidates = entries
    .filter((f) => f.toLowerCase().endsWith('.gguf'))
    .filter((f) => /embed/i.test(f))
    .filter((f) => !NON_EMBEDDER_PATTERNS.some((re) => re.test(f)))
    .sort()
  if (candidates.length === 0) return null
  return join(REPO_MODELS_DIR, candidates[0]!)
}

function sanitize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, SANITIZE_MAX_CHARS)
}

function hasDispose(o: unknown): o is { dispose: () => Promise<void> } {
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof (o as { dispose?: unknown }).dispose === 'function'
  )
}

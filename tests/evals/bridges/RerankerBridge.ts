// RerankerBridge — loads bge-reranker-v2-m3 (or any *reranker*.gguf) directly
// via node-llama-cpp. Eval-side counterpart to RerankerService; deliberately
// minimal so the production service can keep evolving (worker process,
// streaming, idle eviction…) without breaking the eval.

import type { RankInput, RankedItem, Reranker } from '../pipeline/Reranker'
import {
  REPO_MODELS_DIR,
  type Placement,
  placementToGpu,
  resolveModelPath,
  safeDispose,
} from './common'

const DEFAULT_FILENAME = 'bge-reranker-v2-m3-Q4_K_M.gguf'
const NON_RERANKER_PATTERNS = [
  /qwen/i,
  /llama/i,
  /mistral/i,
  /phi/i,
  /gemma/i,
  /embed/i,
  /nemotron/i,
]
const RERANK_CONTEXT_SIZE = 1024

export type { Placement }

export interface RerankerBridgeOpts {
  placement?: Placement
  modelPath?: string
  label?: string
}

export class RerankerBridge implements Reranker {
  readonly name: string
  private model: unknown = null
  private context: unknown = null
  private warmed = false
  private readonly placement: Placement

  constructor(private readonly opts: RerankerBridgeOpts = {}) {
    this.placement = opts.placement ?? 'auto'
    this.name = opts.label ? `bge-reranker:${opts.label}` : `bge-reranker:${this.placement}`
  }

  async warm(): Promise<void> {
    if (this.warmed) return
    const modelPath = this.opts.modelPath ?? resolveRerankerPath()
    if (!modelPath) {
      throw new Error(
        `reranker bridge: no GGUF found in ${REPO_MODELS_DIR} ; expected ${DEFAULT_FILENAME} or another *reranker*.gguf`,
      )
    }
    const lib = await import('node-llama-cpp')
    const llama = await lib.getLlama({ gpu: placementToGpu(this.placement) })
    this.model = await llama.loadModel({ modelPath })
    this.context = await (
      this.model as {
        createRankingContext: (o?: { contextSize?: number }) => Promise<unknown>
      }
    ).createRankingContext({ contextSize: RERANK_CONTEXT_SIZE })
    this.warmed = true
  }

  async rerank(query: string, items: RankInput[]): Promise<RankedItem[]> {
    await this.warm()
    if (items.length === 0) return []
    const ctx = this.context as { rankAll: (q: string, docs: string[]) => Promise<number[]> }
    let scores: number[]
    try {
      scores = Array.from(
        await ctx.rankAll(
          query,
          items.map((it) => it.text),
        ),
      )
    } catch (err) {
       
      console.warn('[reranker-bridge] rankAll failed, falling back to initial order:', err)
      return items.map((it, i) => ({ text: it.text, score: it.initialScore, initialIndex: i }))
    }
    return items
      .map((it, i) => ({ text: it.text, score: scores[i] ?? 0, initialIndex: i }))
      .sort((a, b) => b.score - a.score)
  }

  async unload(): Promise<void> {
    await safeDispose(this.context)
    await safeDispose(this.model)
    this.context = null
    this.model = null
    this.warmed = false
  }
}

/** NoopReranker that skips the cross-encoder entirely. Useful as a sweep axis
 *  value when measuring "what does the rerank phase actually cost". */
export class SkipReranker implements Reranker {
  readonly name = 'skip-rerank'
  async rerank(_query: string, items: RankInput[]): Promise<RankedItem[]> {
    return items.map((it, i) => ({ text: it.text, score: it.initialScore, initialIndex: i }))
  }
}

export function resolveRerankerPath(): string | null {
  return resolveModelPath({
    envVar: 'LOKLM_RERANKER_PATH',
    canonicalFilename: DEFAULT_FILENAME,
    include: /reranker/i,
    exclude: NON_RERANKER_PATTERNS,
  })
}

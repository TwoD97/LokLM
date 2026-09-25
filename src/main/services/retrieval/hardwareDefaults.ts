import type { AnswerOptions } from '../../../shared/documents'
import {
  RERANKER_AUTO_MIN_VRAM_GIB,
  type RerankerDecision,
} from '../../../shared/modelCapabilities'

export function needsLeanRetrieval(options: {
  tier: string | null
  llmSource: 'bundled' | 'ollama'
  rerankerDecision?: RerankerDecision | undefined
  totalVramGB?: number | null | undefined
}): boolean {
  // A configured external LLM does not inherit the local card's restrictions.
  if (options.llmSource === 'ollama') return false
  return (
    options.tier === 'lite' ||
    options.rerankerDecision?.reason === 'low-vram' ||
    (options.totalVramGB != null &&
      options.totalVramGB > 0 &&
      options.totalVramGB <= RERANKER_AUTO_MIN_VRAM_GIB)
  )
}

/** GPU inference remains enabled; this only avoids additional retrieval passes. */
export function applyLeanRetrievalDefaults(options: AnswerOptions): void {
  options.multiQuery ??= false
  options.contextualizeHeuristicOnly ??= true
  options.wholeDocFallback ??= false
  // Historical API name for a smaller candidate pool, not a model placement.
  options.cpuOptimized ??= true
}

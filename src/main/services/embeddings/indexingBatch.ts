import type { EmbedderProvider } from '../providers/types'

export function indexingBatchSize(embedder: EmbedderProvider): number {
  const preferred = embedder.preferredBatchSize?.() ?? 32
  return Number.isFinite(preferred) ? Math.max(1, Math.min(32, Math.floor(preferred))) : 32
}

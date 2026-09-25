/** Local GPU policy uses the selected device's VRAM, never system RAM. */
export type RerankerPolicy = 'auto' | 'always'

// Some Vulkan drivers report a 4 GB card as ~4.1 GiB (heap/budget accounting).
// Cover that device class rather than accidentally treating it as a larger GPU.
export const RERANKER_AUTO_MIN_VRAM_GIB = 4.5

/** Actual last successful local allocation, not a promise about future loads. */
export interface ModelCapacity {
  gpuLayers: number
  totalModelLayers: number | null
  fullyOnGpu: boolean | null
  contextSize: number
  totalVramGB: number | null
}

export interface RerankerDecision {
  allowed: boolean
  mode: RerankerPolicy
  source: 'bundled' | 'ollama'
  reason:
    | 'disabled'
    | 'external'
    | 'low-vram'
    | 'gpu-unavailable'
    | 'unknown-vram'
    | 'auto'
    | 'manual'
  /** GiB on the active runtime GPU. null means that detection is unavailable. */
  totalVramGB: number | null
}

export function assessRerankerPolicy(options: {
  enabled: boolean
  mode: RerankerPolicy
  source: 'bundled' | 'ollama'
  resources: { hasGpu: boolean; totalVramGB: number } | null
}): RerankerDecision {
  const { enabled, mode, source, resources } = options
  const totalVramGB =
    resources && Number.isFinite(resources.totalVramGB) && resources.totalVramGB > 0
      ? resources.totalVramGB
      : null
  const result = (allowed: boolean, reason: RerankerDecision['reason']): RerankerDecision => ({
    allowed,
    mode,
    source,
    reason,
    totalVramGB,
  })
  if (!enabled) return result(false, 'disabled')
  // An external service may run on a different machine; local memory cannot
  // determine its capability. Its own connection/model checks still apply.
  if (source === 'ollama') return result(true, 'external')
  if (!resources) return result(false, 'unknown-vram')
  if (!resources.hasGpu) return result(false, 'gpu-unavailable')
  if (totalVramGB === null) return result(false, 'unknown-vram')
  if (mode === 'always') return result(true, 'manual')
  if (totalVramGB <= RERANKER_AUTO_MIN_VRAM_GIB) return result(false, 'low-vram')
  return result(true, 'auto')
}

/** Diagnostics remain English; the renderer translates the stable reason code. */
export function describeRerankerDecision(decision: RerankerDecision): string {
  switch (decision.reason) {
    case 'disabled':
      return 'Reranking is turned off. Hybrid document search remains available.'
    case 'external':
      return 'Reranking is handled by the selected external provider.'
    case 'low-vram':
      return `Reranking is skipped in Auto on this ${decision.totalVramGB} GiB GPU to avoid extra model switching. Hybrid document search remains available.`
    case 'gpu-unavailable':
      return 'A working GPU is required for local models. Check the graphics driver or select another device.'
    case 'unknown-vram':
      return 'GPU memory could not be verified. Local reranking stays off until the selected device is detected.'
    case 'manual':
      return 'Reranking is enabled by request. On limited GPU memory, switching models can delay answers.'
    case 'auto':
      return 'Reranking is enabled in Auto. Models use the GPU when their task needs them.'
  }
}

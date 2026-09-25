import type { KvCacheType, LlmPlan, SystemResources } from '../embeddings/ResourcePlanner'

export const MIN_CHAT_CONTEXT = 4096

/** Prefer native math cores, capped by available scheduling capacity. An explicit
 * calibration override may use SMT threads, but cannot exceed that capacity. */
export function resolveInferenceThreads(
  availableCpuCount: number,
  rawOverride?: string,
  mathCpuCount?: number,
): { maxThreads: number; overrideThreads: number | null; invalidOverride: boolean } {
  const capacity =
    Number.isSafeInteger(availableCpuCount) && availableCpuCount > 0
      ? Math.max(1, availableCpuCount - 1)
      : 1
  const defaultThreads =
    mathCpuCount != null && Number.isSafeInteger(mathCpuCount) && mathCpuCount > 0
      ? Math.min(mathCpuCount, capacity)
      : capacity
  const requested = rawOverride?.trim() ?? ''
  if (!requested)
    return { maxThreads: defaultThreads, overrideThreads: null, invalidOverride: false }
  const threads = Number(requested)
  if (
    /^\d+$/.test(requested) &&
    Number.isSafeInteger(threads) &&
    threads >= 1 &&
    threads <= capacity
  )
    return { maxThreads: threads, overrideThreads: threads, invalidOverride: false }
  return { maxThreads: defaultThreads, overrideThreads: null, invalidOverride: true }
}

/** Calibration-only override; unset keeps the existing production margin.
 * This is a planner reserve, not an actual GPU allocation. node-llama-cpp's
 * fitContext layer resolver additionally reserves half of this padding. */
export function resolveVramPadding(
  totalVramBytes: number,
  rawOverride?: string,
): { paddingBytes: number; overrideMiB: number | null; invalidOverride: boolean } {
  const defaultBytes = Math.min(1.2 * 1024 ** 3, Math.max(1024 ** 3, totalVramBytes * 0.1))
  const requested = rawOverride?.trim() ?? ''
  if (!requested) {
    return { paddingBytes: defaultBytes, overrideMiB: null, invalidOverride: false }
  }
  const mib = Number(requested)
  if (/^\d+$/.test(requested) && Number.isSafeInteger(mib) && mib >= 512 && mib <= 1229) {
    return { paddingBytes: mib * 1024 ** 2, overrideMiB: mib, invalidOverride: false }
  }
  return { paddingBytes: defaultBytes, overrideMiB: null, invalidOverride: true }
}

export function chatContextTarget(
  target: number,
  choice: number | 'auto',
  resources: SystemResources,
  weightsBytes: number,
): number {
  const constrained =
    resources.hasGpu &&
    (resources.totalVramGB <= 6 || resources.freeVramGB < weightsBytes / 1024 ** 3 + 1)
  return choice === 'auto' && constrained ? Math.min(target, 8192) : target
}

export function isMemoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:not enough|insufficient|out of|no) (?:\w+ )?(?:memory|vram|ram)|available (?:vram|ram)|(?:allocat\w*.*fail|fail.*allocat)|memory budget/i.test(
    message,
  )
}

export interface ChatContext {
  contextSize: number
  getSequence(): unknown
  dispose(): Promise<void>
}
export interface ChatModel {
  gpuLayers: number
  fileInsights?: { totalLayers: number }
  createContext(options: Record<string, unknown>): Promise<ChatContext>
  dispose(): Promise<void>
}
export interface ChatModelOptions {
  modelPath: string
  gpuLayers: number | { min?: number; max?: number; fitContext: { contextSize: number } }
  defaultContextFlashAttention: boolean
  onLoadProgress?: (progress: number) => void
}

/** Explicit opt-out for diagnostics; every reused plan still undergoes native checks. */
export function gpuLayerPlanReuseEnabled(rawOverride?: string): boolean {
  return rawOverride !== '0'
}

/** Worker-local allocation hint, never a cache of native allocations or free memory. */
export class GpuLayerPlanCache {
  private readonly entries = new Map<string, number>()

  get(key: string): number | undefined {
    const layers = this.entries.get(key)
    if (layers != null) {
      this.entries.delete(key)
      this.entries.set(key, layers)
    }
    return layers
  }

  remember(key: string, layers: number): void {
    if (!key || !Number.isSafeInteger(layers) || layers < 1) return
    this.entries.delete(key)
    this.entries.set(key, layers)
    while (this.entries.size > 4) this.entries.delete(this.entries.keys().next().value!)
  }

  forget(key: string): void {
    this.entries.delete(key)
  }
}

/** Match the native model-load fit, not the later context's preferred KV order.
 * loadModel receives no experimentalDefaultContextKvCacheKey/ValueType overrides,
 * so its fitContext estimates use F16 for both. If those model defaults are ever
 * propagated explicitly, this identity must use their actual values too.
 * Current free memory is deliberately not cached; native checks still run. */
export function gpuLayerPlanKey(inputs: {
  modelRevision: string
  backendIdentity: string
  contextSize: number
  batchSize: number
  paddingBytes: number
}): string | null {
  if (
    !inputs.modelRevision ||
    !inputs.backendIdentity ||
    ![inputs.contextSize, inputs.batchSize, inputs.paddingBytes].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null
  return JSON.stringify([
    inputs.modelRevision,
    inputs.backendIdentity,
    MIN_CHAT_CONTEXT,
    Math.max(MIN_CHAT_CONTEXT, inputs.contextSize),
    ['f16', 'f16'], // Native model-fit key/value defaults; not actual context precision.
    inputs.batchSize,
    inputs.paddingBytes,
    true, // model default flash attention and actual context flash attention
  ])
}

function isContextCompatibilityError(error: unknown): boolean {
  return /not support|unsupported|kv.*type|flash attention/i.test(String(error))
}

/** Retry allocations with fewer GPU layers, not an unbounded/tiny context. */
export async function allocateChat(options: {
  loadModel: (options: ChatModelOptions) => Promise<ChatModel>
  modelPath: string
  plan: LlmPlan
  batchSize: number
  onLoadProgress: (progress: number) => void
  log: (message: string) => void
  layerPlanReuse?: { cache: GpuLayerPlanCache; key: string } | undefined
}): Promise<{
  model: ChatModel
  context: ChatContext
  plan: LlmPlan
  kvEnum: 'Q4_0' | 'Q8_0' | null
}> {
  const target = Math.max(MIN_CHAT_CONTEXT, options.plan.contextSize)
  const types = [...new Set<KvCacheType>([options.plan.kvCacheType, 'q8_0', 'q4_0', 'f16'])]
  const reuse = options.layerPlanReuse
  const rememberedLayers = reuse?.cache.get(reuse.key)
  if (reuse)
    options.log(
      rememberedLayers == null
        ? 'GPU layer plan cache miss; using automatic fit'
        : `GPU layer plan cache hit: ${rememberedLayers} layers; revalidating current memory`,
    )
  let layers: ChatModelOptions['gpuLayers'] =
    rememberedLayers == null
      ? { fitContext: { contextSize: target } }
      : { min: rememberedLayers, max: rememberedLayers, fitContext: { contextSize: target } }
  let lastError: unknown = new Error('Unable to allocate the language model.')

  // A remembered plan gets one guarded attempt, then the unchanged four-attempt
  // automatic allocator. The native object form preserves fitContext's extra
  // padding and fresh resource checks; numeric GPU layers would not do that.
  for (let attempt = rememberedLayers == null ? 0 : -1; attempt < 4; attempt++) {
    const usingHint = attempt === -1
    let model: ChatModel | null = null
    let rejectedHint = false
    try {
      model = await options.loadModel({
        modelPath: options.modelPath,
        gpuLayers: layers,
        defaultContextFlashAttention: true,
        onLoadProgress: options.onLoadProgress,
      })
      if (usingHint && model.gpuLayers !== rememberedLayers) {
        rejectedHint = true
        throw new Error('Cached GPU layer count no longer matches the loaded model')
      }
      if (model.gpuLayers < 1)
        throw new Error(
          'Not enough GPU memory for this model. Choose a smaller model or close other GPU applications.',
        )
      let memoryFailure = false
      for (const type of types) {
        const kvEnum = type === 'f16' ? null : type === 'q8_0' ? 'Q8_0' : 'Q4_0'
        try {
          const context = await model.createContext({
            contextSize: { min: MIN_CHAT_CONTEXT, max: target },
            flashAttention: true,
            batchSize: options.batchSize,
            ...(kvEnum
              ? { experimentalKvCacheKeyType: kvEnum, experimentalKvCacheValueType: kvEnum }
              : {}),
          })
          const reason =
            `${context.contextSize}-token context, ${type} KV, ${model.gpuLayers} GPU layers` +
            (attempt > 0 ? ' (reduced offload after memory pressure)' : '')
          options.log(`LLM ready: ${reason}`)
          reuse?.cache.remember(reuse.key, model.gpuLayers)
          return {
            model,
            context,
            kvEnum,
            plan: { ...options.plan, contextSize: context.contextSize, kvCacheType: type, reason },
          }
        } catch (error) {
          lastError = error
          memoryFailure ||= isMemoryError(error)
          if (!isMemoryError(error) && !isContextCompatibilityError(error)) throw error
          options.log(
            `Context ${type}, ${MIN_CHAT_CONTEXT}-${target} tokens rejected: ${String(error)}`,
          )
        }
      }
      if (usingHint) throw lastError
      if (!memoryFailure) throw lastError
      // Keep retries finite; never silently switch to CPU-only inference.
      layers = Math.max(1, Math.floor(model.gpuLayers / 2))
      if (model.gpuLayers <= 1) throw lastError
      options.log(`Retrying LLM with ${layers} GPU layers; releasing the previous allocation`)
    } catch (error) {
      lastError = error
      if (usingHint) {
        reuse?.cache.forget(reuse.key)
        // Never overlap a fallback allocation with a failed disposal. Ordinary
        // corrupt-model / driver errors remain fail-fast rather than retried.
        if (model) await model.dispose()
        if (!rejectedHint && !isMemoryError(error) && !isContextCompatibilityError(error))
          throw error
        options.log(`GPU layer plan cache fallback: ${String(error)}; retrying automatic fit`)
        layers = { fitContext: { contextSize: target } }
        continue
      }
      if (!isMemoryError(error) || !model || model.gpuLayers <= 1 || attempt === 3) {
        if (model) await model.dispose().catch(() => undefined)
        throw error
      }
      layers = Math.max(1, Math.floor(model.gpuLayers / 2))
    }
    // A retry must not overlap weights whose native disposal failed. Terminal
    // error cleanup above can preserve the original error because it never retries.
    if (model) await model.dispose()
  }
  throw lastError
}

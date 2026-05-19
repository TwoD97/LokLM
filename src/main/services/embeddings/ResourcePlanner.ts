/**
 * ResourcePlanner — central place that decides "what fits where" given the
 * machine's RAM + VRAM, the OS-specific overhead, and the user's manual
 * overrides. Manual settings always win; this only fills in fields the user
 * left on `auto`.
 *
 * Lifecycle:
 *   - Constructed once at startup, lives for the process.
 *   - Lazily probes free VRAM via node-llama-cpp. Probe is idempotent and
 *     reuses the same singleton llama instance the services will load.
 *   - Each plan*() helper is pure given the inputs — no hidden state — so
 *     callers can rerun a plan after a model loads to re-evaluate the next
 *     model's placement against the now-smaller free VRAM pool.
 */
import { totalmem, freemem, platform } from 'node:os'
import { existsSync, statSync } from 'node:fs'

const BYTES_PER_GB = 1024 ** 3

/**
 * OS RAM headroom — what we leave for the operating system itself, the
 * desktop, the browsers users actually keep open, and the rest of Electron.
 * Numbers come from the rule-of-thumb LokLM target machines:
 *   - Windows: idle desktop + Edge + Defender already eats ~3–4 GB on a
 *     typical install. Reserve 4 GB so Qwen-8B doesn't push the user into
 *     the pagefile.
 *   - macOS: leaner idle (~2 GB) but unified memory means the GPU steals
 *     from RAM too. 3 GB is a safe baseline.
 *   - Linux: ~1.5–2 GB depending on DE. 2 GB matches GNOME on Ubuntu.
 */
function osHeadroomGB(): number {
  switch (platform()) {
    case 'win32':
      return 4
    case 'darwin':
      return 3
    case 'linux':
      return 2
    default:
      return 3
  }
}

/**
 * VRAM compositor reservation — what the OS itself keeps for the desktop
 * compositor, browser GPU process, etc. Skipped on macOS (unified memory
 * accounting is handled by osHeadroomGB).
 */
function vramHeadroomGB(): number {
  switch (platform()) {
    case 'win32':
      return 1.0 // DWM + browser GPU process
    case 'linux':
      return 0.7 // X/Wayland compositor
    case 'darwin':
      return 0 // unified memory — already counted in RAM headroom
    default:
      return 1.0
  }
}

export interface SystemResources {
  totalRamGB: number
  freeRamGB: number
  /** Total VRAM detected on the active GPU; 0 if no GPU / detection failed. */
  totalVramGB: number
  /** Free VRAM at the time of the last probe. */
  freeVramGB: number
  /** True if a usable discrete/integrated GPU was detected. */
  hasGpu: boolean
  platform: NodeJS.Platform
  osHeadroomGB: number
  vramHeadroomGB: number
}

/**
 * Per-LLM-profile rough memory cost at fp16 KV. KV scales with context length:
 *   - 4B class: ~80 KB/token  (32 layers × 2048 hidden × 2 bytes × 2 (k+v))
 *   - 7–8B class: ~160 KB/token  (32 layers × 4096 hidden × 2 × 2)
 *   - 30B-A3B / 32B class: ~320 KB/token (60 layers × 5120 hidden × 2 × 2)
 * Conservative — real values vary with GQA / head count, but over-estimating
 * slightly just gives the planner more headroom.
 */
const KV_BYTES_PER_TOKEN_F16: Record<string, number> = {
  lite: 80 * 1024,
  full: 160 * 1024,
  xl: 320 * 1024,
}

/**
 * KV quantisation modes. q8_0 ≈ 0.53× f16 size (8.5 bpw vs 16); q4_0 ≈ 0.28×.
 * Quality cost of q8_0 is well below the noise floor for chat tasks; q4_0 is
 * safe for K but can degrade V on some models — use only when q8_0 won't fit
 * the user's target context. Multipliers are applied to the f16 baseline.
 */
export type KvCacheType = 'f16' | 'q8_0' | 'q4_0'
const KV_SIZE_MULT: Record<KvCacheType, number> = {
  f16: 1.0,
  q8_0: 0.5313, // 17/32
  q4_0: 0.2813, // 9/32
}

const MIN_AUTO_CONTEXT = 4096

export interface LlmPlan {
  contextSize: number
  /** Whether the planner thinks the chosen profile + context fits VRAM.
   *  If false, the model will spill into RAM via gpu-layer offloading,
   *  which is functional but slower. Surfaced for the UI banner. */
  fitsInVram: boolean
  /** Free VRAM the planner thinks will remain *after* the LLM loads.
   *  Drives downstream embedder/reranker placement decisions. */
  estimatedFreeVramGBAfterLoad: number
  /** KV cache element type. f16 is the safe baseline; q8_0 halves KV size
   *  with negligible quality loss; q4_0 quarters it (used only when q8_0
   *  still can't fit the profile's native context). */
  kvCacheType: KvCacheType
  /** Human-readable reason for the chosen size — helps the user understand
   *  why auto picked what it picked. */
  reason: string
}

export type Placement = 'cpu' | 'gpu'
export type PlacementChoice = 'auto' | Placement

export interface ServicePlan {
  placement: Placement
  reason: string
}

/**
 * File size of a GGUF on disk, used as a coarse stand-in for in-VRAM
 * weights footprint. Q4_K_M and Q8 quantisations both load ~1× their file
 * size into VRAM (a touch more for layout, but close enough for budgeting).
 */
export function ggufWeightBytes(path: string): number {
  try {
    if (!existsSync(path)) return 0
    return statSync(path).size
  } catch {
    return 0
  }
}

export class ResourcePlanner {
  private cachedResources: SystemResources | null = null
  private llamaProbe: unknown = null

  /**
   * Cheap, synchronous snapshot — RAM only, plus whatever VRAM we cached
   * from the last probe. Use refresh() after a model load to re-read free
   * VRAM from the live llama instance.
   */
  snapshot(): SystemResources {
    if (this.cachedResources) return this.cachedResources
    const t = totalmem() / BYTES_PER_GB
    const f = freemem() / BYTES_PER_GB
    const r: SystemResources = {
      totalRamGB: round(t),
      freeRamGB: round(f),
      totalVramGB: 0,
      freeVramGB: 0,
      hasGpu: false,
      platform: platform(),
      osHeadroomGB: osHeadroomGB(),
      vramHeadroomGB: vramHeadroomGB(),
    }
    this.cachedResources = r
    return r
  }

  /**
   * Probe live VRAM via node-llama-cpp. Idempotent — reuses the singleton
   * llama backend so this doesn't add a second GPU init cost. Failures are
   * non-fatal: we just record `hasGpu = false` and the planner falls back
   * to RAM-only logic.
   */
  async refresh(): Promise<SystemResources> {
    const base = this.snapshot()
    base.freeRamGB = round(freemem() / BYTES_PER_GB)
    try {
      if (!this.llamaProbe) {
        const lib = await import('node-llama-cpp')
        // 'auto' so we don't force CUDA/Vulkan/Metal — getLlama is a
        // singleton inside node-llama-cpp; later service loads reuse it.
        this.llamaProbe = await lib.getLlama({ gpu: 'auto' })
      }
      const probe = this.llamaProbe as {
        getVramState?: () => Promise<{ total: number; free: number }>
        gpu?: string | false
      }
      if (typeof probe.getVramState === 'function') {
        const v = await probe.getVramState()
        base.totalVramGB = round(v.total / BYTES_PER_GB)
        base.freeVramGB = round(v.free / BYTES_PER_GB)
        base.hasGpu = v.total > 0 && probe.gpu !== false
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[planner] VRAM probe failed; falling back to RAM-only:', err)
      base.hasGpu = false
    }
    this.cachedResources = base
    return base
  }

  /**
   * Pick an LLM context size + KV quantisation against the budget left after
   * weights load. `userChoice` of a number short-circuits the size pick but
   * still gets a KV-type recommendation (we'll quantise to fit). `'auto'`
   * runs the full planner: aim for the profile's native context window,
   * stepping down KV precision (f16 → q8_0 → q4_0) before truncating context.
   */
  planLlm(args: {
    profileName: string
    profileDefaultContext: number
    weightsBytes: number
    resources: SystemResources
    userContextChoice: 'auto' | number
    /** Force a specific KV element type instead of stepping down from f16.
     *  Used by the loader to recompute a smaller context when the runtime
     *  rejects a more aggressive quant (e.g. q4_0 V-cache without flash
     *  attention). */
    forceKvType?: KvCacheType
  }): LlmPlan {
    const {
      profileName,
      profileDefaultContext,
      weightsBytes,
      resources,
      userContextChoice,
      forceKvType,
    } = args

    const kvF16 = KV_BYTES_PER_TOKEN_F16[profileName] ?? 160 * 1024
    const weightsGB = weightsBytes / BYTES_PER_GB
    const runtimeGB = 1 // cuBLAS workspace / Vulkan staging / llama-cpp scratch
    const usableVram = resources.hasGpu
      ? Math.max(0, resources.freeVramGB - resources.vramHeadroomGB - runtimeGB)
      : 0
    const usableRam = Math.max(0, resources.freeRamGB - resources.osHeadroomGB)
    // KV budget — what's free for KV after the weights take their cut:
    //   - Pure GPU fit: VRAM headroom is `usableVram - weightsGB`. RAM is
    //     left alone for Electron / embedder / reranker.
    //   - Weights overflow VRAM: pickProfile already validated the
    //     overflow fits in RAM. The overflowing layers' KV follows them
    //     to RAM; we add a capped RAM share (≤ 8 GB) so a big model can
    //     still grow context past its native window.
    const overflowGB = resources.hasGpu ? Math.max(0, weightsGB - usableVram) : 0
    const vramKvGB = resources.hasGpu ? Math.max(0, usableVram - weightsGB) : 0
    const ramKvGB = Math.min(
      8,
      Math.max(0, usableRam - overflowGB - weightsGB * (resources.hasGpu ? 0 : 1)),
    )
    const kvBudgetGB = vramKvGB + (overflowGB > 0 || !resources.hasGpu ? ramKvGB : 0)

    // Pick KV type: by default we try f16, fall back to q8_0, then q4_0, to
    // fit the target context. When `forceKvType` is set (loader fallback path
    // after a runtime rejection), skip the auto step-down and just compute
    // the fittable token count for that specific type.
    const target =
      typeof userContextChoice === 'number' && Number.isFinite(userContextChoice)
        ? clamp(userContextChoice, MIN_AUTO_CONTEXT, profileDefaultContext)
        : profileDefaultContext
    const pick: { type: KvCacheType; fittableTokens: number } = forceKvType
      ? {
          type: forceKvType,
          fittableTokens: Math.max(
            0,
            Math.floor((kvBudgetGB * BYTES_PER_GB) / (kvF16 * KV_SIZE_MULT[forceKvType])),
          ),
        }
      : pickKvType(target, kvF16, kvBudgetGB)
    const isManual = typeof userContextChoice === 'number' && Number.isFinite(userContextChoice)

    let contextSize: number
    let kvCacheType: KvCacheType
    let reasonPrefix: string

    if (isManual && !forceKvType) {
      // Manual context: honour the user's number; the only choice the planner
      // makes is which KV type lets it fit.
      contextSize = target
      kvCacheType = pick.type
      reasonPrefix = `manual ${target}-tok context`
    } else {
      // Auto, or a forced-KV-type fallback after runtime rejection: aim at
      // the target context but shrink to whatever fits at this KV type.
      contextSize = clamp(roundDownPow2(pick.fittableTokens), MIN_AUTO_CONTEXT, target)
      kvCacheType = pick.type
      reasonPrefix = forceKvType
        ? `fallback ${forceKvType}`
        : contextSize >= profileDefaultContext
          ? `auto: full ${profileDefaultContext}-tok native window`
          : `auto: sized to free memory`
    }

    const kvBytes = kvF16 * KV_SIZE_MULT[kvCacheType]
    const kvGB = (contextSize * kvBytes) / BYTES_PER_GB
    const totalGB = weightsGB + kvGB
    const fitsInVram = resources.hasGpu && totalGB <= usableVram
    const estimatedFreeVramGBAfterLoad = resources.hasGpu ? Math.max(0, usableVram - totalGB) : 0

    const kvLabel = kvCacheType === 'f16' ? 'fp16 KV' : `${kvCacheType} KV`
    const venue = resources.hasGpu ? 'gpu' : 'cpu-only'
    const reason =
      `${reasonPrefix} (${venue}, ${kvLabel}): ${weightsGB.toFixed(1)} GB weights + ${kvGB.toFixed(1)} GB KV` +
      (resources.hasGpu
        ? ` in ${usableVram.toFixed(1)} GB usable VRAM`
        : ` in ${usableRam.toFixed(1)} GB usable RAM`)

    return {
      contextSize,
      fitsInVram,
      estimatedFreeVramGBAfterLoad,
      kvCacheType,
      reason,
    }
  }

  /**
   * Decide whether an auxiliary model (embedder/reranker) goes on GPU.
   * Strategy: load on GPU if the model + a small per-load overhead
   * comfortably fits the remaining free VRAM after whatever's already
   * resident. Otherwise CPU.
   *
   * `userChoice` of `'cpu'` or `'gpu'` is returned verbatim — manual wins.
   */
  planAux(args: {
    weightsBytes: number
    resources: SystemResources
    userChoice: PlacementChoice
    /** What we estimate is still free in VRAM after prior loads, in GB.
     *  Pass `resources.freeVramGB` if nothing else has loaded yet, or the
     *  remainder from a previous LlmPlan / planAux call. */
    estimatedFreeVramGB: number
  }): ServicePlan {
    const { weightsBytes, resources, userChoice, estimatedFreeVramGB } = args
    if (userChoice === 'cpu') {
      return { placement: 'cpu', reason: 'manual: forced to CPU' }
    }
    if (userChoice === 'gpu') {
      return { placement: 'gpu', reason: 'manual: forced to GPU' }
    }
    if (!resources.hasGpu) {
      return { placement: 'cpu', reason: 'no GPU detected' }
    }
    const weightsGB = weightsBytes / BYTES_PER_GB
    // Need weights + ~0.3 GB for context + runtime scratch.
    const needGB = weightsGB + 0.3
    if (needGB > estimatedFreeVramGB) {
      return {
        placement: 'cpu',
        reason: `auto: ${needGB.toFixed(1)} GB needed > ${estimatedFreeVramGB.toFixed(
          1,
        )} GB free VRAM`,
      }
    }
    return {
      placement: 'gpu',
      reason: `auto: fits in ${estimatedFreeVramGB.toFixed(1)} GB free VRAM`,
    }
  }

  /**
   * VRAM-aware LLM profile auto-pick. RAM remains the floor (we still
   * reject profiles whose minTotalMemGB the machine doesn't clear); when a
   * GPU is present we prefer profiles that fit in usable VRAM but accept
   * up to ~4 GB of overflow if it can spill into free RAM — llama.cpp
   * partial-offloads cleanly and a slightly slower 30B-class model still
   * beats a snappy 8B for users who explicitly bundled the bigger weights.
   * Falls back to RAM-only logic when VRAM detection failed.
   */
  pickProfile<P extends { name: string; minTotalMemGB: number; weightsBytes: number }>(
    profiles: readonly P[],
    resources: SystemResources,
  ): P | null {
    const sorted = [...profiles].sort((a, b) => b.minTotalMemGB - a.minTotalMemGB)
    const usableVram = Math.max(0, resources.freeVramGB - resources.vramHeadroomGB - 1)
    const usableRam = Math.max(0, resources.freeRamGB - resources.osHeadroomGB)
    const MAX_SPILL_GB = 4 // how far a profile may overflow VRAM if RAM can absorb it
    for (const p of sorted) {
      if (resources.totalRamGB < p.minTotalMemGB) continue
      if (resources.hasGpu && p.weightsBytes > 0) {
        const weightsGB = p.weightsBytes / BYTES_PER_GB
        if (weightsGB > usableVram) {
          const overflow = weightsGB - usableVram
          // Reject only when the spillover is large *or* free RAM can't
          // absorb it; otherwise llama.cpp will partial-offload happily.
          if (overflow > MAX_SPILL_GB || overflow > usableRam) continue
        }
      }
      return p
    }
    // Nothing fit — return the smallest profile and let the loader try
    // (it'll spill into RAM rather than fail outright, which is the
    // historical behavior).
    return sorted[sorted.length - 1] ?? null
  }
}

/**
 * Step KV cache precision down (f16 → q8_0 → q4_0) until the target context
 * fits in the available budget. Returns the chosen type plus the actual
 * fittable token count for that type (so the caller can clamp auto-mode
 * contexts when even q4_0 isn't enough).
 */
function pickKvType(
  targetTokens: number,
  kvBytesPerTokenF16: number,
  budgetGB: number,
): { type: KvCacheType; fittableTokens: number } {
  const order: KvCacheType[] = ['f16', 'q8_0', 'q4_0']
  let last: { type: KvCacheType; fittableTokens: number } = {
    type: 'f16',
    fittableTokens: 0,
  }
  for (const t of order) {
    const bytes = kvBytesPerTokenF16 * KV_SIZE_MULT[t]
    const fittable = Math.max(0, Math.floor((budgetGB * BYTES_PER_GB) / bytes))
    last = { type: t, fittableTokens: fittable }
    if (fittable >= targetTokens) return last
  }
  // Even q4_0 can't reach the target — return q4_0's max as the best we can do.
  return last
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Round down to the next power-of-two-ish boundary that's friendly to the
 * KV cache allocator. Most context sizes in the wild are multiples of 1024;
 * snapping there avoids fragmentation and keeps reasoning about logs simple.
 */
function roundDownPow2(n: number): number {
  if (n <= 0) return 0
  const buckets = [
    4096, 6144, 8192, 12288, 16384, 20480, 24576, 32768, 49152, 65536, 98304, 131072, 196608,
    262144,
  ]
  let best = 0
  for (const b of buckets) {
    if (b <= n) best = b
    else break
  }
  return best
}

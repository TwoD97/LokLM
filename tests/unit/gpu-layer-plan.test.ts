import { describe, expect, it, vi } from 'vitest'
import {
  allocateChat,
  GpuLayerPlanCache,
  gpuLayerPlanKey,
  gpuLayerPlanReuseEnabled,
  QualifiedGpuLayerPlanHints,
  seedGpuLayerPlanHints,
  type ChatModel,
  type ChatModelOptions,
} from '@main/services/workers/modelMemory'
import type { LlmPlan } from '@main/services/embeddings/ResourcePlanner'

const plan: LlmPlan = {
  contextSize: 8192,
  kvCacheType: 'q4_0',
  fitsInVram: false,
  estimatedFreeVramGBAfterLoad: 0,
  reason: 'test',
}
const identity = {
  modelRevision: 'model.gguf:revision1',
  backendIdentity: 'vulkan:device0',
  contextSize: 8192,
  batchSize: 254,
  paddingBytes: 1024 ** 3,
}
function model(layers = 14): ChatModel {
  return {
    gpuLayers: layers,
    dispose: vi.fn(async () => {}),
    createContext: vi.fn(async () => ({
      contextSize: 8192,
      getSequence: () => ({}),
      dispose: async () => {},
    })),
  }
}
function options(cache?: GpuLayerPlanCache) {
  return {
    modelPath: 'model.gguf',
    plan,
    batchSize: 254,
    onLoadProgress: () => {},
    log: vi.fn<(message: string) => void>(),
    layerPlanReuse: cache ? { cache, key: gpuLayerPlanKey(identity)! } : undefined,
  }
}

describe('quality-qualified hints across native session reset', () => {
  const fullHint = {
    key: gpuLayerPlanKey(identity)!,
    layers: 14,
    requestedContext: 8192,
    achievedContext: 8192,
  }

  it('retains only full-target numeric metadata, bounds entries, and isolates snapshots', () => {
    const hints = new QualifiedGpuLayerPlanHints()
    hints.remember({ ...fullHint, privateText: 'must not be retained' })
    expect(hints.snapshot()).toEqual([fullHint])
    const snapshot = hints.snapshot()
    snapshot[0]!.layers = 99
    expect(hints.snapshot()[0]!.layers).toBe(14)
    hints.remember({ ...fullHint, achievedContext: 4096 })
    expect(hints.snapshot()).toEqual([])
    for (let i = 0; i < 7; i++) hints.remember({ ...fullHint, key: String(i) })
    expect(hints.snapshot().map((hint) => hint.key)).toEqual(['3', '4', '5', '6'])
  })

  it.each([
    { layers: 0 },
    { layers: 1.5 },
    { achievedContext: Number.NaN },
    { requestedContext: 1024 },
    { key: '' },
    { key: 'x'.repeat(16_385) },
  ])('ignores invalid or unbounded metadata %j', (invalid) => {
    const hints = new QualifiedGpuLayerPlanHints()
    hints.remember({ ...fullHint, ...invalid })
    expect(hints.snapshot()).toEqual([])
  })

  it('revalidates seeded full-context hints using bounded native fit and fresh context creation', async () => {
    const cache = new GpuLayerPlanCache()
    seedGpuLayerPlanHints(cache, [fullHint])
    const loaded = model()
    const loadModel = vi.fn(async () => loaded)
    await allocateChat({ ...options(cache), loadModel })
    expect(loadModel).toHaveBeenCalledWith(
      expect.objectContaining({
        gpuLayers: { min: 14, max: 14, fitContext: { contextSize: 8192 } },
      }),
    )
    expect(loaded.createContext).toHaveBeenCalledWith(
      expect.objectContaining({ contextSize: { min: 8192, max: 8192 } }),
    )
  })

  it('does not use a retained hint when model/backend/context/reserve identity differs', async () => {
    for (const changed of [
      { modelRevision: 'new' },
      { backendIdentity: 'other-GPU' },
      { contextSize: 4096 },
      { paddingBytes: 1234 },
    ]) {
      const cache = new GpuLayerPlanCache()
      seedGpuLayerPlanHints(cache, [
        { ...fullHint, key: gpuLayerPlanKey({ ...identity, ...changed })! },
      ])
      const loadModel = vi.fn(async () => model())
      await allocateChat({ ...options(cache), loadModel })
      expect(loadModel).toHaveBeenCalledWith(
        expect.objectContaining({ gpuLayers: { fitContext: { contextSize: 8192 } } }),
      )
    }
  })

  it('rejects a retained hint that now only yields a smaller window before retrying automatic fit', async () => {
    const events: string[] = []
    const cache = new GpuLayerPlanCache()
    seedGpuLayerPlanHints(cache, [fullHint])
    const reduced = model(14)
    vi.mocked(reduced.createContext).mockImplementation(async (options) => {
      if ((options.contextSize as { min: number }).min === 8192)
        throw new Error('Insufficient VRAM for the exact target')
      return {
        contextSize: 4096,
        getSequence: () => ({}),
        dispose: async () => {
          events.push('context disposed')
        },
      }
    })
    vi.mocked(reduced.dispose).mockImplementation(async () => {
      events.push('weights disposed')
    })
    const loadModel = vi
      .fn()
      .mockResolvedValueOnce(reduced)
      .mockImplementationOnce(async () => {
        events.push('automatic fit')
        return model(13)
      })
    const result = await allocateChat({ ...options(cache), loadModel })
    expect(result.plan.contextSize).toBe(8192)
    expect(result.model.gpuLayers).toBe(13)
    expect(events).toEqual(['context disposed', 'weights disposed', 'automatic fit'])
    expect(loadModel.mock.calls[1]![0].gpuLayers).toEqual({ fitContext: { contextSize: 8192 } })
  })

  it('does not retry after disposal of a reduced-context hint fails', async () => {
    const cache = new GpuLayerPlanCache()
    seedGpuLayerPlanHints(cache, [fullHint])
    const reduced = model()
    vi.mocked(reduced.createContext).mockResolvedValue({
      contextSize: 4096,
      getSequence: () => ({}),
      dispose: async () => {
        throw new Error('dispose failed')
      },
    })
    const loadModel = vi.fn(async () => reduced)
    await expect(allocateChat({ ...options(cache), loadModel })).rejects.toThrow('dispose failed')
    expect(loadModel).toHaveBeenCalledOnce()
    expect(cache.get(fullHint.key)).toBeUndefined()
  })

  it('does not replace a fresh worker-local decision with an older cross-session seed', () => {
    const cache = new GpuLayerPlanCache()
    cache.remember(fullHint.key, 13)
    seedGpuLayerPlanHints(cache, [fullHint])
    expect(cache.get(fullHint.key)).toBe(13)
  })
})

describe('guarded GPU layer-plan reuse', () => {
  it('leaves ordinary automatic fitting unchanged when disabled', async () => {
    const loadModel = vi
      .fn<(call: ChatModelOptions) => Promise<ChatModel>>()
      .mockImplementation(async () => model())
    const opts = options()
    await allocateChat({ ...opts, loadModel })
    await allocateChat({ ...opts, loadModel })
    expect(loadModel.mock.calls.map(([call]) => call.gpuLayers)).toEqual([
      { fitContext: { contextSize: 8192 } },
      { fitContext: { contextSize: 8192 } },
    ])
    expect(opts.log.mock.calls.flat().some((message) => message.includes('cache'))).toBe(false)
  })

  it('remembers only successful allocation and revalidates the exact bounded fit on reuse', async () => {
    const cache = new GpuLayerPlanCache()
    const opts = options(cache)
    const first = model()
    const second = model()
    const loadModel = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    await allocateChat({ ...opts, loadModel })
    expect(cache.get(opts.layerPlanReuse!.key)).toBe(14)
    await allocateChat({ ...opts, loadModel })
    expect(loadModel.mock.calls[1]![0]).toEqual({
      modelPath: 'model.gguf',
      gpuLayers: { min: 14, max: 14, fitContext: { contextSize: 8192 } },
      defaultContextFlashAttention: true,
      onLoadProgress: opts.onLoadProgress,
    })
    expect(second.createContext).toHaveBeenCalledWith({
      contextSize: { min: 8192, max: 8192 },
      flashAttention: true,
      batchSize: 254,
      experimentalKvCacheKeyType: 'Q8_0',
      experimentalKvCacheValueType: 'Q8_0',
    })
    expect(opts.log).toHaveBeenCalledWith(expect.stringContaining('cache miss'))
    expect(opts.log).toHaveBeenCalledWith(expect.stringContaining('cache hit'))
  })

  it('reuses the same native weight fit while natively probing q8 before a coarse q4 preference', async () => {
    const cache = new GpuLayerPlanCache()
    const opts = options(cache)
    const models = [model(), model(), model()]
    const loadModel = vi
      .fn()
      .mockResolvedValueOnce(models[0])
      .mockResolvedValueOnce(models[1])
      .mockResolvedValueOnce(models[2])
    for (const kvCacheType of ['f16', 'q4_0', 'q8_0'] as const) {
      const result = await allocateChat({ ...opts, plan: { ...plan, kvCacheType }, loadModel })
      expect(result.plan.kvCacheType).toBe(kvCacheType === 'q4_0' ? 'q8_0' : kvCacheType)
    }
    expect(loadModel.mock.calls.map(([call]) => call.gpuLayers)).toEqual([
      { fitContext: { contextSize: 8192 } },
      { min: 14, max: 14, fitContext: { contextSize: 8192 } },
      { min: 14, max: 14, fitContext: { contextSize: 8192 } },
    ])
    for (const [call] of loadModel.mock.calls) {
      expect(call).not.toHaveProperty('experimentalDefaultContextKvCacheKeyType')
      expect(call).not.toHaveProperty('experimentalDefaultContextKvCacheValueType')
    }
    expect(models[0]!.createContext).toHaveBeenCalledWith({
      contextSize: { min: 4096, max: 8192 },
      flashAttention: true,
      batchSize: 254,
    })
    expect(models[1]!.createContext).toHaveBeenCalledWith(
      expect.objectContaining({
        contextSize: { min: 8192, max: 8192 },
        experimentalKvCacheKeyType: 'Q8_0',
        experimentalKvCacheValueType: 'Q8_0',
      }),
    )
    expect(models[2]!.createContext).toHaveBeenCalledWith(
      expect.objectContaining({
        experimentalKvCacheKeyType: 'Q8_0',
        experimentalKvCacheValueType: 'Q8_0',
      }),
    )
  })

  it('tries the current KV order after a hint and does not reuse a previous successful precision', async () => {
    const cache = new GpuLayerPlanCache()
    const opts = options(cache)
    const old = model()
    const current = model()
    const contextTypes: unknown[] = []
    current.createContext = vi.fn(async (contextOptions) => {
      const type = contextOptions.experimentalKvCacheKeyType ?? 'F16'
      contextTypes.push(type)
      if (type === 'F16') throw new Error('Unsupported KV type for the current context')
      return { contextSize: 8192, getSequence: () => ({}), dispose: async () => {} }
    })
    const loadModel = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(current)
    await allocateChat({ ...opts, loadModel }) // Coarse q4 preference permits a full-target q8 probe.
    const result = await allocateChat({ ...opts, plan: { ...plan, kvCacheType: 'f16' }, loadModel })
    expect(contextTypes).toEqual(['F16', 'Q8_0'])
    expect(result.plan.kvCacheType).toBe('q8_0')
    expect(loadModel.mock.calls[1]![0].gpuLayers).toEqual({
      min: 14,
      max: 14,
      fitContext: { contextSize: 8192 },
    })
  })

  it('releases a cross-KV hint rejected by current memory checks before automatic fitting', async () => {
    const cache = new GpuLayerPlanCache()
    const opts = options(cache)
    const first = model()
    const rejected = model()
    const replacement = model(10)
    const order: string[] = []
    const contextTypes: unknown[] = []
    rejected.createContext = vi.fn(async (contextOptions) => {
      contextTypes.push(contextOptions.experimentalKvCacheKeyType ?? 'F16')
      throw new Error('Insufficient VRAM for the current context')
    })
    rejected.dispose = vi.fn(async () => {
      order.push('disposed')
    })
    const loadModel = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(rejected)
      .mockImplementationOnce(async () => {
        order.push('fallback')
        return replacement
      })
    await allocateChat({ ...opts, loadModel }) // Full-target q8 succeeds before memory pressure.
    const result = await allocateChat({ ...opts, plan: { ...plan, kvCacheType: 'f16' }, loadModel })
    expect(contextTypes).toEqual(['F16', 'Q8_0', 'Q4_0'])
    expect(order).toEqual(['disposed', 'fallback'])
    expect(loadModel).toHaveBeenCalledTimes(3)
    expect(loadModel.mock.calls[2]![0].gpuLayers).toEqual({ fitContext: { contextSize: 8192 } })
    expect(result.plan.kvCacheType).toBe('f16')
    expect(result.model.gpuLayers).toBe(10)
    expect(cache.get(opts.layerPlanReuse!.key)).toBe(10)
  })

  it('falls back once to automatic fit when fresh native memory checks reject a hint', async () => {
    const cache = new GpuLayerPlanCache()
    const opts = options(cache)
    cache.remember(opts.layerPlanReuse!.key, 14)
    const loadModel = vi
      .fn()
      .mockRejectedValueOnce(new Error('Not enough VRAM to fit the model'))
      .mockResolvedValueOnce(model(10))
    const result = await allocateChat({ ...opts, loadModel })
    expect(result.model.gpuLayers).toBe(10)
    expect(loadModel.mock.calls[1]![0].gpuLayers).toEqual({ fitContext: { contextSize: 8192 } })
    expect(cache.get(opts.layerPlanReuse!.key)).toBe(10)
    expect(opts.log).toHaveBeenCalledWith(expect.stringContaining('cache fallback'))
  })

  it('awaits rejected context weights disposal before any fallback allocation', async () => {
    const cache = new GpuLayerPlanCache()
    const opts = options(cache)
    cache.remember(opts.layerPlanReuse!.key, 14)
    let finishDisposal!: () => void
    const disposal = new Promise<void>((resolve) => {
      finishDisposal = resolve
    })
    const old = model()
    old.createContext = vi.fn().mockRejectedValue(new Error('Insufficient VRAM'))
    old.dispose = vi.fn(() => disposal)
    const loadModel = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(model(10))
    const allocation = allocateChat({ ...opts, loadModel })
    await vi.waitFor(() => expect(old.dispose).toHaveBeenCalledOnce())
    expect(loadModel).toHaveBeenCalledOnce()
    expect(cache.get(opts.layerPlanReuse!.key)).toBeUndefined()
    finishDisposal()
    await allocation
    expect(loadModel).toHaveBeenCalledTimes(2)
  })

  it('does not allocate again when cleanup fails', async () => {
    const cache = new GpuLayerPlanCache()
    const opts = options(cache)
    cache.remember(opts.layerPlanReuse!.key, 14)
    const old = model()
    old.createContext = vi.fn().mockRejectedValue(new Error('Insufficient VRAM'))
    old.dispose = vi.fn().mockRejectedValue(new Error('disposal failed'))
    const loadModel = vi.fn().mockResolvedValue(old)
    await expect(allocateChat({ ...opts, loadModel })).rejects.toThrow('disposal failed')
    expect(loadModel).toHaveBeenCalledOnce()
    expect(cache.get(opts.layerPlanReuse!.key)).toBeUndefined()
  })

  it.each([false, true])(
    'stops an ordinary retry after failed disposal (cached preflight rejection: %s)',
    async (rejectCachedFirst) => {
      const cache = new GpuLayerPlanCache()
      const opts = options(rejectCachedFirst ? cache : undefined)
      if (opts.layerPlanReuse) cache.remember(opts.layerPlanReuse.key, 14)
      const old = model(20)
      old.createContext = vi.fn().mockRejectedValue(new Error('Insufficient VRAM'))
      old.dispose = vi.fn().mockRejectedValue(new Error('native weights disposal failed'))
      const loadModel = vi.fn().mockResolvedValue(old)
      if (rejectCachedFirst)
        loadModel.mockRejectedValueOnce(new Error('Not enough VRAM to fit the cached model'))
      await expect(allocateChat({ ...opts, loadModel })).rejects.toThrow(
        'native weights disposal failed',
      )
      expect(loadModel).toHaveBeenCalledTimes(rejectCachedFirst ? 2 : 1)
      expect(old.dispose).toHaveBeenCalledOnce()
      if (opts.layerPlanReuse) expect(cache.get(opts.layerPlanReuse.key)).toBeUndefined()
    },
  )

  it('invalidates a failed hint without retrying corrupted models or unrelated driver failures', async () => {
    const cache = new GpuLayerPlanCache()
    const opts = options(cache)
    cache.remember(opts.layerPlanReuse!.key, 14)
    const loadModel = vi.fn().mockRejectedValue(new Error('Invalid GGUF magic'))
    await expect(allocateChat({ ...opts, loadModel })).rejects.toThrow('Invalid GGUF magic')
    expect(loadModel).toHaveBeenCalledOnce()
    expect(cache.get(opts.layerPlanReuse!.key)).toBeUndefined()
  })

  it('rejects a mismatched or CPU-only hint result before making a context', async () => {
    const cache = new GpuLayerPlanCache()
    const opts = options(cache)
    cache.remember(opts.layerPlanReuse!.key, 14)
    const wrong = model(0)
    const loadModel = vi.fn().mockResolvedValueOnce(wrong).mockResolvedValueOnce(model(10))
    await allocateChat({ ...opts, loadModel })
    expect(wrong.createContext).not.toHaveBeenCalled()
    expect(wrong.dispose).toHaveBeenCalledOnce()
    expect(loadModel.mock.calls[1]![0].gpuLayers).toEqual({ fitContext: { contextSize: 8192 } })
  })

  it('keeps the fallback bounded and never stores a failed context allocation', async () => {
    const cache = new GpuLayerPlanCache()
    const opts = options(cache)
    cache.remember(opts.layerPlanReuse!.key, 14)
    const disposals = vi.fn(async () => {})
    const loadModel = vi.fn(async (call: ChatModelOptions) => {
      const layers =
        typeof call.gpuLayers === 'number' ? call.gpuLayers : (call.gpuLayers.min ?? 20)
      return {
        ...model(layers),
        dispose: disposals,
        createContext: vi.fn().mockRejectedValue(new Error('Insufficient VRAM')),
      }
    })
    await expect(allocateChat({ ...opts, loadModel })).rejects.toThrow('Insufficient VRAM')
    expect(loadModel).toHaveBeenCalledTimes(5)
    expect(disposals).toHaveBeenCalledTimes(5)
    expect(loadModel.mock.calls.map(([call]) => call.gpuLayers)).toEqual([
      { min: 14, max: 14, fitContext: { contextSize: 8192 } },
      { fitContext: { contextSize: 8192 } },
      10,
      5,
      2,
    ])
    expect(cache.get(opts.layerPlanReuse!.key)).toBeUndefined()
  })
})

describe('GPU layer-plan identity and bounds', () => {
  it('enables guarded reuse by default with an explicit diagnostic opt-out', () => {
    expect(gpuLayerPlanReuseEnabled()).toBe(true)
    expect(gpuLayerPlanReuseEnabled('')).toBe(true)
    expect(gpuLayerPlanReuseEnabled('1')).toBe(true)
    expect(gpuLayerPlanReuseEnabled('0')).toBe(false)
  })

  it('isolates model revision, backend/device, context, batch, and resolved padding', () => {
    const original = gpuLayerPlanKey(identity)
    for (const change of [
      { modelRevision: 'model.gguf:revision2' },
      { backendIdentity: 'vulkan:device1' },
      { contextSize: 4096 },
      { batchSize: 128 },
      { paddingBytes: 768 * 1024 ** 2 },
    ])
      expect(gpuLayerPlanKey({ ...identity, ...change })).not.toBe(original)
    expect(gpuLayerPlanKey({ ...identity, paddingBytes: NaN })).toBeNull()
    expect(gpuLayerPlanKey({ ...identity, modelRevision: '' })).toBeNull()
  })

  it('keeps at most four recent scalar hints and ignores invalid layer counts', () => {
    const cache = new GpuLayerPlanCache()
    for (let index = 0; index < 4; index++) cache.remember(String(index), index + 1)
    expect(cache.get('0')).toBe(1)
    cache.remember('4', 5)
    expect(cache.get('1')).toBeUndefined()
    expect(cache.get('0')).toBe(1)
    for (const layers of [0, -1, 1.5, NaN, Infinity]) cache.remember('bad', layers)
    expect(cache.get('bad')).toBeUndefined()
    cache.forget('0')
    expect(cache.get('0')).toBeUndefined()
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  allocateChat,
  GpuLayerPlanCache,
  type ChatModel,
  type ChatContext,
} from '@main/services/workers/modelMemory'
import type { LlmPlan } from '@main/services/embeddings/ResourcePlanner'

const plan: LlmPlan = {
  contextSize: 8192,
  kvCacheType: 'q4_0',
  fitsInVram: false,
  estimatedFreeVramGBAfterLoad: 0,
  reason: 'coarse estimate',
}
const context = (contextSize = 8192): ChatContext => ({
  contextSize,
  getSequence: () => ({}),
  dispose: vi.fn(async () => {}),
})
function fixture() {
  const model: ChatModel = {
    gpuLayers: 14,
    createContext: vi.fn(async () => context()),
    dispose: vi.fn(async () => {}),
  }
  const loadModel = vi.fn(async () => model)
  return {
    model,
    loadModel,
    options: {
      loadModel,
      modelPath: 'model.gguf',
      plan,
      batchSize: 254,
      onLoadProgress: () => {},
      log: vi.fn(),
    },
  }
}

describe('native q8 preference without reducing the requested context', () => {
  it('tries q8 at the exact target before q4 without reloading or weakening native weight fitting', async () => {
    const { model, loadModel, options } = fixture()
    const result = await allocateChat(options)
    expect(model.createContext).toHaveBeenCalledExactlyOnceWith({
      contextSize: { min: 8192, max: 8192 },
      flashAttention: true,
      batchSize: 254,
      experimentalKvCacheKeyType: 'Q8_0',
      experimentalKvCacheValueType: 'Q8_0',
    })
    expect(loadModel).toHaveBeenCalledExactlyOnceWith({
      modelPath: 'model.gguf',
      gpuLayers: { fitContext: { contextSize: 8192 } },
      defaultContextFlashAttention: true,
      onLoadProgress: options.onLoadProgress,
    })
    expect(result.plan).toMatchObject({ contextSize: 8192, kvCacheType: 'q8_0' })
    expect(result.model.gpuLayers).toBe(14)
    expect(model.dispose).not.toHaveBeenCalled()
  })

  it.each(['Insufficient VRAM for context', 'Unsupported KV cache type'])(
    'retains original q4 fallback on native rejection: %s',
    async (message) => {
      const { model, loadModel, options } = fixture()
      vi.mocked(model.createContext).mockRejectedValueOnce(new Error(message))
      const result = await allocateChat(options)
      expect(
        vi
          .mocked(model.createContext)
          .mock.calls.map(([call]) => [call.experimentalKvCacheKeyType, call.contextSize]),
      ).toEqual([
        ['Q8_0', { min: 8192, max: 8192 }],
        ['Q4_0', { min: 4096, max: 8192 }],
      ])
      expect(result.plan.kvCacheType).toBe('q4_0')
      expect(loadModel).toHaveBeenCalledOnce()
      expect(model.dispose).not.toHaveBeenCalled()
    },
  )

  it('retains later reduced-context q8 fallback if neither full-target q8 nor the original q4 attempt fits', async () => {
    const { model, options } = fixture()
    vi.mocked(model.createContext)
      .mockRejectedValueOnce(new Error('Insufficient memory'))
      .mockRejectedValueOnce(new Error('Unsupported q4 KV type'))
      .mockResolvedValueOnce(context(4096))
    const result = await allocateChat(options)
    expect(
      vi
        .mocked(model.createContext)
        .mock.calls.map(([call]) => [call.experimentalKvCacheKeyType, call.contextSize]),
    ).toEqual([
      ['Q8_0', { min: 8192, max: 8192 }],
      ['Q4_0', { min: 4096, max: 8192 }],
      ['Q8_0', { min: 4096, max: 8192 }],
    ])
    expect(result.plan).toMatchObject({ contextSize: 4096, kvCacheType: 'q8_0' })
  })

  it('does not accept an undersized q8 probe instead of a full-context q4 allocation', async () => {
    const { model, options } = fixture()
    const reduced = context(4096)
    vi.mocked(model.createContext)
      .mockResolvedValueOnce(reduced)
      .mockImplementationOnce(async () => {
        expect(reduced.dispose).toHaveBeenCalledOnce()
        return context(8192)
      })
    const result = await allocateChat(options)
    expect(result.plan).toMatchObject({ contextSize: 8192, kvCacheType: 'q4_0' })
    expect(model.createContext).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])(
    'never allocates after failed probe cleanup, including a memory-looking cleanup error (hint=%s)',
    async (withHint) => {
      const { model, loadModel, options } = fixture()
      const reduced = context(4096)
      vi.mocked(reduced.dispose).mockRejectedValue(new Error('Insufficient memory during disposal'))
      vi.mocked(model.createContext).mockResolvedValueOnce(reduced)
      const cache = new GpuLayerPlanCache()
      cache.remember('identity', 14)
      await expect(
        allocateChat({
          ...options,
          ...(withHint ? { layerPlanReuse: { cache, key: 'identity' } } : {}),
        }),
      ).rejects.toThrow('during disposal')
      expect(model.createContext).toHaveBeenCalledOnce()
      expect(loadModel).toHaveBeenCalledOnce()
      expect(model.dispose).toHaveBeenCalledOnce()
      if (withHint) expect(cache.get('identity')).toBeUndefined()
    },
  )

  it('fails fast on unrelated driver errors instead of hiding them behind q4', async () => {
    const { model, loadModel, options } = fixture()
    vi.mocked(model.createContext).mockRejectedValueOnce(new Error('Device lost during evaluation'))
    await expect(allocateChat(options)).rejects.toThrow('Device lost')
    expect(model.createContext).toHaveBeenCalledOnce()
    expect(loadModel).toHaveBeenCalledOnce()
    expect(model.dispose).toHaveBeenCalledOnce()
  })

  it('preserves the guarded model fit and qualified hint on successful full-target q8', async () => {
    const { model, loadModel, options } = fixture()
    const cache = new GpuLayerPlanCache()
    cache.remember('identity', 14, 8192)
    const result = await allocateChat({ ...options, layerPlanReuse: { cache, key: 'identity' } })
    expect(loadModel).toHaveBeenCalledWith(
      expect.objectContaining({
        gpuLayers: { min: 14, max: 14, fitContext: { contextSize: 8192 } },
      }),
    )
    expect(result.plan.kvCacheType).toBe('q8_0')
    expect(cache.get('identity')).toBe(14)
    expect(model.createContext).toHaveBeenCalledOnce()
  })

  it.each(['f16', 'q8_0'] as const)(
    'leaves the existing bounded first attempt unchanged when preferred precision is %s',
    async (kvCacheType) => {
      const { model, options } = fixture()
      await allocateChat({ ...options, plan: { ...plan, kvCacheType } })
      expect(model.createContext).toHaveBeenCalledExactlyOnceWith({
        contextSize: { min: 4096, max: 8192 },
        flashAttention: true,
        batchSize: 254,
        ...(kvCacheType === 'q8_0'
          ? { experimentalKvCacheKeyType: 'Q8_0', experimentalKvCacheValueType: 'Q8_0' }
          : {}),
      })
    },
  )

  it('retains the GPU-only gate before the probe and the minimum4096 context bound', async () => {
    const { model, options } = fixture()
    model.gpuLayers = 0
    await expect(allocateChat(options)).rejects.toThrow('Not enough GPU memory')
    expect(model.createContext).not.toHaveBeenCalled()
    model.gpuLayers = 14
    await allocateChat({ ...options, plan: { ...plan, contextSize: 1024 } })
    expect(model.createContext).toHaveBeenCalledWith(
      expect.objectContaining({ contextSize: { min: 4096, max: 4096 } }),
    )
  })
})

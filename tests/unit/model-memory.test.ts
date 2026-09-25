import { describe, expect, it, vi } from 'vitest'
import { allocateChat, chatContextTarget } from '@main/services/workers/modelMemory'
import type { LlmPlan, SystemResources } from '@main/services/embeddings/ResourcePlanner'

const smallGpu: SystemResources = {
  hasGpu: true,
  totalVramGB: 4,
  freeVramGB: 2.5,
  vramHeadroomGB: 0.5,
  totalRamGB: 32,
  freeRamGB: 16,
  osHeadroomGB: 4,
  platform: 'win32',
}
const plan: LlmPlan = {
  contextSize: 8192,
  kvCacheType: 'f16',
  fitsInVram: false,
  estimatedFreeVramGBAfterLoad: 0,
  reason: 'test',
}

describe('model residency on limited VRAM', () => {
  it('caps automatic context on constrained GPUs while retaining explicit choices', () => {
    expect(chatContextTarget(32768, 'auto', smallGpu, 2.7e9)).toBe(8192)
    expect(chatContextTarget(32768, 32768, smallGpu, 2.7e9)).toBe(32768)
    expect(
      chatContextTarget(32768, 'auto', { ...smallGpu, totalVramGB: 16, freeVramGB: 12 }, 2.7e9),
    ).toBe(32768)
  })
  it('releases rejected weights and reduces offload until a useful context fits', async () => {
    const events: string[] = []
    const contextOptions: Record<string, unknown>[] = []
    const loadModel = vi.fn(async (options) => {
      const gpuLayers = typeof options.gpuLayers === 'number' ? options.gpuLayers : 20
      events.push(`load ${gpuLayers}`)
      return {
        gpuLayers,
        dispose: async () => {
          events.push(`dispose ${gpuLayers}`)
        },
        createContext: async (options: Record<string, unknown>) => {
          contextOptions.push(options)
          if (gpuLayers > 10)
            throw new Error('A context size of 4096 is too large for the available VRAM')
          return { contextSize: 8192, getSequence: () => ({}), dispose: async () => {} }
        },
      }
    })
    const result = await allocateChat({
      loadModel,
      modelPath: 'test.gguf',
      plan,
      batchSize: 254,
      onLoadProgress: () => {},
      log: () => {},
    })
    expect(result.model.gpuLayers).toBe(10)
    expect(events).toEqual(['load 20', 'dispose 20', 'load 10'])
    expect(
      contextOptions.every(
        (o) => typeof o.contextSize === 'object' && (o.contextSize as { min: number }).min >= 4096,
      ),
    ).toBe(true)
  })
  it('fails after bounded GPU attempts without falling back to CPU or hiding corrupt models', async () => {
    const dispose = vi.fn(async () => {})
    const loadModel = vi.fn(async (options) => {
      const gpuLayers = typeof options.gpuLayers === 'number' ? options.gpuLayers : 20
      return {
        gpuLayers,
        dispose,
        createContext: async () => {
          if (gpuLayers) throw new Error('Insufficient VRAM')
          return { contextSize: 4096, getSequence: () => ({}), dispose: async () => {} }
        },
      }
    })
    const options = {
      loadModel,
      modelPath: 'test.gguf',
      plan,
      batchSize: 254,
      onLoadProgress: () => {},
      log: () => {},
    }
    await expect(allocateChat(options)).rejects.toThrow('Insufficient VRAM')
    expect(loadModel.mock.calls.every(([options]) => options.gpuLayers !== 0)).toBe(true)
    expect(loadModel).toHaveBeenCalledTimes(4)
    expect(dispose).toHaveBeenCalledTimes(4)
    const broken = vi.fn().mockRejectedValue(new Error('Invalid GGUF magic'))
    await expect(allocateChat({ ...options, loadModel: broken })).rejects.toThrow('Invalid GGUF')
    expect(broken).toHaveBeenCalledOnce()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { LlamaService } from '@main/services/llm/LlamaService'
import type { ResourcePlanner } from '@main/services/embeddings/ResourcePlanner'
import type { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'

describe('concurrent first model use', () => {
  it('shares device probing before the native load starts, and allows retry after failure', async () => {
    let rejectProbe!: (error: Error) => void
    const pending = new Promise<never>((_resolve, reject) => {
      rejectProbe = reject
    })
    const refresh = vi.fn().mockReturnValueOnce(pending).mockRejectedValue(new Error('probe retry'))
    const mainProbe = vi.fn()
    const pinDevice = vi.fn().mockResolvedValue(false)
    const service = new LlamaService({
      planner: { refreshIfStale: mainProbe } as unknown as ResourcePlanner,
      client: {
        setStatusListener: vi.fn(),
        setDevicePlan: pinDevice,
        refreshResources: refresh,
      } as unknown as ModelsWorkerClient,
    })
    const first = service.ensureLoaded()
    const second = service.ensureLoaded()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(mainProbe).not.toHaveBeenCalled()
    expect(pinDevice.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]!)
    rejectProbe(new Error('probe failed'))
    const result = await Promise.allSettled([first, second])
    expect(result.every((r) => r.status === 'rejected')).toBe(true)
    expect(service.getStatus()).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('selected GPU'),
    })
    await expect(service.ensureLoaded()).rejects.toThrow('probe retry')
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})

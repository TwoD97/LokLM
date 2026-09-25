import { afterEach, expect, it, vi } from 'vitest'
import { LlamaService } from '@main/services/llm/LlamaService'
import type { LlmLoadResult } from '@main/services/workers/protocol'
import type { ModelStatus } from '@shared/documents'

afterEach(() => vi.useRealTimers())

it('refreshes context planning after automatic restoration and protects parked chat from idle unload', async () => {
  vi.useFakeTimers()
  let status!: (patch: Partial<ModelStatus>) => void
  let loaded!: (result: LlmLoadResult) => void
  const unload = vi.fn(async () => {})
  const service = new LlamaService({
    client: {
      setStatusListener: (_kind: string, callback: typeof status) => {
        status = callback
      },
      setLlmLoadListener: (callback: typeof loaded) => {
        loaded = callback
      },
      llmUnload: unload,
    } as never,
  })
  service.setIdleMs(5_000)
  const result = {
    plan: { contextSize: 4096 },
    resources: {},
    gpuLabel: 'vulkan',
    resolvedPlacement: 'gpu',
  } as LlmLoadResult
  loaded(result)
  status({ state: 'ready', resident: false })
  await vi.advanceTimersByTimeAsync(20_000)
  expect(unload).not.toHaveBeenCalled()
  loaded({ ...result, plan: { ...result.plan, contextSize: 8192 } })
  status({ state: 'ready', resident: true })
  expect(service.contextWindowTokens()).toBe(8192)
  await vi.advanceTimersByTimeAsync(4_000)
  expect(unload).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(2_000)
  expect(unload).toHaveBeenCalledOnce()
})

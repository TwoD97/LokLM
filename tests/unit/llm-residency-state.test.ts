import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlamaService } from '@main/services/llm/LlamaService'
import type { LlmLoadResult } from '@main/services/workers/protocol'
import type { ModelStatus } from '@shared/documents'

afterEach(() => vi.useRealTimers())

describe('preparing the actual answer context after retrieval', () => {
  it('restores parked chat and reports the newly allocated window, not its old plan', async () => {
    let status!: (patch: Partial<ModelStatus>) => void
    let loaded!: (result: LlmLoadResult) => void
    const allocation = (contextSize: number) =>
      ({
        plan: { contextSize },
        resources: {},
        gpuLabel: 'vulkan',
        resolvedPlacement: 'gpu',
      }) as LlmLoadResult
    const restore = vi.fn(async () => {
      loaded(allocation(4096))
      status({ state: 'ready', resident: true })
    })
    const service = new LlamaService({
      client: {
        setStatusListener: (_kind: string, cb: typeof status) => {
          status = cb
        },
        setLlmLoadListener: (cb: typeof loaded) => {
          loaded = cb
        },
        restoreChat: restore,
      } as never,
    })
    service.setIdleMs(0)
    loaded(allocation(8192))
    status({ state: 'ready', resident: false })
    expect(service.contextWindowTokens()).toBe(8192)
    await expect(service.prepareContext()).resolves.toBe(4096)
    expect(restore).toHaveBeenCalledOnce()
  })

  it.each(['cancel', 'lock'] as const)(
    'rejects capacity after %s while restoration is pending',
    async (kind) => {
      let status!: (patch: Partial<ModelStatus>) => void
      let finish!: () => void
      const restore = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }),
      )
      const service = new LlamaService({
        client: {
          setStatusListener: (_kind: string, cb: typeof status) => {
            status = cb
          },
          restoreChat: restore,
        } as never,
      })
      service.setIdleMs(0)
      status({ state: 'ready', resident: false })
      const controller = new AbortController()
      const pending = service.prepareContext({ abortSignal: controller.signal })
      const rejected = expect(pending).rejects.toThrow(kind === 'lock' ? /session/ : /abort/i)
      await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce())
      if (kind === 'lock') service.invalidateSession()
      else controller.abort()
      finish()
      await rejected
    },
  )

  it('does no load or restoration for an already cancelled preparation', async () => {
    const service = new LlamaService()
    const load = vi.spyOn(service, 'ensureLoaded')
    await expect(service.prepareContext({ abortSignal: AbortSignal.abort() })).rejects.toThrow(
      /abort/i,
    )
    expect(load).not.toHaveBeenCalled()
  })
})

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

describe('idle unloading during inference', () => {
  it.each(['ask', 'raw'] as const)(
    'keeps %s resident through silent prefill and starts idle time at completion',
    async (kind) => {
      vi.useFakeTimers()
      const fixture = activeRequestFixture()
      const request =
        kind === 'ask' ? fixture.service.ask('Question', []) : fixture.service.generateRaw('Prompt')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(fixture.unload).not.toHaveBeenCalled()
      fixture.finish({ raw: 'Answer' })
      await expect(request).resolves.toBe('Answer')
      await vi.advanceTimersByTimeAsync(4_000)
      expect(fixture.unload).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(fixture.unload).toHaveBeenCalledOnce()
    },
  )

  it('resumes idle unloading after an active request fails', async () => {
    vi.useFakeTimers()
    const fixture = activeRequestFixture()
    const request = fixture.service.generateRaw('Prompt')
    const failed = expect(request).rejects.toThrow('generation failed')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fixture.unload).not.toHaveBeenCalled()
    fixture.fail(new Error('generation failed'))
    await failed
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fixture.unload).toHaveBeenCalledOnce()
  })

  it('keeps a queued request active after another request finishes', async () => {
    vi.useFakeTimers()
    const fixture = activeRequestFixture()
    let finishSecond!: (value: { raw: string }) => void
    const secondResult = new Promise<{ raw: string }>((resolve) => {
      finishSecond = resolve
    })
    fixture.generate.mockReturnValueOnce(fixture.result).mockReturnValueOnce(secondResult)
    const first = fixture.service.generateRaw('First')
    const second = fixture.service.generateRaw('Second')
    fixture.finish({ raw: 'First answer' })
    await first
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fixture.unload).not.toHaveBeenCalled()
    finishSecond({ raw: 'Second answer' })
    await second
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fixture.unload).toHaveBeenCalledOnce()
  })
})

function activeRequestFixture() {
  let status!: (patch: Partial<ModelStatus>) => void
  let loaded!: (result: LlmLoadResult) => void
  let finish!: (value: { raw: string }) => void
  let fail!: (error: Error) => void
  const result = new Promise<{ raw: string }>((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  const generate = vi.fn().mockReturnValue(result)
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
      llmAsk: generate,
      llmGenerateRaw: generate,
      registerStream: () => () => {},
    } as never,
  })
  service.setIdleMs(5_000)
  loaded({
    plan: { contextSize: 4096 },
    resources: {},
    gpuLabel: 'vulkan',
    resolvedPlacement: 'gpu',
  } as LlmLoadResult)
  status({ state: 'ready', resident: true })
  return { service, result, finish, fail, generate, unload }
}

import { describe, expect, it, vi } from 'vitest'
import { LlamaService } from '@main/services/llm/LlamaService'
import { buildSystemPrompt } from '@main/services/llm/prompt'
import type { LlmLoadResult } from '@main/services/workers/protocol'
import type { ModelStatus } from '@shared/documents'

const MODEL = '/synthetic/Qwen3.5-4B-Q4_K_M.gguf'

function result(contextSize: number): LlmLoadResult {
  return {
    plan: {
      contextSize,
      kvCacheType: 'f16',
      fitsInVram: false,
      estimatedFreeVramGBAfterLoad: 1,
      reason: 'test',
    },
    resources: {
      totalRamGB: 32,
      freeRamGB: 8,
      totalVramGB: 4,
      freeVramGB: 1,
      hasGpu: true,
      platform: 'win32',
      osHeadroomGB: 4,
      vramHeadroomGB: 1,
    },
    gpuLabel: 'vulkan',
    resolvedPlacement: 'gpu',
    placementReason: 'test',
    gpuName: 'Synthetic GPU',
    gpuKind: null,
    pinnedDeviceVerified: true,
  }
}

function fixture(initialContext = 8192) {
  let loaded!: (value: LlmLoadResult) => void
  let status!: (value: Partial<ModelStatus>) => void
  let context = initialContext
  const client = {
    setStatusListener: (_kind: string, listener: typeof status) => {
      status = listener
    },
    setLlmLoadListener: (listener: typeof loaded) => {
      loaded = listener
    },
    llmLoad: vi.fn<(payload: unknown) => Promise<LlmLoadResult>>(async () => {
      status({ state: 'ready', resident: true })
      const value = result(context)
      loaded(value)
      return value
    }),
    llmSetLanguage: vi
      .fn<(language: string, prompt: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    restoreChat: vi.fn(async () => {}),
    registerStream: vi.fn(() => () => {}),
    llmAsk: vi.fn(async () => ({ raw: 'A supported answer.' })),
  }
  const service = new LlamaService({ client: client as never })
  service.setIdleMs(0)
  return {
    service,
    client,
    loaded: (size: number) => loaded(result(size)),
    resident: (resident: boolean) => status({ resident }),
    setContext: (size: number) => {
      context = size
    },
  }
}

describe('capacity-aware bundled system prompt synchronization', () => {
  it('uses the actual fitted window after load and deduplicates unchanged language/mode', async () => {
    const { service, client } = fixture()
    await service.loadModel(MODEL, 'full')
    expect(client.llmSetLanguage).toHaveBeenLastCalledWith(
      'en',
      buildSystemPrompt('en', 'standard', { codebase: false }),
    )
    await service.setLanguage('en')
    await service.setCodebaseMode(false)
    expect(client.llmSetLanguage).toHaveBeenCalledOnce()
    expect(service.contextWindowTokens()).toBe(8192)
  })

  it('resynchronizes a restored smaller window before returning prepared capacity', async () => {
    const f = fixture(32768)
    await f.service.loadModel(MODEL, 'full')
    expect(f.client.llmSetLanguage).toHaveBeenLastCalledWith(
      'en',
      buildSystemPrompt('en', 'thorough', { codebase: false }),
    )
    f.client.restoreChat.mockImplementation(async () => f.loaded(8192))
    expect(await f.service.prepareContext()).toBe(8192)
    expect(f.client.llmSetLanguage).toHaveBeenLastCalledWith(
      'en',
      buildSystemPrompt('en', 'standard', { codebase: false }),
    )
    expect(f.client.restoreChat.mock.invocationCallOrder.at(-1)).toBeLessThan(
      f.client.llmSetLanguage.mock.invocationCallOrder.at(-1)!,
    )
  })

  it('refreshes unchanged language after a load push and preserves the explicit codebase bump', async () => {
    const f = fixture(32768)
    await f.service.loadModel(MODEL, 'full')
    f.loaded(4096)
    await f.service.setLanguage('en')
    expect(f.client.llmSetLanguage).toHaveBeenLastCalledWith(
      'en',
      buildSystemPrompt('en', 'standard', { codebase: false }),
    )
    await f.service.setCodebaseMode(true)
    expect(f.client.llmSetLanguage).toHaveBeenLastCalledWith(
      'en',
      buildSystemPrompt('en', 'thorough', { codebase: true }),
    )
    await f.service.setLanguage('de')
    expect(f.client.llmSetLanguage).toHaveBeenLastCalledWith(
      'de',
      buildSystemPrompt('de', 'thorough', { codebase: true }),
    )
    await f.service.setCodebaseMode(false)
    expect(f.client.llmSetLanguage).toHaveBeenLastCalledWith(
      'de',
      buildSystemPrompt('de', 'standard', { codebase: false }),
    )
  })

  it('restores a parked direct caller before choosing the actual prompt and answer budget', async () => {
    const f = fixture(32768)
    await f.service.loadModel(MODEL, 'full')
    f.resident(false)
    f.client.restoreChat.mockImplementation(async () => {
      f.loaded(8192)
      f.resident(true)
    })
    await expect(f.service.ask('Question', [])).resolves.toBe('A supported answer.')
    expect(f.client.restoreChat).toHaveBeenCalledOnce()
    expect(f.client.llmSetLanguage).toHaveBeenLastCalledWith(
      'en',
      buildSystemPrompt('en', 'standard', { codebase: false }),
    )
    expect(f.client.llmSetLanguage.mock.invocationCallOrder.at(-1)).toBeLessThan(
      f.client.llmAsk.mock.invocationCallOrder[0]!,
    )
    expect(f.client.llmAsk).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 2048 }))
  })

  it('does not seed a new load with the previous model window', async () => {
    const f = fixture()
    await f.service.loadModel(MODEL, 'full')
    f.setContext(32768)
    await f.service.loadModel(MODEL, 'full')
    expect(f.client.llmLoad.mock.calls.at(-1)?.[0]).toMatchObject({
      systemPrompt: buildSystemPrompt('en', 'thorough', { codebase: false }),
    })
    expect(f.client.llmSetLanguage).toHaveBeenLastCalledWith(
      'en',
      buildSystemPrompt('en', 'thorough', { codebase: false }),
    )
  })

  it('does not dispatch an answer when the authoritative prompt update fails', async () => {
    const f = fixture(32768)
    await f.service.loadModel(MODEL, 'full')
    f.loaded(8192)
    f.client.llmSetLanguage.mockRejectedValueOnce(new Error('worker unavailable'))
    await expect(f.service.ask('Question', [])).rejects.toThrow('worker unavailable')
    expect(f.client.llmAsk).not.toHaveBeenCalled()
    await f.service.setLanguage('en')
    expect(f.client.llmSetLanguage).toHaveBeenCalledTimes(3)
    expect(f.client.llmSetLanguage).toHaveBeenLastCalledWith(
      'en',
      buildSystemPrompt('en', 'standard', { codebase: false }),
    )
  })

  it('does not let an old acknowledgement certify a new load context', async () => {
    const f = fixture(32768)
    await f.service.loadModel(MODEL, 'full')
    let finish!: () => void
    f.loaded(8192)
    f.client.llmSetLanguage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const first = f.service.setLanguage('en')
    f.loaded(16384)
    const second = f.service.setLanguage('en')
    finish()
    await Promise.all([first, second])
    expect(f.client.llmSetLanguage).toHaveBeenCalledTimes(3)
    expect(f.client.llmSetLanguage).toHaveBeenLastCalledWith(
      'en',
      buildSystemPrompt('en', 'thorough', { codebase: false }),
    )
    await f.service.setLanguage('en')
    expect(f.client.llmSetLanguage).toHaveBeenCalledTimes(3)
  })

  it('honors cancellation while awaiting the prepared prompt acknowledgement', async () => {
    const f = fixture(32768)
    await f.service.loadModel(MODEL, 'full')
    let finish: (() => void) | undefined
    f.client.restoreChat.mockImplementation(async () => f.loaded(8192))
    f.client.llmSetLanguage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const controller = new AbortController()
    const pending = f.service.prepareContext({ abortSignal: controller.signal })
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(finish).toBeDefined())
    controller.abort()
    finish!()
    await rejected
  })

  it('does not publish a completed prompt sync after its vault session was retired', async () => {
    const f = fixture(32768)
    await f.service.loadModel(MODEL, 'full')
    let finish!: () => void
    f.loaded(8192)
    f.client.llmSetLanguage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const pending = f.service.setLanguage('en')
    const rejected = expect(pending).rejects.toThrow('Model session is closed')
    f.service.invalidateSession()
    finish()
    await rejected
    expect(f.service.getStatus().resident).toBe(false)
    expect(f.client.llmSetLanguage).toHaveBeenCalledTimes(2)
  })
})

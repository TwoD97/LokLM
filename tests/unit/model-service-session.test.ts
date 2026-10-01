import { describe, expect, it, vi } from 'vitest'
import { deferred } from './fixtures/retrievalHarness'
import type { LlmLoadResult } from '@main/services/workers/protocol'
import type { EmbedderStatus, RerankerStatus } from '@shared/documents'

vi.mock('@main/services/models/paths', () => ({
  getModelSearchDirs: () => ['/models'],
  resolveModelFile: () => '/models/test.gguf',
  listVisibleGgufs: () => [],
}))

import { LlamaService } from '@main/services/llm/LlamaService'
import { EmbeddingService } from '@main/services/embeddings/EmbeddingService'
import { RerankerService } from '@main/services/retrieval/RerankerService'

const resources = { hasGpu: true, totalVramGB: 8, freeVramGB: 6, totalRamGB: 32 }
const loaded = { resources, resolvedPlacement: 'gpu', reason: 'fresh' }
const llmResult = (contextSize: number) =>
  ({
    ...loaded,
    plan: { contextSize, reason: 'test' },
    gpuLabel: 'vulkan',
  }) as unknown as LlmLoadResult

describe('retiring model service continuations on vault lock', () => {
  it('does not let an old LLM load overwrite or clear the next session load', async () => {
    const old = deferred<LlmLoadResult>()
    const fresh = deferred<LlmLoadResult>()
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const service = new LlamaService({
      client: { setStatusListener: vi.fn(), llmLoad: load } as never,
    })
    service.setIdleMs(0)
    const retired = service.loadModel('/models/old.gguf')
    const rejected = expect(retired).rejects.toThrow('session is closed')
    service.invalidateSession()
    const current = service.loadModel('/models/new.gguf')
    old.resolve(llmResult(4096))
    await rejected
    const deduped = service.loadModel('/models/new.gguf')
    expect(load).toHaveBeenCalledTimes(2)
    fresh.resolve(llmResult(8192))
    await Promise.all([current, deduped])
    expect(service.contextWindowTokens()).toBe(8192)
  })

  it('keeps a late LLM failure from reporting failure in a locked session', async () => {
    const old = deferred<LlmLoadResult>()
    const service = new LlamaService({
      client: { setStatusListener: vi.fn(), llmLoad: () => old.promise } as never,
    })
    const request = service.loadModel('/models/model.gguf')
    const rejected = expect(request).rejects.toThrow('session is closed')
    service.invalidateSession()
    old.reject(new Error('old native allocation failed'))
    await rejected
    expect(service.getStatus()).toMatchObject({ state: 'unloaded', resident: false, message: null })
  })

  it('retires pre-load hardware probes without clearing a newer autoload promise', async () => {
    const old = deferred<typeof resources>()
    const fresh = deferred<typeof resources>()
    const refresh = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const service = new LlamaService({
      client: {
        setStatusListener: vi.fn(),
        setDevicePlan: vi.fn(),
        refreshResources: refresh,
      } as never,
    })
    const first = service.ensureLoaded()
    const rejected = expect(first).rejects.toThrow('session is closed')
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    service.invalidateSession()
    const second = service.ensureLoaded()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    old.reject(new Error('old probe failed'))
    await rejected
    const third = service.ensureLoaded()
    expect(refresh).toHaveBeenCalledTimes(2)
    fresh.resolve({ ...resources, hasGpu: false })
    await Promise.all([second, third])
  })

  it('does not let old embedding loads overwrite fresh model metadata or its pending promise', async () => {
    const old = deferred<typeof loaded>()
    const fresh = deferred<typeof loaded>()
    let push!: (status: Partial<EmbedderStatus>) => void
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const service = new EmbeddingService({
      client: {
        setStatusListener: (_: string, cb: typeof push) => {
          push = cb
        },
        embedderLoad: load,
      } as never,
    })
    const first = service.ensureReady()
    service.invalidateSession()
    const second = service.ensureReady()
    old.resolve({ ...loaded, reason: 'retired' })
    expect(await first).toBe(false)
    const third = service.ensureReady()
    expect(load).toHaveBeenCalledTimes(2)
    expect(service.info().placementReason).toBeNull()
    push({ state: 'ready', resident: true })
    fresh.resolve(loaded)
    expect(await second).toBe(true)
    expect(await third).toBe(true)
    expect(service.info().placementReason).toBe('fresh')
  })

  it('discards an embedding result computed for a retired session', async () => {
    const result = deferred<number[][]>()
    let push!: (status: Partial<EmbedderStatus>) => void
    const embed = vi.fn(() => result.promise)
    const service = new EmbeddingService({
      client: {
        setStatusListener: (_: string, cb: typeof push) => {
          push = cb
        },
        embedderEmbed: embed,
      } as never,
    })
    push({ state: 'ready', resident: true })
    const request = service.embedPassages(['private source'])
    const rejected = expect(request).rejects.toThrow('session is closed')
    await vi.waitFor(() => expect(embed).toHaveBeenCalledOnce())
    service.invalidateSession()
    result.resolve([[0.1, 0.2]])
    await rejected
    expect(service.isReady()).toBe(false)
    expect(service.queryCacheKey('private query')).toBeNull()
  })

  it('does not let a retired reranker load alter new-session readiness or metadata', async () => {
    const old = deferred<typeof loaded>()
    const fresh = deferred<typeof loaded>()
    let push!: (status: Partial<RerankerStatus>) => void
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const service = new RerankerService({
      client: {
        setStatusListener: (_: string, cb: typeof push) => {
          push = cb
        },
        refreshResources: vi.fn().mockResolvedValue(resources),
        rerankerLoad: load,
      } as never,
    })
    const first = service.ensureReady()
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
    service.invalidateSession()
    const second = service.ensureReady()
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    old.resolve({ ...loaded, reason: 'retired' })
    expect(await first).toBe(false)
    const third = service.ensureReady()
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(2)
    expect(service.info().placementReason).toBeNull()
    push({ state: 'ready', resident: true })
    fresh.resolve(loaded)
    expect(await second).toBe(true)
    expect(await third).toBe(true)
    expect(service.info().placementReason).toBe('fresh')
  })
})

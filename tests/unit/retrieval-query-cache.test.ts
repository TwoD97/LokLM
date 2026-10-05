import { afterEach, describe, expect, it, vi } from 'vitest'
import { deferred, FLAT, hit, retrievalHarness } from './fixtures/retrievalHarness'

vi.mock('@main/services/retrieval/trace', () => ({ retrievalTrace: () => {} }))
afterEach(() => vi.unstubAllEnvs())

describe('query cache in production retrieval', () => {
  it('keeps a shared embedding alive until its final search is canceled', async () => {
    vi.stubEnv('LOKLM_QUERY_EMBEDDING_CACHE', '1')
    const { service, embed, embedder, dense } = retrievalHarness()
    Object.assign(embedder, { queryCacheKey: (query: string) => query })
    const pending = deferred<Float32Array[]>()
    embed.mockReturnValue(pending.promise)
    const first = new AbortController()
    const second = new AbortController()
    const firstResult = service.search(1, 'Shared query', 2, { ...FLAT, abortSignal: first.signal })
    const secondResult = service.search(1, 'Shared query', 2, {
      ...FLAT,
      abortSignal: second.signal,
    })
    const firstStopped = expect(firstResult).rejects.toMatchObject({ name: 'AbortError' })
    const secondStopped = expect(secondResult).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(embed).toHaveBeenCalledOnce())
    const sharedSignal = embed.mock.calls[0]![1]?.abortSignal
    expect(sharedSignal).toBeInstanceOf(AbortSignal)
    first.abort()
    await firstStopped
    expect(sharedSignal?.aborted).toBe(false)
    second.abort()
    await secondStopped
    expect(sharedSignal?.aborted).toBe(true)
    // Native work can still finish its current batch; neither canceled search
    // may use that result to query the vector store.
    pending.resolve([new Float32Array([1, 0])])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dense).not.toHaveBeenCalled()
  })

  it.each([
    { raw: undefined, enabled: true },
    { raw: '', enabled: true },
    { raw: '1', enabled: true },
    { raw: '0', enabled: false },
  ])(
    'defaults on with an explicit opt-out (%j), while source searches always stay live',
    async ({ raw, enabled }) => {
      vi.stubEnv('LOKLM_QUERY_EMBEDDING_CACHE', raw)
      const { service, lexical, dense, embed, embedder } = retrievalHarness()
      Object.assign(embedder, { queryCacheKey: (query: string) => query })
      lexical.mockResolvedValue([hit(1)])
      dense.mockResolvedValue([hit(2)])
      await service.search(1, 'Revenue outlook', 2, FLAT)
      lexical.mockResolvedValue([hit(3)])
      dense.mockResolvedValue([hit(4)])
      const second = await service.search(1, 'Revenue outlook', 2, FLAT)
      expect(embed).toHaveBeenCalledTimes(enabled ? 1 : 2)
      expect(lexical).toHaveBeenCalledTimes(2)
      expect(dense).toHaveBeenCalledTimes(2)
      expect(second.map((item) => item.chunk_id)).toEqual([3, 4])
    },
  )

  it('bypasses providers without a reliable key under the enabled default', async () => {
    vi.stubEnv('LOKLM_QUERY_EMBEDDING_CACHE', undefined)
    const { service, embed } = retrievalHarness()
    await service.search(1, 'Revenue outlook', 2, FLAT)
    await service.search(1, 'Revenue outlook', 2, FLAT)
    expect(embed).toHaveBeenCalledTimes(2)
  })
})

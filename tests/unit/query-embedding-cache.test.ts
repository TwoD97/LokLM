import { describe, expect, it, vi } from 'vitest'
import { QueryEmbeddingCache } from '@main/services/retrieval/QueryEmbeddingCache'
import { deferred } from './fixtures/retrievalHarness'

describe('bounded session query-vector cache', () => {
  it('evicts by LRU and vector bytes, and protects cached vectors from mutation', async () => {
    const cache = new QueryEmbeddingCache(2, 16)
    const compute = vi.fn().mockResolvedValue(new Float32Array([1, 2]))
    const first = await cache.get('a', compute)
    first![0] = 99
    await cache.get('b', compute)
    expect(await cache.get('a', compute)).toEqual(new Float32Array([1, 2]))
    await cache.get('c', compute)
    expect(cache.snapshot()).toMatchObject({ entries: 2, bytes: 16, hits: 1, misses: 3 })
    await cache.get('b', compute)
    expect(compute).toHaveBeenCalledTimes(4)
    const byteBound = new QueryEmbeddingCache(10, 8)
    await byteBound.get('a', compute)
    await byteBound.get('b', compute)
    expect(byteBound.snapshot()).toMatchObject({ entries: 1, bytes: 8 })
  })

  it('deduplicates work while cancellation detaches only the canceled caller', async () => {
    const cache = new QueryEmbeddingCache()
    const pending = deferred<Float32Array | null>()
    const compute = vi.fn().mockReturnValue(pending.promise)
    const ctrl = new AbortController()
    const canceled = cache.get('same', compute, ctrl.signal)
    const healthy = cache.get('same', compute)
    const canceledAssertion = expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(compute).toHaveBeenCalledTimes(1))
    ctrl.abort()
    await canceledAssertion
    pending.resolve(new Float32Array([1, 2]))
    expect(await healthy).toEqual(new Float32Array([1, 2]))
    expect(cache.snapshot()).toMatchObject({ entries: 1, coalesced: 1 })
  })

  it('does not cache a native result whose only consumer canceled', async () => {
    const cache = new QueryEmbeddingCache()
    const pending = deferred<Float32Array | null>()
    const compute = vi.fn().mockReturnValue(pending.promise)
    const ctrl = new AbortController()
    const result = cache.get('private', compute, ctrl.signal)
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(compute).toHaveBeenCalled())
    ctrl.abort()
    await assertion
    pending.resolve(new Float32Array([1]))
    await Promise.resolve()
    await Promise.resolve()
    expect(cache.snapshot()).toMatchObject({ entries: 0, pending: 0 })
    await cache.get('private', async () => new Float32Array([2]))
    expect(cache.snapshot()).toMatchObject({ misses: 2 })
  })

  it('starts no native work when canceled before its microtask begins', async () => {
    const cache = new QueryEmbeddingCache()
    const compute = vi.fn().mockResolvedValue(new Float32Array([1]))
    const ctrl = new AbortController()
    const result = cache.get('query', compute, ctrl.signal)
    ctrl.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(compute).not.toHaveBeenCalled()
    expect(cache.snapshot()).toMatchObject({ entries: 0 })
  })

  it('clears on provider changes and rejects late cache insertion from the old provider', async () => {
    const cache = new QueryEmbeddingCache()
    const pending = deferred<Float32Array | null>()
    cache.useProvider({})
    await cache.get('resident', async () => new Float32Array([1]))
    const result = cache.get('pending', () => pending.promise)
    cache.useProvider({})
    pending.resolve(new Float32Array([2]))
    await result
    expect(cache.snapshot()).toMatchObject({ entries: 0 })
    expect(await cache.get('resident', async () => new Float32Array([3]))).toEqual(
      new Float32Array([3]),
    )
  })

  it.each([new Float32Array(), new Float32Array([NaN]), new Float32Array(5)])(
    'does not retain invalid or oversized vectors %#',
    async (vector) => {
      const cache = new QueryEmbeddingCache(2, 16)
      const compute = vi.fn().mockResolvedValue(vector)
      await cache.get('key', compute)
      await cache.get('key', compute)
      expect(compute).toHaveBeenCalledTimes(2)
      expect(cache.snapshot()).toMatchObject({ entries: 0 })
    },
  )

  it('bounds the pending map while allowing overflow requests to run uncached', async () => {
    const cache = new QueryEmbeddingCache(2, 16, 1)
    const pending = deferred<Float32Array | null>()
    const first = cache.get('a', () => pending.promise)
    expect(await cache.get('b', async () => new Float32Array([2]))).toEqual(new Float32Array([2]))
    expect(cache.snapshot()).toMatchObject({ pending: 1, entries: 0 })
    pending.resolve(new Float32Array([1]))
    await first
    expect(cache.snapshot()).toMatchObject({ entries: 1 })
  })
})

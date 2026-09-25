import { afterEach, describe, expect, it, vi } from 'vitest'
import { GpuWorkCoordinator } from '@main/services/workers/GpuWorkCoordinator'

afterEach(() => vi.useRealTimers())
const job = { workspaceId: 1, title: 'document.pdf' }

describe('GPU ownership across bulk indexing', () => {
  it('holds chat until all jobs finish and restoration completes', async () => {
    vi.useFakeTimers()
    let restored!: () => void
    const restore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          restored = resolve
        }),
    )
    const coordinator = new GpuWorkCoordinator(restore, vi.fn())
    const a = coordinator.acquire(job)
    const b = coordinator.acquire({ ...job, workspaceId: 2 })
    const chat = vi.fn()
    const waiting = coordinator.waitForChat().then(chat)
    a.update(4, 12)
    expect(coordinator.status().jobs[0]).toMatchObject({ done: 4, total: 12 })
    a.release()
    await vi.advanceTimersByTimeAsync(500)
    expect(restore).not.toHaveBeenCalled()
    b.release()
    expect(coordinator.status().phase).toBe('restoring')
    await vi.advanceTimersByTimeAsync(250)
    expect(chat).not.toHaveBeenCalled()
    restored()
    await waiting
    expect(chat).toHaveBeenCalledOnce()
    expect(coordinator.status().phase).toBe('idle')
  })
  it('does not reload chat between queued documents', async () => {
    vi.useFakeTimers()
    const restore = vi.fn(async () => {})
    const coordinator = new GpuWorkCoordinator(restore, vi.fn())
    coordinator.acquire(job).release()
    await vi.advanceTimersByTimeAsync(100)
    const next = coordinator.acquire(job)
    await vi.advanceTimersByTimeAsync(500)
    expect(restore).not.toHaveBeenCalled()
    next.release()
    next.release()
    await vi.advanceTimersByTimeAsync(500)
    expect(restore).toHaveBeenCalledOnce()
  })
  it('unblocks requests and reports restoration failure instead of hanging', async () => {
    vi.useFakeTimers()
    const coordinator = new GpuWorkCoordinator(async () => {
      throw new Error('GPU full')
    }, vi.fn())
    const lease = coordinator.acquire(job)
    const waiting = coordinator.waitForChat()
    lease.release()
    await vi.advanceTimersByTimeAsync(250)
    await waiting
    expect(coordinator.status()).toMatchObject({
      phase: 'error',
      error: expect.stringContaining('GPU full'),
    })
  })
  it('does not restore or accept new work during shutdown', async () => {
    vi.useFakeTimers()
    const restore = vi.fn(async () => {})
    const coordinator = new GpuWorkCoordinator(restore, vi.fn())
    const lease = coordinator.acquire(job)
    const waiting = coordinator.waitForChat().catch((e: Error) => e.message)
    coordinator.reset(undefined, true)
    lease.release()
    await vi.advanceTimersByTimeAsync(500)
    expect(await waiting).toMatch(/shutting down/)
    expect(restore).not.toHaveBeenCalled()
    expect(() => coordinator.acquire(job)).toThrow(/shutting down/)
  })
  it('releases waiting foreground work after the debounce without restoring on a small GPU', async () => {
    vi.useFakeTimers()
    const restore = vi.fn(async () => {})
    const coordinator = new GpuWorkCoordinator(restore, vi.fn(), () => false)
    const lease = coordinator.acquire(job)
    const foreground = vi.fn()
    const waiting = coordinator.waitForChat().then(foreground)
    lease.release()
    expect(coordinator.status().phase).toBe('indexing')
    await vi.advanceTimersByTimeAsync(249)
    expect(foreground).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(foreground).toHaveBeenCalledOnce()
    expect(restore).not.toHaveBeenCalled()
    expect(coordinator.status().phase).toBe('idle')
  })
  it('keeps a lazy gate closed across queued documents and releases all waiting callers', async () => {
    vi.useFakeTimers()
    const coordinator = new GpuWorkCoordinator(vi.fn(), vi.fn(), () => false)
    coordinator.acquire(job).release()
    const foreground = vi.fn()
    const waiting = coordinator.waitForChat().then(foreground)
    await vi.advanceTimersByTimeAsync(100)
    const next = coordinator.acquire(job)
    await vi.advanceTimersByTimeAsync(500)
    expect(foreground).not.toHaveBeenCalled()
    next.release()
    await vi.advanceTimersByTimeAsync(250)
    await waiting
    expect(foreground).toHaveBeenCalledOnce()
  })
  it('preserves model errors when a lazy indexing gate is released', async () => {
    vi.useFakeTimers()
    const coordinator = new GpuWorkCoordinator(vi.fn(), vi.fn(), () => false)
    const lease = coordinator.acquire(job)
    coordinator.setTransition({
      phase: 'error',
      target: 'embedder',
      stage: null,
      progress: null,
      error: 'GPU unavailable',
    })
    lease.release()
    await vi.advanceTimersByTimeAsync(250)
    await coordinator.waitForChat()
    expect(coordinator.status()).toMatchObject({ phase: 'error', error: 'GPU unavailable' })
  })
})

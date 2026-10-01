import { describe, expect, it, vi } from 'vitest'
import { SessionCloseGate } from './sessionCloseGate'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('vault close admission', () => {
  it('blocks new login ownership throughout the drain and final key wipe', async () => {
    const gate = new SessionCloseGate()
    const drain = deferred()
    const wipe = deferred()
    const opened = vi.fn()
    const closing = gate.close(async () => {
      await drain.promise
      await wipe.promise
    })
    const login = gate.waitForClose().then(opened)
    await Promise.resolve()
    expect(opened).not.toHaveBeenCalled()
    drain.resolve()
    await Promise.resolve()
    expect(opened).not.toHaveBeenCalled()
    wipe.resolve()
    await closing
    await login
    expect(opened).toHaveBeenCalledOnce()
  })

  it('deduplicates repeated locks and publishes ownership before callbacks run', async () => {
    const gate = new SessionCloseGate()
    const finish = deferred()
    const duplicate = vi.fn(async () => undefined)
    let reentrant: Promise<void> | undefined
    const first = gate.close(async () => {
      reentrant = gate.close(duplicate)
      await finish.promise
    })
    expect(reentrant).toBe(first)
    expect(gate.close(duplicate)).toBe(first)
    expect(duplicate).not.toHaveBeenCalled()
    finish.resolve()
    await first
    await gate.close(duplicate)
    expect(duplicate).toHaveBeenCalledOnce()
  })

  it('rejects waiting initialization on cleanup failure and allows a fresh retry', async () => {
    const gate = new SessionCloseGate()
    const drain = deferred()
    const closing = gate.close(() => drain.promise)
    const opening = gate.waitForClose()
    const results = Promise.allSettled([closing, opening])
    drain.reject(new Error('Saving failed'))
    expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected'])
    await expect(gate.waitForClose()).resolves.toBeUndefined()
    await expect(gate.close(async () => undefined)).resolves.toBeUndefined()
  })
})

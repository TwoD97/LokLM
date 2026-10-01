import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'

const credentials = {
  displayName: 'Session test',
  password: 'Session-Regression-42!',
  recoveryLang: 'en' as const,
}

describe('authentication admission and durable session publication', () => {
  let directory: string
  let auth: AuthService
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'loklm-auth-race-'))
    auth = new AuthService(directory)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    auth.setBeforeLock(() => undefined)
    await auth.lock()
    await rm(directory, { recursive: true, force: true })
  })

  it('admits one concurrent registration and preserves the registered vault', async () => {
    const results = await Promise.allSettled([
      auth.register(credentials),
      auth.register(credentials),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    await auth.lock()
    expect(await auth.login(credentials.password)).toEqual({ ok: true })
  })

  it.each(['deriving', 'restoring'] as const)(
    'does not resurrect a session locked during %s',
    async (stage) => {
      await auth.register(credentials)
      await auth.lock()
      let locking: Promise<void> | undefined
      await expect(
        auth.login(credentials.password, {
          onProgress: (current) => {
            if (current === stage) locking = auth.lock()
          },
        }),
      ).rejects.toThrow(/locked/i)
      await locking
      expect(auth.isUnlocked()).toBe(false)
      expect(() => auth.requireDatabase()).toThrow(/locked/i)
      // Cancellation retires only this attempt; the same credentials remain valid.
      expect(await auth.login(credentials.password)).toEqual({ ok: true })
    },
  )

  it('keeps live database handles and pending settings on a duplicate successful login', async () => {
    await auth.register(credentials)
    const store = auth.getWorkspaceStore()
    const workspace = await store.create('Keep this workspace')
    const database = await auth.getWorkspaceDb(workspace.id)
    await database.addDocument({
      title: 'Retained document',
      sourcePath: '/retained.txt',
      status: 'ready',
    })
    auth.setKv('pending-setting', 'retained value')
    expect(await auth.login(credentials.password)).toEqual({ ok: true })
    expect(auth.getWorkspaceStore()).toBe(store)
    expect(await auth.getWorkspaceDb(workspace.id)).toBe(database)
    expect(auth.getKv('pending-setting')).toBe('retained value')
    await auth.lock()
    expect(await auth.login(credentials.password)).toEqual({ ok: true })
    expect(auth.getKv('pending-setting')).toBe('retained value')
    expect(await (await auth.getWorkspaceDb(workspace.id)).listDocuments()).toHaveLength(1)
  })

  it('does not publish an unlocked session if the registration write fails', async () => {
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('simulated full disk'))
    await expect(auth.register(credentials)).rejects.toThrow(/full disk/)
    expect(auth.isUnlocked()).toBe(false)
    expect(() => auth.getWorkspaceStore()).toThrow(/locked/i)
  })

  it('retires private work synchronously before lock starts awaiting database cleanup', async () => {
    await auth.register(credentials)
    const store = auth.getWorkspaceStore()
    const actualClose = store.close.bind(store)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const order: string[] = []
    auth.setBeforeLock(() => {
      order.push('retire private work')
    })
    vi.spyOn(store, 'close').mockImplementation(async () => {
      order.push('close databases')
      await gate
      await actualClose()
    })
    const locking = auth.lock()
    expect(order).toEqual(['retire private work', 'close databases'])
    expect(auth.isUnlocked()).toBe(false)
    expect(() => auth.getWorkspaceStore()).toThrow(/locked/i)
    expect(auth.lock()).toBe(locking)
    release()
    await locking
    expect((await auth.status()).locked).toBe(true)
  })

  it('drains admitted database cleanup before closing stores and allowing a new login', async () => {
    await auth.register(credentials)
    const store = auth.getWorkspaceStore()
    const workspace = await store.create('Drain before lock')
    const database = await auth.getWorkspaceDb(workspace.id)
    const document = await database.addDocument({
      title: 'Remove before snapshot',
      sourcePath: '/drain.txt',
      status: 'ready',
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const order: string[] = []
    const actualClose = store.close.bind(store)
    const close = vi.spyOn(store, 'close').mockImplementation(async () => {
      order.push('close databases')
      await actualClose()
    })
    auth.setBeforeLock(async () => {
      order.push('retire private work')
      await gate
      // New work cannot obtain this handle, but admitted cleanup must retain
      // access to the encrypted store until its drain has finished.
      expect(await database.getDocument(document.id)).not.toBeNull()
      await database.deleteDocument(document.id)
      order.push('cleanup complete')
    })
    const locking = auth.lock()
    const progress = vi.fn()
    const login = auth.login(credentials.password, { onProgress: progress })
    try {
      expect(order).toEqual(['retire private work'])
      expect(auth.isUnlocked()).toBe(false)
      expect(() => auth.requireDatabase()).toThrow(/locked/i)
      expect(auth.lock()).toBe(locking)
      await Promise.resolve()
      expect(close).not.toHaveBeenCalled()
      expect(progress).not.toHaveBeenCalled()
    } finally {
      release()
      await locking
    }
    expect(await login).toEqual({ ok: true })
    expect(order).toEqual(['retire private work', 'cleanup complete', 'close databases'])
    const reopened = await auth.getWorkspaceDb(workspace.id)
    expect(reopened).not.toBe(database)
    expect(await reopened.getDocument(document.id)).toBeNull()
    auth.setBeforeLock(() => undefined)
  })

  it.each(['sync', 'async'] as const)(
    'still closes stores and wipes the session after a %s pre-lock cleanup failure',
    async (kind) => {
      await auth.register(credentials)
      const store = auth.getWorkspaceStore()
      const workspace = await store.create('Failing drain')
      const database = await auth.getWorkspaceDb(workspace.id)
      const close = vi.spyOn(store, 'close')
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const failure = new Error('simulated cleanup failure')
      auth.setBeforeLock(() => {
        if (kind === 'sync') throw failure
        return Promise.reject(failure)
      })
      await expect(auth.lock()).resolves.toBeUndefined()
      expect(close).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledWith('[auth] pre-lock cleanup failed:', failure)
      expect(auth.isUnlocked()).toBe(false)
      expect(() => auth.getWorkspaceStore()).toThrow(/locked/i)
      await expect(database.listDocuments()).rejects.toThrow()
      auth.setBeforeLock(() => undefined)
      expect(await auth.login(credentials.password)).toEqual({ ok: true })
    },
  )

  it('awaits and observes a pre-lock drain while no session key is published', async () => {
    await auth.register(credentials)
    await auth.lock()
    let reject!: (error: Error) => void
    const drain = new Promise<void>((_, rejectDrain) => {
      reject = rejectDrain
    })
    const hook = vi.fn(() => drain)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    auth.setBeforeLock(hook)
    const locking = auth.lock()
    const progress = vi.fn()
    const login = auth.login(credentials.password, { onProgress: progress })
    const failure = new Error('simulated keyless cleanup failure')
    try {
      expect(hook).toHaveBeenCalledOnce()
      expect(auth.lock()).toBe(locking)
      await Promise.resolve()
      expect(progress).not.toHaveBeenCalled()
      expect(auth.isUnlocked()).toBe(false)
    } finally {
      reject(failure)
      await locking
    }
    expect(log).toHaveBeenCalledWith('[auth] pre-lock cleanup failed:', failure)
    expect(await login).toEqual({ ok: true })
    auth.setBeforeLock(() => undefined)
  })

  it('preserves the old password and stays locked when a recovery write fails', async () => {
    const registration = await auth.register(credentials)
    await auth.lock()
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('simulated full disk'))
    await expect(
      auth.reset({
        passphrase: registration.passphrase.join(' '),
        newPassword: 'Recovered-Regression-43!',
      }),
    ).rejects.toThrow(/full disk/)
    expect(auth.isUnlocked()).toBe(false)
    vi.restoreAllMocks()
    expect(await auth.login(credentials.password)).toEqual({ ok: true })
  })
})

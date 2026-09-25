import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { AuthService } from '../../src/main/services/auth/AuthService'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type InternalWriter = { writeVault(header: unknown, body: unknown): Promise<void> }

describe('Durable vault KV transactions', () => {
  let directory: string
  let auth: AuthService
  const readers: AuthService[] = []
  const password = 'Transaction123!'

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'loklm-kv-transaction-'))
    auth = new AuthService(directory)
    await auth.register({ displayName: 'Transaction test', password, recoveryLang: 'en' })
  })

  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    for (const reader of readers.splice(0)) await reader.lock().catch(() => undefined)
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
      await rm(directory, { recursive: true, force: true })
    }
  })

  async function readFresh(): Promise<AuthService> {
    const reader = new AuthService(directory)
    readers.push(reader)
    expect((await reader.login(password)).ok).toBe(true)
    return reader
  }

  function holdFirstWrite(fail = false) {
    const target = auth as unknown as InternalWriter
    const original = target.writeVault.bind(auth)
    const started = deferred()
    const release = deferred()
    let calls = 0
    target.writeVault = async (header, body) => {
      if (++calls === 1) {
        started.resolve()
        await release.promise
        if (fail) throw new Error('Simulated disk failure')
      }
      await original(header, body)
    }
    return { started: started.promise, release: release.resolve, calls: () => calls }
  }

  it('keeps a candidate private and captures unrelated snapshots after its commit', async () => {
    await auth.setKvDurably('organizer', 'Original')
    const gate = holdFirstWrite()
    const saving = auth.setKvDurably('organizer', 'New organizer data')
    await gate.started
    expect(auth.getKv('organizer')).toBe('Original')
    auth.setKv('legacy-settings', 'Latest settings')
    const otherSnapshot = auth.persistSnapshotIfUnlocked()
    expect(gate.calls()).toBe(1)
    gate.release()
    await Promise.all([saving, otherSnapshot])
    const fresh = await readFresh()
    expect(auth.getKv('organizer')).toBe('New organizer data')
    expect(auth.getKv('legacy-settings')).toBe('Latest settings')
    expect(fresh.getKv('organizer')).toBe('New organizer data')
    expect(fresh.getKv('legacy-settings')).toBe('Latest settings')
  })

  it('never leaks a rejected candidate through an unrelated queued snapshot', async () => {
    await auth.setKvDurably('organizer', 'Original')
    const gate = holdFirstWrite(true)
    const saving = auth.setKvDurably('organizer', 'Unsaved secret')
    const failed = expect(saving).rejects.toThrow('Simulated disk failure')
    await gate.started
    auth.setKv('legacy-settings', 'Persist me')
    const otherSnapshot = auth.persistSnapshotIfUnlocked()
    gate.release()
    await Promise.all([failed, otherSnapshot])
    const fresh = await readFresh()
    expect(auth.getKv('organizer')).toBe('Original')
    expect(fresh.getKv('organizer')).toBe('Original')
    expect(fresh.getKv('legacy-settings')).toBe('Persist me')
  })

  it('preserves distinct concurrent mutations and durable deletion across snapshots', async () => {
    await Promise.all([
      auth.setKvDurably('organizer', 'Notes'),
      auth.setKvDurably('settings', 'Dark mode'),
      auth.persistSnapshotIfUnlocked(),
    ])
    expect(auth.getKv('organizer')).toBe('Notes')
    expect(auth.getKv('settings')).toBe('Dark mode')
    await Promise.all([auth.setKvDurably('organizer', null), auth.persistSnapshotIfUnlocked()])
    const fresh = await readFresh()
    expect(fresh.getKv('organizer')).toBeNull()
    expect(fresh.getKv('settings')).toBe('Dark mode')
  })

  it('drains an active write before lock and rejects queued or new mutations during closing', async () => {
    const gate = holdFirstWrite()
    const active = auth.setKvDurably('active', 'Durable')
    await gate.started
    const queued = auth.setKvDurably('queued', 'Must not write')
    const rejectedQueued = expect(queued).rejects.toThrow(/locked/i)
    const locking = auth.lock()
    expect(auth.lock()).toBe(locking)
    await expect(auth.setKvDurably('late', 'Must not write')).rejects.toThrow(/locked/i)
    gate.release()
    await Promise.all([active, rejectedQueued, locking])
    expect(auth.isUnlocked()).toBe(false)
    await expect(auth.setKvDurably('locked', 'Must not write')).rejects.toThrow(/locked/i)
    const fresh = await readFresh()
    expect(fresh.getKv('active')).toBe('Durable')
    expect(fresh.getKv('queued')).toBeNull()
    expect(fresh.getKv('late')).toBeNull()
    expect(fresh.getKv('locked')).toBeNull()
  })

  it('waits for lock before hydrating a subsequent login', async () => {
    const gate = holdFirstWrite()
    const saving = auth.setKvDurably('organizer', 'Keep this')
    await gate.started
    const locking = auth.lock()
    const login = auth.login(password)
    gate.release()
    await Promise.all([saving, locking])
    expect((await login).ok).toBe(true)
    expect(auth.isUnlocked()).toBe(true)
    expect(auth.getKv('organizer')).toBe('Keep this')
  })

  it('merges a concurrent account-header update with durable KV data', async () => {
    const gate = holdFirstWrite()
    const saving = auth.setKvDurably('organizer', 'Keep this')
    await gate.started
    const rename = auth.setDisplayName('Changed display name')
    gate.release()
    await Promise.all([saving, rename])
    const fresh = await readFresh()
    expect((await fresh.status()).displayName).toBe('Changed display name')
    expect(fresh.getKv('organizer')).toBe('Keep this')
  })

  it('leaves the old display name intact when a candidate header fails to persist', async () => {
    const gate = holdFirstWrite(true)
    const rename = auth.setDisplayName('Unsaved display name')
    const failed = expect(rename).rejects.toThrow('Simulated disk failure')
    await gate.started
    const save = auth.setKvDurably('organizer', 'Saved data')
    gate.release()
    await Promise.all([failed, save])
    const fresh = await readFresh()
    expect((await fresh.status()).displayName).toBe('Transaction test')
    expect(fresh.getKv('organizer')).toBe('Saved data')
  })

  it('rejects malformed or oversized transaction arguments before writing', async () => {
    await expect(auth.setKvDurably('', 'Data')).rejects.toThrow('Invalid vault key')
    await expect(auth.setKvDurably('x'.repeat(129), 'Data')).rejects.toThrow('Invalid vault key')
    await expect(auth.setKvDurably('key', 5 as never)).rejects.toThrow('Vault value')
    await expect(auth.setKvDurably('key', 'x'.repeat(32 * 1024 * 1024 + 1))).rejects.toThrow(
      'Vault value',
    )
    expect(auth.getKv('key')).toBeNull()
  })
})

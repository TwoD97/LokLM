import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'

// ADR-0005 end-to-end through the real vault: a workspace + its encrypted LanceDB
// vectors created in one session must survive lock → app restart → login, with
// the VaultManifest (workspace list, default, wrapped WDEK) riding inside the v5
// vault body and the per-workspace files encrypted under <userData>/workspaces.

const DIMS = 16
const vec = (): number[] => Array.from({ length: DIMS }, () => Math.random())

describe('vault workspace manifest round-trip', () => {
  let userDataDir: string

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'loklm-wsvault-'))
  })
  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('persists a workspace + encrypted vectors across lock/login', async () => {
    const target = vec()

    const first = new AuthService(userDataDir)
    await first.register({ displayName: 'Dominik', password: 'Test12345!', recoveryLang: 'de' })

    const ws = first.getWorkspaceStore()
    const entry = await ws.create('Research')
    const store = await ws.open(entry.id)
    await store.upsert([
      { chunkId: 1, documentId: 10, vector: target },
      { chunkId: 2, documentId: 11, vector: vec() },
      { chunkId: 3, documentId: 11, vector: vec() },
    ])
    expect(await store.count()).toBe(3)
    await first.lock() // encrypts the workspace + writes the manifest into the vault

    // simulated restart
    const second = new AuthService(userDataDir)
    const login = await second.login('Test12345!')
    expect(login.ok).toBe(true)

    const ws2 = second.getWorkspaceStore()
    expect(ws2.list().map((w) => w.name)).toEqual(['Research'])
    expect(ws2.getDefaultWorkspaceId()).toBe(entry.id)

    const store2 = await ws2.openDefault()
    expect(store2).not.toBeNull()
    expect(await store2!.count()).toBe(3)
    const hit = (await store2!.search(target, 1))[0]
    expect(hit?.chunkId).toBe(1)
    await second.lock()
  }, 60_000)

  it('recovery passphrase reset keeps workspaces openable', async () => {
    const first = new AuthService(userDataDir)
    const { passphrase } = await first.register({
      displayName: 'Dominik',
      password: 'Test12345!',
      recoveryLang: 'de',
    })
    const ws = first.getWorkspaceStore()
    const entry = await ws.create('Notes')
    const store = await ws.open(entry.id)
    await store.upsert([{ chunkId: 7, documentId: 1, vector: vec() }])
    await first.lock()

    const second = new AuthService(userDataDir)
    const reset = await second.reset({
      passphrase: passphrase.join(' '),
      newPassword: 'Neues12345!',
    })
    expect(reset.ok).toBe(true)
    // master DEK is unchanged by reset, so the WDEK still unwraps
    const ws2 = second.getWorkspaceStore()
    const store2 = await ws2.open(entry.id)
    expect(await store2.count()).toBe(1)
    await second.lock()
  }, 60_000)
})

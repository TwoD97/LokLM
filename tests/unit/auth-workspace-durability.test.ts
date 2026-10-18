import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AuthService } from '@main/services/auth/AuthService'

// Exercise real vault encryption, atomic writes and reloads without native KDF,
// SQLite or LanceDB. Password/KDF strength is outside this persistence test.
vi.mock('argon2', () => ({ default: { argon2id: 2, hash: async () => Buffer.alloc(32, 7) } }))
vi.mock('@main/db/sqlite/WorkspaceDb', () => ({ WorkspaceDb: {} }))
vi.mock('@main/services/storage/LanceWorkspaceStore', () => ({ LanceWorkspaceStore: class {} }))

const credentials = {
  displayName: 'Durability test',
  password: 'Durability-Test-42!',
  recoveryLang: 'en' as const,
}
let directory: string
let auth: AuthService
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'loklm-manifest-'))
  auth = new AuthService(directory)
  await auth.register(credentials)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await auth.lock()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('durable workspace metadata in the encrypted vault', () => {
  it('never reuses orphan bytes when a deleted numeric ID is reused after login', async () => {
    const store = auth.getWorkspaceStore()
    const first = await store.create('Deleted workspace')
    const orphan = join(directory, 'workspaces', first.dir)
    await fs.mkdir(orphan, { recursive: true })
    await fs.writeFile(join(orphan, 'meta.db'), 'old encrypted bytes')
    vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('cleanup denied'))
    await expect(store.delete(first.id)).rejects.toThrow('cleanup denied')
    expect(store.list()).toEqual([])
    await auth.lock()
    expect(await auth.login(credentials.password)).toEqual({ ok: true })
    const replacement = await auth.getWorkspaceStore().create('Replacement')
    expect(replacement.id).toBe(first.id)
    expect(replacement.dir).not.toBe(first.dir)
    expect(await fs.readFile(join(orphan, 'meta.db'), 'utf8')).toBe('old encrypted bytes')
  })

  it('does not save a failed rename through a later settings write or final lock snapshot', async () => {
    const store = auth.getWorkspaceStore()
    const workspace = await store.create('Original')
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'))
    await expect(store.rename(workspace.id, 'Failed rename')).rejects.toThrow('disk full')
    expect(store.list()[0]?.name).toBe('Original')
    await auth.setKvDurably('setting', 'committed')
    await auth.lock()
    expect(await auth.login(credentials.password)).toEqual({ ok: true })
    expect(auth.getKv('setting')).toBe('committed')
    expect(auth.getWorkspaceStore().list()[0]?.name).toBe('Original')
  })

  it('keeps a concurrent durable settings update when committing a workspace candidate', async () => {
    const store = auth.getWorkspaceStore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const writeFile = fs.writeFile.bind(fs)
    const writing = vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
      await gate
      await writeFile(...args)
    })
    const settings = auth.setKvDurably('setting', 'committed')
    await vi.waitFor(() => expect(writing).toHaveBeenCalledOnce())
    const creation = store.create('Concurrent workspace')
    expect(store.list()).toEqual([])
    release()
    await Promise.all([settings, creation])
    await auth.lock()
    expect(await auth.login(credentials.password)).toEqual({ ok: true })
    expect(auth.getKv('setting')).toBe('committed')
    expect(
      auth
        .getWorkspaceStore()
        .list()
        .map((entry) => entry.name),
    ).toEqual(['Concurrent workspace'])
  })
})

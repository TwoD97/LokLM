import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '@main/services/storage/WorkspaceStore'
import { emptyManifest, type VaultManifest } from '@shared/workspaceStorage'
import { deferred } from './fixtures/retrievalHarness'

const fake = vi.hoisted(() => ({
  mkdir: vi.fn(),
  rm: vi.fn(),
  openDb: vi.fn(),
  unwrap: vi.fn(),
  dirs: [] as Array<{ open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>,
  vectors: [] as Array<{
    open: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    count: ReturnType<typeof vi.fn>
    buildIndex: ReturnType<typeof vi.fn>
  }>,
  decrypt: vi.fn(),
  vectorOpen: vi.fn(),
}))
vi.mock('node:fs', () => ({ promises: { mkdir: fake.mkdir, rm: fake.rm } }))
vi.mock('@main/db/sqlite/WorkspaceDb', () => ({ WorkspaceDb: { open: fake.openDb } }))
vi.mock('@main/services/auth/workspaceKeys', () => ({
  createWorkspaceKey: () => ({ wdek: Buffer.alloc(32, 3), wrapped: { fixture: true } }),
  unwrapWorkspaceKey: fake.unwrap,
}))
vi.mock('@main/services/storage/encryptedWorkspaceDir', () => ({
  EncryptedWorkspaceDir: class {
    recovered = false
    open = fake.decrypt
    close = vi.fn(async () => {})
    constructor() {
      fake.dirs.push(this)
    }
  },
}))
vi.mock('@main/services/storage/LanceWorkspaceStore', () => ({
  LanceWorkspaceStore: class {
    open = fake.vectorOpen
    close = vi.fn(async () => {})
    count = vi.fn(async () => 0)
    buildIndex = vi.fn(async () => {})
    constructor() {
      fake.vectors.push(this)
    }
  },
}))

function fixture() {
  const keys: Buffer[] = []
  const persist = vi.fn<(manifest: VaultManifest) => Promise<void>>(async () => {})
  fake.unwrap.mockImplementation(() => {
    const key = Buffer.alloc(32, 7)
    keys.push(key)
    return key
  })
  const store = new WorkspaceStore({
    baseDir: 'D:/fixture-workspaces',
    masterDek: Buffer.alloc(32, 5),
    manifest: emptyManifest(),
    persistManifest: persist,
  })
  return { store, keys, persist }
}

beforeEach(() => {
  vi.resetAllMocks()
  fake.dirs.length = 0
  fake.vectors.length = 0
  fake.mkdir.mockResolvedValue(undefined)
  fake.rm.mockResolvedValue(undefined)
  fake.decrypt.mockResolvedValue('D:/fixture-workspaces/ws-1/work')
  fake.vectorOpen.mockResolvedValue(undefined)
  fake.openDb.mockImplementation(async () => ({ close: vi.fn() }))
})

describe('workspace session lifecycle admission', () => {
  it('publishes metadata only after persistence and does not carry a failed create into the next commit', async () => {
    const { store, persist } = fixture()
    const writing = deferred<void>()
    persist.mockReturnValueOnce(writing.promise)
    const first = store.create('Failed creation')
    const rejected = expect(first).rejects.toThrow('disk full')
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
    expect(store.list()).toEqual([])
    expect(store.getDefaultWorkspaceId()).toBeNull()
    const second = store.create('Successful creation')
    writing.reject(new Error('disk full'))
    await rejected
    const created = await second
    expect(created.id).toBe(2)
    expect(store.list().map((entry) => entry.name)).toEqual(['Successful creation'])
    expect(persist.mock.calls[1]![0].workspaces.map((entry) => entry.name)).toEqual([
      'Successful creation',
    ])
    await store.close()
  })

  it.each(['rename', 'type', 'default'] as const)(
    'keeps a failed %s change out of live state and later commits',
    async (change) => {
      const { store, persist } = fixture()
      const first = await store.create('First')
      const second = await store.create('Second')
      const before = store.list()
      persist.mockRejectedValueOnce(new Error('disk full'))
      const mutation =
        change === 'rename'
          ? store.rename(first.id, 'Uncommitted')
          : change === 'type'
            ? store.setType(first.id, 'codebase')
            : store.setDefault(second.id)
      await expect(mutation).rejects.toThrow('disk full')
      expect(store.list()).toEqual(before)
      expect(store.getDefaultWorkspaceId()).toBe(first.id)
      await store.rename(second.id, 'Committed second')
      expect(persist.mock.calls.at(-1)![0].workspaces[0]).toEqual(before[0])
      expect(persist.mock.calls.at(-1)![0].defaultWorkspaceId).toBe(first.id)
      await store.close()
    },
  )

  it('coalesces concurrent ensure mutations into one durable workspace key', async () => {
    const { store, persist } = fixture()
    const [first, second] = await Promise.all([
      store.ensure(7, 'Library'),
      store.ensure(7, 'Library'),
    ])
    expect(first).toEqual(second)
    expect(store.list()).toHaveLength(1)
    expect(persist).toHaveBeenCalledOnce()
    // Neither a returned entry nor list() grants mutation rights to the store.
    first.name = 'External mutation'
    store.list()[0]!.indexConfig.dims = 3
    expect(store.list()[0]).toMatchObject({ name: 'Library', indexConfig: { dims: 1024 } })
    await store.close()
  })

  it('drains an admitted manifest write on close and rejects queued mutations', async () => {
    const { store, persist } = fixture()
    const writing = deferred<void>()
    persist.mockReturnValueOnce(writing.promise)
    const first = store.create('Admitted')
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
    const queued = store.create('Queued')
    const rejected = expect(queued).rejects.toThrow('session is closed')
    let closed = false
    const closing = store.close().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    writing.resolve()
    await Promise.all([first, rejected, closing])
    expect(persist).toHaveBeenCalledOnce()
  })

  it('keeps workspace files and its manifest when deletion cannot be persisted', async () => {
    const { store, persist } = fixture()
    const workspace = await store.create('Preserve me')
    await store.open(workspace.id)
    persist.mockRejectedValueOnce(new Error('disk full'))
    await expect(store.delete(workspace.id)).rejects.toThrow('disk full')
    expect(fake.rm).not.toHaveBeenCalled()
    expect(fake.dirs[0]!.close).toHaveBeenCalledWith({})
    expect(store.list().map((entry) => entry.id)).toEqual([workspace.id])
    await store.open(workspace.id)
    await store.close()
  })

  it('deduplicates concurrent SQLite opens and wipes exactly the one retained key on close', async () => {
    const { store, keys } = fixture()
    const ws = await store.create('Library')
    const pending = deferred<{ close: ReturnType<typeof vi.fn> }>()
    fake.openDb.mockReturnValue(pending.promise)
    const first = store.openMetaDb(ws.id)
    const second = store.openMetaDb(ws.id)
    await vi.waitFor(() => expect(fake.openDb).toHaveBeenCalledOnce())
    const db = { close: vi.fn() }
    pending.resolve(db)
    expect(await first).toBe(db)
    expect(await second).toBe(db)
    expect(keys).toHaveLength(1)
    await store.close()
    expect(db.close).toHaveBeenCalledOnce()
    expect(keys[0]!.every((byte) => byte === 0)).toBe(true)
  })

  it('never opens SQLite after lock interrupts its directory await', async () => {
    const { store, keys } = fixture()
    const ws = await store.create('Library')
    const mkdir = deferred<void>()
    fake.mkdir.mockReturnValue(mkdir.promise)
    const opening = store.openMetaDb(ws.id)
    const rejected = expect(opening).rejects.toThrow('session is closed')
    const closing = store.close()
    await expect(store.openMetaDb(ws.id)).rejects.toThrow('session is closed')
    mkdir.resolve()
    await Promise.all([rejected, closing])
    expect(fake.openDb).not.toHaveBeenCalled()
    expect(keys[0]!.every((byte) => byte === 0)).toBe(true)
  })

  it('waits for and closes a late SQLite handle instead of retaining it after lock', async () => {
    const { store, keys } = fixture()
    const ws = await store.create('Library')
    const pending = deferred<{ close: ReturnType<typeof vi.fn> }>()
    fake.openDb.mockReturnValue(pending.promise)
    const opening = store.openMetaDb(ws.id)
    const rejected = expect(opening).rejects.toThrow('session is closed')
    await vi.waitFor(() => expect(fake.openDb).toHaveBeenCalledOnce())
    let closed = false
    const closing = store.close().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    const db = { close: vi.fn() }
    pending.resolve(db)
    await Promise.all([rejected, closing])
    expect(db.close).toHaveBeenCalledOnce()
    expect(keys[0]!.every((byte) => byte === 0)).toBe(true)
    expect(store.currentDb()).toBeNull()
  })

  it('wipes the key on directory failure and permits a fresh retry while unlocked', async () => {
    const { store, keys } = fixture()
    const ws = await store.create('Library')
    fake.mkdir.mockRejectedValueOnce(new Error('directory denied'))
    await expect(store.openMetaDb(ws.id)).rejects.toThrow('directory denied')
    expect(keys[0]!.every((byte) => byte === 0)).toBe(true)
    expect(fake.openDb).not.toHaveBeenCalled()
    await store.openMetaDb(ws.id)
    expect(fake.openDb).toHaveBeenCalledOnce()
    await store.close()
    expect(keys.every((key) => key.every((byte) => byte === 0))).toBe(true)
  })

  it('serializes duplicate vector opens and rejects late activation while closing', async () => {
    const { store, keys } = fixture()
    const ws = await store.create('Library')
    const native = deferred<void>()
    fake.vectorOpen.mockReturnValue(native.promise)
    const first = store.open(ws.id)
    const second = store.open(ws.id)
    const assertions = Promise.all([
      expect(first).rejects.toThrow('session is closed'),
      expect(second).rejects.toThrow('session is closed'),
    ])
    await vi.waitFor(() => expect(fake.vectorOpen).toHaveBeenCalledOnce())
    const closing = store.close()
    native.resolve()
    await Promise.all([assertions, closing])
    expect(fake.vectorOpen).toHaveBeenCalledOnce()
    expect(fake.vectors[0]!.close).toHaveBeenCalledOnce()
    expect(fake.dirs[0]!.close).toHaveBeenCalledOnce()
    expect(store.activeWorkspaceId()).toBeNull()
    expect(keys[0]!.every((byte) => byte === 0)).toBe(true)
  })

  it('closes all relational handles and keys even when vector teardown fails', async () => {
    const { store, keys } = fixture()
    const a = await store.create('First')
    const b = await store.create('Second')
    const dbA = await store.openMetaDb(a.id)
    const dbB = await store.openMetaDb(b.id)
    await store.open(a.id)
    fake.vectors[0]!.count.mockRejectedValueOnce(new Error('count failed'))
    const closing = store.close()
    expect(store.close()).toBe(closing)
    await expect(closing).rejects.toThrow('cleanup failed')
    expect(fake.vectors[0]!.close).toHaveBeenCalledOnce()
    expect(fake.dirs[0]!.close).toHaveBeenCalledOnce()
    expect(dbA.close).toHaveBeenCalledOnce()
    expect(dbB.close).toHaveBeenCalledOnce()
    expect(keys.every((key) => key.every((byte) => byte === 0))).toBe(true)
    await expect(store.open(a.id)).rejects.toThrow('session is closed')
  })

  it('drains an in-flight SQLite open before deleting its workspace directory', async () => {
    const { store, keys } = fixture()
    const ws = await store.create('Library')
    const pending = deferred<{ close: ReturnType<typeof vi.fn> }>()
    fake.openDb.mockReturnValue(pending.promise)
    const opening = store.openMetaDb(ws.id)
    const rejected = expect(opening).rejects.toThrow('being deleted')
    await vi.waitFor(() => expect(fake.openDb).toHaveBeenCalledOnce())
    const deleting = store.delete(ws.id)
    await expect(store.openMetaDb(ws.id)).rejects.toThrow('being deleted')
    expect(fake.rm).not.toHaveBeenCalled()
    const db = { close: vi.fn() }
    pending.resolve(db)
    await Promise.all([deleting, rejected])
    expect(db.close).toHaveBeenCalledOnce()
    expect(fake.rm).toHaveBeenCalledOnce()
    expect(keys[0]!.every((byte) => byte === 0)).toBe(true)
    expect(store.list()).toEqual([])
    await store.close()
  })

  it('holds activation behind an entire admitted vector operation, including its async metadata work', async () => {
    const { store } = fixture()
    const first = await store.create('First')
    const second = await store.create('Second')
    const operation = deferred<void>()
    const entered = vi.fn()
    const write = store.withVectorStore(first.id, async (_vectors, metadata) => {
      entered(metadata)
      await operation.promise
      expect(fake.vectors[0]!.close).not.toHaveBeenCalled()
      expect(metadata.close).not.toHaveBeenCalled()
      return 'written'
    })
    await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce())
    const activation = store.open(second.id)
    await Promise.resolve()
    expect(fake.vectorOpen).toHaveBeenCalledOnce()
    expect(store.activeWorkspaceId()).toBeNull() // background work is not selection
    operation.resolve()
    expect(await write).toBe('written')
    await activation
    expect(fake.vectors[0]!.close).toHaveBeenCalledOnce()
    expect(store.activeWorkspaceId()).toBe(second.id)
    await store.close()
  })

  it('holds a workspace open until its native index build finishes before switching vectors', async () => {
    const { store } = fixture()
    const first = await store.create('First')
    const second = await store.create('Second')
    await store.open(first.id)
    const build = deferred<void>()
    fake.vectors[0]!.buildIndex.mockReturnValueOnce(build.promise)
    const indexing = store.buildActiveIndex()
    await vi.waitFor(() => expect(fake.vectors[0]!.buildIndex).toHaveBeenCalledOnce())
    const switching = store.open(second.id)
    await Promise.resolve()
    expect(fake.vectors[0]!.close).not.toHaveBeenCalled()
    build.resolve()
    await Promise.all([indexing, switching])
    expect(fake.vectors[0]!.close).toHaveBeenCalledOnce()
    expect(store.activeWorkspaceId()).toBe(second.id)
    await store.close()
  })

  it('keeps explicit selection and relational routing while another workspace owns a vector lease', async () => {
    const { store } = fixture()
    const a = await store.create('Background')
    const b = await store.create('Selected')
    await store.open(b.id)
    const selectedDb = store.currentDb()
    expect(selectedDb).not.toBeNull()
    await store.withVectorStore(a.id, async (_vectors, metadata) => {
      expect(metadata).not.toBe(selectedDb)
      expect(store.activeWorkspaceId()).toBe(b.id)
      expect(store.currentDb()).toBe(selectedDb)
    })
    expect(store.activeWorkspaceId()).toBe(b.id)
    expect(store.currentDb()).toBe(selectedDb)
    await store.delete(a.id)
    expect(store.currentDb()).toBe(selectedDb)
    await store.close()
    expect(store.currentDb()).toBeNull()
    expect(store.activeWorkspaceId()).toBeNull()
    expect(store.current()).toBeNull()
    expect(() => store.list()).toThrow('session is closed')
    expect(() => store.getDefaultWorkspaceId()).toThrow('session is closed')
    await expect(store.storageFootprint(b.id)).rejects.toThrow('session is closed')
  })

  it.each(['delete', 'lock'] as const)(
    'drains a vector lease before %s closes its handles and key',
    async (action) => {
      const { store, keys } = fixture()
      const ws = await store.create('Library')
      const operation = deferred<void>()
      const entered = vi.fn()
      const search = store.withVectorStore(ws.id, async (_vectors, metadata) => {
        entered(metadata)
        await operation.promise
        expect(metadata.close).not.toHaveBeenCalled()
        expect(keys[0]!.some((byte) => byte !== 0)).toBe(true)
        return 'source result'
      })
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce())
      let finished = false
      const teardown = (action === 'delete' ? store.delete(ws.id) : store.close()).then(() => {
        finished = true
      })
      await Promise.resolve()
      expect(finished).toBe(false)
      expect(fake.vectors[0]!.close).not.toHaveBeenCalled()
      operation.resolve()
      expect(await search).toBe('source result')
      await teardown
      expect(fake.vectors[0]!.close).toHaveBeenCalledOnce()
      expect(keys[0]!.every((byte) => byte === 0)).toBe(true)
      await store.close()
    },
  )
})

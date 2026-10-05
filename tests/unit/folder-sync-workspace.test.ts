import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FolderSyncService } from '@main/services/documents/FolderSyncService'
import { deferred } from './fixtures/retrievalHarness'

const watcher = vi.hoisted(() => ({ watch: vi.fn() }))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  watch: watcher.watch,
}))

let directory: string
beforeEach(async () => {
  watcher.watch.mockReset().mockImplementation(() => ({ close: vi.fn(), on: vi.fn() }))
  directory = await mkdtemp(join(tmpdir(), 'loklm-folder-workspace-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const present = join(directory, 'present.txt')
  const missing = join(directory, 'missing.txt')
  await writeFile(present, 'Source text')
  const docs = [
    { id: 1, sourcePath: present, missingAt: 100 },
    { id: 2, sourcePath: missing, missingAt: null },
  ]
  let activeId = 3
  const original = {
    listDocumentsByWorkspace: vi.fn(async () => {
      activeId = 8
      return docs
    }),
    clearMissing: vi.fn(async () => {}),
    markMissing: vi.fn(async () => {}),
  }
  const other = {
    listDocumentsByWorkspace: vi.fn(async () => docs),
    clearMissing: vi.fn(async () => {}),
    markMissing: vi.fn(async () => {}),
  }
  const workspaces = {
    getSyncFolders: async () => [directory],
    setSyncFolders: vi.fn<(id: number, folders: string[]) => Promise<void>>(async () => {}),
    clearIndexDirs: vi.fn(async () => {}),
    list: async () => [{ id: 3, type: 'library' }],
  }
  const database = {
    documents: () => (activeId === 3 ? original : other),
    documentsFor: vi.fn(async (id: number) => (id === 3 ? original : other)),
    workspaces: () => workspaces,
  }
  const auth = {
    requireDatabase: () => database,
    getWorkspaceStore: () => ({ activeWorkspaceId: () => activeId }),
  }
  const documents = {
    refreshDocument: vi.fn(async () => 'unchanged'),
    deleteDocuments: vi.fn(async () => {}),
    importFile: vi.fn(async () => {}),
  }
  const service = new FolderSyncService(auth as never, documents as never)
  return { service, original, other, database, documents }
}

describe('folder sync workspace ownership', () => {
  it('keeps a failed removal connected and reports the error so cleanup can be retried', async () => {
    const f = await fixture()
    let folders = [directory]
    vi.spyOn(f.database.workspaces(), 'getSyncFolders').mockImplementation(async () => [...folders])
    f.database.workspaces().setSyncFolders.mockImplementation(async (_id, value) => {
      folders = value
    })
    f.documents.deleteDocuments.mockRejectedValueOnce(new Error('Vector store is unavailable'))
    try {
      await expect(f.service.removeFolder(3, directory)).rejects.toThrow(
        'Vector store is unavailable',
      )
      expect(folders).toEqual([directory])
      expect(f.database.workspaces().clearIndexDirs).not.toHaveBeenCalled()
      await expect(f.service.removeFolder(3, directory)).resolves.toEqual([])
      expect(folders).toEqual([])
      expect(f.documents.deleteDocuments).toHaveBeenCalledTimes(2)
    } finally {
      f.service.stopAll()
    }
  })

  it('does not revive removed watchers from an older pending start', async () => {
    const f = await fixture()
    const snapshot = deferred<string[]>()
    vi.spyOn(f.database.workspaces(), 'getSyncFolders').mockReturnValueOnce(snapshot.promise)
    try {
      f.service.start(3)
      await f.service.removeFolder(3, directory)
      snapshot.resolve([directory])
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(watcher.watch).not.toHaveBeenCalled()
    } finally {
      snapshot.resolve([])
      f.service.stopAll()
    }
  })

  it('reports index-selection cleanup failure before disconnecting the folder', async () => {
    const f = await fixture()
    f.database.workspaces().clearIndexDirs.mockRejectedValueOnce(new Error('Settings write failed'))
    try {
      await expect(f.service.removeFolder(3, directory)).rejects.toThrow('Settings write failed')
      expect(f.database.workspaces().setSyncFolders).not.toHaveBeenCalled()
      await expect(f.service.removeFolder(3, directory)).resolves.toEqual([])
    } finally {
      f.service.stopAll()
    }
  })

  it('stopAll also cancels starts that have not attached a watcher yet', async () => {
    const f = await fixture()
    const snapshot = deferred<string[]>()
    vi.spyOn(f.database.workspaces(), 'getSyncFolders').mockReturnValueOnce(snapshot.promise)
    try {
      f.service.start(3)
      f.service.stopAll()
      snapshot.resolve([directory])
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(watcher.watch).not.toHaveBeenCalled()
    } finally {
      snapshot.resolve([])
      f.service.stopAll()
    }
  })

  it('removing a folder cannot leave documents imported by its already-running scan', async () => {
    const path = join(directory, 'pending.txt')
    await writeFile(path, 'A source imported while its folder is being removed.')
    let folders = [directory]
    let rows: Array<{ id: number; sourcePath: string; missingAt: null }> = []
    const importStarted = deferred<void>()
    const finishImport = deferred<void>()
    const repo = { listDocumentsByWorkspace: async () => [...rows] }
    const workspaces = {
      getSyncFolders: async () => [...folders],
      setSyncFolders: async (_id: number, value: string[]) => {
        folders = value
      },
      clearIndexDirs: async () => {},
      list: async () => [{ id: 3, type: 'library' }],
    }
    const documents = {
      importFile: vi.fn(async () => {
        importStarted.resolve()
        await finishImport.promise
        rows.push({ id: 1, sourcePath: path, missingAt: null })
      }),
      deleteDocuments: vi.fn(async (ids: number[]) => {
        rows = rows.filter((row) => !ids.includes(row.id))
      }),
    }
    const service = new FolderSyncService(
      {
        requireDatabase: () => ({
          documents: () => repo,
          documentsFor: async () => repo,
          workspaces: () => workspaces,
        }),
        getWorkspaceStore: () => ({ activeWorkspaceId: () => 3 }),
      } as never,
      documents as never,
    )
    try {
      const scan = service.sync(3)
      await importStarted.promise
      const removal = service.removeFolder(3, directory)
      // Allow the old uncoordinated removal to finish before the import lands.
      await new Promise<void>((resolve) => setImmediate(resolve))
      finishImport.resolve()
      await Promise.all([scan, removal])
      expect(folders).toEqual([])
      expect(rows).toEqual([])
      expect(documents.deleteDocuments).toHaveBeenCalledWith([1], 3)
    } finally {
      finishImport.resolve()
      service.stopAll()
    }
  })

  it('preserves both folder additions when their settings reads overlap', async () => {
    const first = join(directory, 'first')
    const second = join(directory, 'second')
    await Promise.all([mkdir(first), mkdir(second)])
    let folders: string[] = []
    const workspaces = {
      getSyncFolders: async () => [...folders],
      setSyncFolders: async (_id: number, value: string[]) => {
        folders = value
      },
    }
    const service = new FolderSyncService(
      {
        requireDatabase: () => ({ workspaces: () => workspaces }),
        getWorkspaceStore: () => ({ activeWorkspaceId: () => 3 }),
      } as never,
      {} as never,
    )
    vi.spyOn(service, 'classifyFolders').mockResolvedValue({ isCodebase: false } as never)
    try {
      await Promise.all([service.addFolder(3, first), service.addFolder(3, second)])
      expect(folders).toEqual([first, second])
    } finally {
      service.stopAll()
    }
  })

  it('keeps missing markers and refreshes in the original workspace after navigation mid-scan', async () => {
    const f = await fixture()
    const result = await f.service.sync(3)
    expect(result).toMatchObject({ unchanged: 1, markedMissing: 1 })
    expect(f.original.clearMissing).toHaveBeenCalledWith(1)
    expect(f.original.markMissing).toHaveBeenCalledWith(2)
    expect(f.other.clearMissing).not.toHaveBeenCalled()
    expect(f.other.markMissing).not.toHaveBeenCalled()
    expect(f.documents.refreshDocument).toHaveBeenCalledWith(1, undefined, 3)
  })

  it('passes the folder workspace when deleting its indexed documents', async () => {
    const f = await fixture()
    try {
      expect(await f.service.removeFolder(3, directory)).toEqual([])
      expect(f.documents.deleteDocuments).toHaveBeenCalledWith([1, 2], 3)
    } finally {
      f.service.stopAll()
    }
  })

  it('rejects a delayed folder addition after lock without writing settings or reviving watchers', async () => {
    const f = await fixture()
    const folders = deferred<string[]>()
    const getFolders = vi
      .spyOn(f.database.workspaces(), 'getSyncFolders')
      .mockReturnValueOnce(folders.promise)
    const addition = f.service.addFolder(3, directory)
    const rejected = expect(addition).rejects.toThrow('session is closed')
    await vi.waitFor(() => expect(getFolders).toHaveBeenCalledOnce())
    f.service.invalidateSession()
    folders.resolve([])
    await rejected
    expect(f.database.workspaces().setSyncFolders).not.toHaveBeenCalled()
    f.service.start(3)
    expect(getFolders).toHaveBeenCalledOnce()
    await expect(f.service.sync(3)).rejects.toThrow('session is closed')
    expect(f.documents.importFile).not.toHaveBeenCalled()
  })
})

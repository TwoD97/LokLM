import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FolderSyncService } from '@main/services/documents/FolderSyncService'
import { deferred } from './fixtures/retrievalHarness'

let directory: string
beforeEach(async () => {
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
    setSyncFolders: vi.fn(async () => {}),
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

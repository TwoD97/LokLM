import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('node:path')
  vi.resetModules()
})

async function removal(flavor: 'posix' | 'win32', root: string, paths: string[]) {
  vi.resetModules()
  vi.doMock('node:path', async (importOriginal) => {
    const native = await importOriginal<typeof import('node:path')>()
    return { ...native, ...native[flavor] }
  })
  const { FolderSyncService } = await import('@main/services/documents/FolderSyncService')
  const rows = paths.map((sourcePath, index) => ({ id: index + 1, sourcePath }))
  const deleteDocuments = vi.fn(async () => {})
  const service = new FolderSyncService(
    {
      requireDatabase: () => ({
        documents: () => ({ listDocumentsByWorkspace: async () => rows }),
        workspaces: () => ({
          getSyncFolders: async () => [root],
          setSyncFolders: async () => {},
          clearIndexDirs: async () => {},
        }),
      }),
      getWorkspaceStore: () => ({}),
    } as never,
    { deleteDocuments } as never,
  )
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', {
    ...platform,
    value: flavor === 'posix' ? 'linux' : 'win32',
  })
  try {
    await service.removeFolder(1, root)
    return deleteDocuments.mock.calls
  } finally {
    service.stopAll()
    Object.defineProperty(process, 'platform', platform)
  }
}

describe('folder removal follows platform path ownership', () => {
  it('preserves distinct case-sensitive POSIX folders and sibling prefixes', async () => {
    expect(
      await removal('posix', '/data/reports', [
        '/data/reports/owned.txt',
        '/data/Reports/keep.txt',
        '/data/reports-archive/keep.txt',
      ]),
    ).toEqual([[[1], 1]])
  })

  it('recognizes Windows case variants without crossing drives or sibling folders', async () => {
    expect(
      await removal('win32', 'C:\\Data\\Reports', [
        'c:\\data\\reports\\owned.txt',
        'C:\\Data\\Reports-archive\\keep.txt',
        'D:\\Data\\Reports\\keep.txt',
      ]),
    ).toEqual([[[1], 1]])
  })
})

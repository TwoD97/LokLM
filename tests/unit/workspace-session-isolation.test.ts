import { describe, expect, it, vi } from 'vitest'
import { WorkspaceDbFacade } from '@main/services/storage/WorkspaceDbFacade'
import { WorkspaceVectorService } from '@main/services/storage/WorkspaceVectorService'
import { deferred } from './fixtures/retrievalHarness'

function fixture() {
  function makeSession() {
    let closed = false
    const db = {
      workspaceId: 1,
      listDocuments: vi.fn(async () => []),
      addDocument: vi.fn(async () => ({ id: 1 })),
      createConversation: vi.fn(async () => ({ id: 1 })),
      listDecks: vi.fn(async () => []),
      getSyncFolders: vi.fn(async () => []),
      resetEmbeddedMarkers: vi.fn(async () => 0),
      chunkOwners: vi.fn(async () => new Map([[1, 1]])),
      hydrateChunkHits: vi.fn(async () => []),
    }
    const vectors = {
      count: vi.fn(async () => 1),
      upsert: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      search: vi.fn(async () => [{ chunkId: 1, documentId: 1, score: 1 }]),
    }
    const store = {
      list: () => [{ id: 1, name: 'Library' }],
      currentDb: () => db,
      openMetaDb: vi.fn(async () => {
        if (closed) throw new Error('Workspace session is closed.')
        return db
      }),
      ensure: vi.fn(async () => {}),
      open: vi.fn(async () => vectors),
      withVectorStore: vi.fn(
        async (
          _id: number,
          operation: (store: typeof vectors, metadata: typeof db) => Promise<unknown>,
        ) => {
          if (closed) throw new Error('Workspace session is closed.')
          return operation(vectors, db)
        },
      ),
    }
    return {
      db,
      vectors,
      store,
      close: () => {
        closed = true
      },
    }
  }
  const original = makeSession()
  const replacement = makeSession()
  let active = original
  const auth = { getWorkspaceStore: vi.fn(() => active.store) }
  return {
    original,
    replacement,
    auth,
    switchSession: () => {
      active = replacement
    },
  }
}

describe('session-bound relational facades', () => {
  it('keeps every workspace-keyed API on its construction-time store after a new login', async () => {
    const f = fixture()
    const db = new WorkspaceDbFacade(f.auth as never)
    const pinned = await db.documentsFor(1)
    f.switchSession()
    await pinned.addDocument({ workspaceId: 1, title: 'Prior source', sourcePath: '/prior.txt' })
    await pinned.listDocumentsByWorkspace(1)
    await db.conversations().create(1)
    await db.quizzes().listDecks(1)
    await db.workspaces().getSyncFolders(1)
    expect(f.original.db.addDocument).toHaveBeenCalledOnce()
    expect(f.original.db.listDocuments).toHaveBeenCalledOnce()
    expect(f.original.db.createConversation).toHaveBeenCalledOnce()
    expect(f.original.db.listDecks).toHaveBeenCalledOnce()
    expect(f.original.db.getSyncFolders).toHaveBeenCalledOnce()
    expect(f.replacement.store.openMetaDb).not.toHaveBeenCalled()
    expect(f.auth.getWorkspaceStore).toHaveBeenCalledOnce()
    f.original.close()
    await expect(pinned.listDocumentsByWorkspace(1)).rejects.toThrow('session is closed')
    expect(f.replacement.store.openMetaDb).not.toHaveBeenCalled()
  })
})

describe('session-bound vector operations', () => {
  it('keeps admitted reconciliation on its original metadata while lock drains the lease', async () => {
    const f = fixture()
    const count = deferred<number>()
    f.original.vectors.count.mockReturnValueOnce(count.promise)
    const service = new WorkspaceVectorService(f.auth as never)
    const run = service.upsert(1, [{ chunkId: 1, documentId: 1, vector: [1, 0] }])
    await vi.waitFor(() => expect(f.original.vectors.count).toHaveBeenCalledOnce())
    f.original.close()
    f.switchSession()
    count.resolve(0)
    await run
    expect(f.original.db.resetEmbeddedMarkers).toHaveBeenCalledOnce()
    expect(f.original.vectors.upsert).toHaveBeenCalledOnce()
    expect(f.replacement.store.openMetaDb).not.toHaveBeenCalled()
    expect(f.replacement.db.resetEmbeddedMarkers).not.toHaveBeenCalled()
  })

  it('does not hydrate old vector IDs from a replacement session after search returns', async () => {
    const f = fixture()
    const hits = deferred<Awaited<ReturnType<typeof f.original.vectors.search>>>()
    f.original.vectors.search.mockReturnValueOnce(hits.promise)
    const service = new WorkspaceVectorService(f.auth as never)
    const run = service.search(1, [1, 0], 2)
    await vi.waitFor(() => expect(f.original.vectors.search).toHaveBeenCalledOnce())
    f.original.close()
    f.switchSession()
    hits.resolve([{ chunkId: 1, documentId: 1, score: 1 }])
    await run
    expect(f.original.db.hydrateChunkHits).toHaveBeenCalledOnce()
    expect(f.replacement.db.hydrateChunkHits).not.toHaveBeenCalled()
    expect(f.auth.getWorkspaceStore).toHaveBeenCalledOnce()
  })

  it('coalesces first-open reconciliation before admitting parallel writes', async () => {
    const f = fixture()
    f.original.vectors.count.mockResolvedValue(0)
    const reset = deferred<number>()
    f.original.db.resetEmbeddedMarkers.mockReturnValueOnce(reset.promise)
    const service = new WorkspaceVectorService(f.auth as never)
    const record = [{ chunkId: 1, documentId: 1, vector: [1, 0] }]
    const first = service.upsert(1, record)
    const second = service.upsert(1, record)
    await vi.waitFor(() => expect(f.original.db.resetEmbeddedMarkers).toHaveBeenCalledOnce())
    expect(f.original.vectors.upsert).not.toHaveBeenCalled()
    reset.resolve(0)
    await Promise.all([first, second])
    expect(f.original.vectors.count).toHaveBeenCalledOnce()
    expect(f.original.vectors.upsert).toHaveBeenCalledTimes(2)
  })

  it('retries a failed first-open reconciliation before trusting embedded markers', async () => {
    const f = fixture()
    f.original.vectors.count
      .mockRejectedValueOnce(new Error('transient read error'))
      .mockResolvedValue(0)
    const service = new WorkspaceVectorService(f.auth as never)
    const record = [{ chunkId: 1, documentId: 1, vector: [1, 0] }]
    await expect(service.upsert(1, record)).rejects.toThrow('transient read error')
    await service.upsert(1, record)
    expect(f.original.vectors.count).toHaveBeenCalledTimes(2)
    expect(f.original.db.resetEmbeddedMarkers).toHaveBeenCalledOnce()
    expect(f.original.vectors.upsert).toHaveBeenCalledOnce()
  })
})

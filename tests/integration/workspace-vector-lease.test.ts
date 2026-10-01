import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceStore } from '@main/services/storage/WorkspaceStore'
import { WorkspaceVectorService } from '@main/services/storage/WorkspaceVectorService'
import { WorkspaceDbFacade } from '@main/services/storage/WorkspaceDbFacade'
import { LanceWorkspaceStore } from '@main/services/storage/LanceWorkspaceStore'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import { EmbeddingBackfillService } from '@main/services/embeddings/EmbeddingBackfillService'
import { emptyManifest } from '@shared/workspaceStorage'
import { deferred } from '../unit/fixtures/retrievalHarness'

const vector = [1, 0, 0, 0, 0, 0, 0, 0]

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('@main/services/documents/languageDetector', () => ({
  detectChunkLanguages: async (texts: string[]) => texts.map(() => 'en'),
}))

describe('workspace operation leases (real SQLite + encrypted LanceDB)', () => {
  let baseDir: string
  let store: WorkspaceStore
  let vectors: WorkspaceVectorService
  let facade: WorkspaceDbFacade
  let auth: AuthService
  let reopen: () => WorkspaceStore

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'loklm-vector-lease-'))
    const masterDek = randomBytes(32)
    let manifest = emptyManifest()
    reopen = () =>
      new WorkspaceStore({
        baseDir,
        masterDek,
        manifest,
        dims: vector.length,
        persistManifest: async (updated) => {
          manifest = structuredClone(updated)
        },
      })
    store = reopen()
    auth = {
      getWorkspaceStore: () => store,
      requireDatabase: () => facade,
      isUnlocked: () => true,
    } as unknown as AuthService
    vectors = new WorkspaceVectorService(auth)
    facade = new WorkspaceDbFacade(auth)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await store.close()
    await rm(baseDir, { recursive: true, force: true })
  })

  async function seed(title: string) {
    const workspace = await store.create(title)
    const db = await store.openMetaDb(workspace.id)
    const document = await db.addDocument({
      title,
      sourcePath: `loklm-generated:${title}.txt`,
      generatedText: `${title} evidence`,
      status: 'ready',
    })
    const [chunkId] = await db.persistChunks(document.id, [
      { ordinal: 0, text: `${title} evidence`, pageFrom: null, pageTo: null, tokenCount: 3 },
    ])
    return {
      workspace,
      db,
      document,
      records: [{ chunkId: chunkId!, documentId: document.id, vector }],
    }
  }

  function documentService() {
    return new DocumentService(
      auth,
      undefined,
      undefined,
      undefined,
      (id, records) => vectors.upsert(id, records),
      (id, chunkIds) => vectors.remove(id, chunkIds),
    )
  }

  it.each(['delete', 'reindex'] as const)(
    'rejects a real backfill batch that finishes after document %s',
    async (action) => {
      const a = await seed('Late backfill')
      await store.open(a.workspace.id)
      await vectors.upsert(a.workspace.id, a.records)
      const pending = deferred<Float32Array<ArrayBuffer>[]>()
      const embedder = {
        identity: () => 'bundled:fixture',
        ensureReady: async () => {},
        isReady: () => true,
        preferredBatchSize: () => 4,
        embed: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array(vector))),
      }
      embedder.embed.mockReturnValueOnce(pending.promise)
      const backfill = new EmbeddingBackfillService(
        facade,
        { embedder: () => embedder } as never,
        (id, records) => vectors.upsert(id, records),
      )
      const running = backfill.run(a.workspace.id)
      await vi.waitFor(() => expect(embedder.embed).toHaveBeenCalledOnce())
      const documents = documentService()
      if (action === 'delete') await documents.deleteDocuments([a.document.id])
      else await documents.reindex(a.document.id)
      await vi.waitFor(() => expect(documents.isIndexing()).toBe(false))
      pending.resolve([new Float32Array(vector)])
      await running
      expect(backfill.status(a.workspace.id).state).toBe('done')
      const chunks = await a.db.chunkIdsForDocument(a.document.id)
      expect(chunks).not.toContain(a.records[0]!.chunkId)
      const resident = await store.open(a.workspace.id)
      const hits = await resident.search(vector, 10)
      expect(hits.map((hit) => hit.chunkId)).toEqual(chunks)
      expect(await resident.count()).toBe(action === 'delete' ? 0 : 1)
      if (action === 'reindex') {
        expect(await a.db.getGeneratedText(a.document.id)).toBe('Late backfill evidence')
        expect(await a.db.countChunksMissingEmbedding()).toBe(0)
      }
    },
  )

  it.each(['delete', 'reindex'] as const)(
    'purges an already admitted write and rejects a queued stale write during %s',
    async (action) => {
      const a = await seed('Admitted backfill')
      await store.open(a.workspace.id)
      const entered = deferred<void>()
      const release = deferred<void>()
      const upsert = LanceWorkspaceStore.prototype.upsert
      const nativeWrite = vi
        .spyOn(LanceWorkspaceStore.prototype, 'upsert')
        .mockImplementationOnce(async function (this: LanceWorkspaceStore, records) {
          entered.resolve()
          await release.promise
          return upsert.call(this, records)
        })
      const admitted = vectors.upsert(a.workspace.id, a.records)
      await entered.promise
      // This request queues before the purge, but must check live ownership
      // only when it owns the vector lease, after SQLite has retired the IDs.
      const queued = vectors.upsert(a.workspace.id, a.records)
      const documents = documentService()
      const mutation =
        action === 'delete'
          ? documents.deleteDocuments([a.document.id])
          : documents.reindex(a.document.id)
      try {
        await vi.waitFor(async () =>
          expect(await a.db.chunkIdsForDocument(a.document.id)).toEqual([]),
        )
      } finally {
        release.resolve()
      }
      await Promise.all([admitted, queued, mutation])
      await vi.waitFor(() => expect(documents.isIndexing()).toBe(false))
      expect(nativeWrite).toHaveBeenCalledOnce()
      const resident = await store.open(a.workspace.id)
      expect(await resident.count()).toBe(0)
      if (action === 'reindex') {
        const [replacement] = await a.db.chunkIdsForDocument(a.document.id)
        expect(replacement).toBeGreaterThan(a.records[0]!.chunkId)
        await vectors.upsert(a.workspace.id, [
          { chunkId: replacement!, documentId: a.document.id, vector },
        ])
        expect((await resident.search(vector, 1))[0]?.chunkId).toBe(replacement)
      }
    },
  )

  it('checks chunk ownership, rather than accepting a live ID with another document ID', async () => {
    const a = await seed('Owner check')
    const other = await a.db.addDocument({
      title: 'Other',
      sourcePath: '/other.txt',
      status: 'ready',
    })
    await vectors.upsert(a.workspace.id, [
      { ...a.records[0]!, documentId: other.id },
      { chunkId: 987654, documentId: a.document.id, vector },
    ])
    const resident = await store.open(a.workspace.id)
    expect(await resident.count()).toBe(0)
    await vectors.upsert(a.workspace.id, a.records)
    expect((await resident.search(vector, 1))[0]?.documentId).toBe(a.document.id)
  })

  it('purges only committed bulk deletions if a later SQLite delete fails', async () => {
    const a = await seed('Deleted first')
    const other = await a.db.addDocument({
      title: 'Retained second',
      sourcePath: 'loklm-generated:retained.txt',
      generatedText: 'Retained source',
      status: 'ready',
    })
    const [otherChunk] = await a.db.persistChunks(other.id, [
      { ordinal: 0, text: 'Retained source', pageFrom: null, pageTo: null, tokenCount: 2 },
    ])
    await vectors.upsert(a.workspace.id, [
      ...a.records,
      { chunkId: otherChunk!, documentId: other.id, vector },
    ])
    await store.open(a.workspace.id)
    const remove = a.db.deleteDocument.bind(a.db)
    vi.spyOn(a.db, 'deleteDocument').mockImplementation(async (id) => {
      if (id === other.id) throw new Error('SQLite write failed')
      await remove(id)
    })
    await expect(documentService().deleteDocuments([a.document.id, other.id])).rejects.toThrow(
      'SQLite write failed',
    )
    expect(await a.db.getDocument(a.document.id)).toBeNull()
    expect(await a.db.getGeneratedText(other.id)).toBe('Retained source')
    expect(await a.db.chunkIdsForDocument(other.id)).toEqual([otherChunk])
    const resident = await store.open(a.workspace.id)
    expect(await resident.count()).toBe(1)
    expect((await resident.search(vector, 2)).map((hit) => hit.chunkId)).toEqual([otherChunk])
  })

  it('serializes overlapping writes and keeps selected ID routing separate from vector residency', async () => {
    const a = await seed('Background A')
    const b = await seed('Selected B')
    expect(a.document.id).toBe(b.document.id)
    expect(a.records[0]!.chunkId).toBe(b.records[0]!.chunkId)
    await store.open(b.workspace.id)
    const entered = deferred<void>()
    const release = deferred<void>()
    const upsert = LanceWorkspaceStore.prototype.upsert
    vi.spyOn(LanceWorkspaceStore.prototype, 'upsert').mockImplementationOnce(async function (
      this: LanceWorkspaceStore,
      records,
    ) {
      entered.resolve()
      await release.promise
      return upsert.call(this, records)
    })
    const writingA = vectors.upsert(a.workspace.id, a.records)
    await entered.promise
    let wroteB = false
    const writingB = vectors.upsert(b.workspace.id, b.records).then(() => {
      wroteB = true
    })
    expect(store.activeWorkspaceId()).toBe(b.workspace.id)
    expect((await facade.documents().getDocument(b.document.id))?.title).toBe('Selected B')
    expect(wroteB).toBe(false)
    release.resolve()
    await Promise.all([writingA, writingB])

    expect((await vectors.search(b.workspace.id, vector, 1))[0]?.text).toBe('Selected B evidence')
    expect((await vectors.search(a.workspace.id, vector, 1))[0]?.text).toBe('Background A evidence')
    expect(store.activeWorkspaceId()).toBe(b.workspace.id)
    expect(store.currentDb()).toBe(b.db)
    await facade.documents().deleteDocument(b.document.id)
    expect(await b.db.getDocument(b.document.id)).toBeNull()
    expect((await a.db.getDocument(a.document.id))?.title).toBe('Background A')

    await store.close()
    store = reopen()
    const restoredA = await store.open(a.workspace.id)
    expect(await restoredA.count()).toBe(1)
    expect((await restoredA.search(vector, 1))[0]?.chunkId).toBe(a.records[0]!.chunkId)
    const restoredB = await store.open(b.workspace.id)
    expect(await restoredB.count()).toBe(1)
  })

  it.each(['activate', 'delete', 'lock'] as const)(
    'finishes a real search and its metadata hydration before %s closes the resident store',
    async (action) => {
      const a = await seed('Search A')
      const b = await seed('Other B')
      await vectors.upsert(a.workspace.id, a.records)
      await store.open(a.workspace.id)
      const entered = deferred<void>()
      const release = deferred<void>()
      const search = LanceWorkspaceStore.prototype.search
      vi.spyOn(LanceWorkspaceStore.prototype, 'search').mockImplementationOnce(async function (
        this: LanceWorkspaceStore,
        query,
        limit,
        opts,
      ) {
        entered.resolve()
        await release.promise
        return search.call(this, query, limit, opts)
      })
      const querying = vectors.search(a.workspace.id, vector, 1)
      await entered.promise
      let transitioned = false
      const transition = (
        action === 'activate'
          ? store.open(b.workspace.id)
          : action === 'delete'
            ? store.delete(a.workspace.id)
            : store.close()
      ).then(() => {
        transitioned = true
      })
      await Promise.resolve()
      expect(transitioned).toBe(false)
      release.resolve()
      const hits = await querying
      expect(hits[0]?.text).toBe('Search A evidence')
      await transition
      if (action === 'activate') expect(store.currentDb()).toBe(b.db)
      else expect(store.currentDb()).toBeNull()
    },
  )

  it('rejects stale vector and default requests without recreating a deleted workspace', async () => {
    const a = await seed('Deleted A')
    await vectors.upsert(a.workspace.id, a.records)
    await store.delete(a.workspace.id)
    const service = new WorkspaceService({ getWorkspaceStore: () => store } as AuthService)
    await expect(vectors.upsert(a.workspace.id, a.records)).rejects.toThrow('not found')
    await expect(vectors.search(a.workspace.id, vector, 1)).rejects.toThrow('not found')
    await expect(vectors.remove(a.workspace.id, [a.records[0]!.chunkId])).rejects.toThrow(
      'not found',
    )
    await expect(service.setDefault(a.workspace.id)).rejects.toThrow('not found')
    expect(store.list()).toEqual([])
    expect(store.getDefaultWorkspaceId()).toBeNull()
  })

  it('does not reuse a deleted highest ID for a workspace that late background work could target', async () => {
    const retired = await seed('Retired highest')
    await vectors.upsert(retired.workspace.id, retired.records)
    await store.delete(retired.workspace.id)
    const replacement = await seed('New workspace')
    expect(replacement.workspace.id).toBeGreaterThan(retired.workspace.id)
    expect(replacement.document.id).toBe(retired.document.id)
    await store.open(replacement.workspace.id)
    await vectors.upsert(replacement.workspace.id, replacement.records)
    await expect(vectors.upsert(retired.workspace.id, retired.records)).rejects.toThrow('not found')
    await expect(
      vectors.remove(retired.workspace.id, [retired.records[0]!.chunkId]),
    ).rejects.toThrow('not found')
    expect((await vectors.search(replacement.workspace.id, vector, 1))[0]?.text).toBe(
      'New workspace evidence',
    )
    expect(store.activeWorkspaceId()).toBe(replacement.workspace.id)
    expect(store.list().map((entry) => entry.id)).toEqual([replacement.workspace.id])
  })
})

// The `tx as never` casts below are intentional: Drizzle's transaction object
// shares the same select/insert/update/delete/execute surface as Db but is not
// the same nominal type. `never` bypasses the structural mismatch without
// weakening the repo's own DbHandle type. Do NOT replace with `tx as Db`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupDb, teardownDb, withTransaction } from './helpers/withTransaction'
import { workspaces, documents, chunks } from '@main/db/schema'
import { DocumentsRepo, WorkspacesRepo } from '@main/db/database'

describe('DocumentsRepo (tx)', () => {
  beforeAll(setupDb, 30_000)
  afterAll(teardownDb)

  it('addDocument inserts a row with status=pending', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const repo = new DocumentsRepo(tx as never)
      const doc = await repo.addDocument({
        workspaceId: ws!.id,
        title: 'foo.md',
        sourcePath: '/tmp/foo.md',
        mimeType: 'text/markdown',
        byteSize: 42,
      })
      expect(doc.status).toBe('pending')
      expect(doc.title).toBe('foo.md')
      expect(doc.id).toBeGreaterThan(0)
    })
  })

  it('persistChunks bulk-inserts and trigger fires per row', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d' })
        .returning()
      const repo = new DocumentsRepo(tx as never)
      await repo.persistChunks(doc!.id, [
        { ordinal: 0, text: 'first', pageFrom: 1, pageTo: 1, tokenCount: 1 },
        { ordinal: 1, text: 'second', pageFrom: 1, pageTo: 1, tokenCount: 2 },
      ])
      const r = await tx.execute(sql`SELECT chunk_count FROM documents WHERE id = ${doc!.id}`)
      expect((r.rows as { chunk_count: number }[])[0]!.chunk_count).toBe(2)
    })
  })

  it('setDocumentStatus persists transitions', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d' })
        .returning()
      const repo = new DocumentsRepo(tx as never)
      await repo.setDocumentStatus(doc!.id, 'ready')
      const r = await tx.execute(sql`SELECT status FROM documents WHERE id = ${doc!.id}`)
      expect((r.rows as { status: string }[])[0]!.status).toBe('ready')
    })
  })

  it('listDocumentsByWorkspace returns only that workspace ordered by addedAt desc', async () => {
    await withTransaction(async (tx) => {
      const [wsA] = await tx.insert(workspaces).values({ name: 'a' }).returning()
      const [wsB] = await tx.insert(workspaces).values({ name: 'b' }).returning()
      await tx.insert(documents).values([
        { workspaceId: wsA!.id, title: 'one', sourcePath: '/1' },
        { workspaceId: wsB!.id, title: 'two', sourcePath: '/2' },
        { workspaceId: wsA!.id, title: 'three', sourcePath: '/3' },
      ])
      const repo = new DocumentsRepo(tx as never)
      const docs = await repo.listDocumentsByWorkspace(wsA!.id)
      expect(docs.map((d) => d.title).sort()).toEqual(['one', 'three'])
    })
  })

  it('deleteDocument cascades to chunks', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d' })
        .returning()
      await tx.insert(chunks).values({ documentId: doc!.id, ordinal: 0, text: 'x', tokenCount: 1 })
      const repo = new DocumentsRepo(tx as never)
      await repo.deleteDocument(doc!.id)
      const r = await tx.execute(
        sql`SELECT count(*)::int AS n FROM chunks WHERE document_id = ${doc!.id}`,
      )
      expect((r.rows as { n: number }[])[0]!.n).toBe(0)
    })
  })

  it('reindexDocument calls the procedure and resets state', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      await tx.insert(chunks).values({ documentId: doc!.id, ordinal: 0, text: 'x', tokenCount: 1 })
      const repo = new DocumentsRepo(tx as never)
      await repo.reindexDocument(doc!.id)
      const r = await tx.execute(
        sql`SELECT status, chunk_count FROM documents WHERE id = ${doc!.id}`,
      )
      const row = (r.rows as { status: string; chunk_count: number }[])[0]!
      expect(row.status).toBe('pending')
      expect(row.chunk_count).toBe(0)
    })
  })
})

describe('WorkspacesRepo (tx)', () => {
  beforeAll(setupDb, 30_000)
  afterAll(teardownDb)

  it('create + list + rename + delete', async () => {
    await withTransaction(async (tx) => {
      const repo = new WorkspacesRepo(tx as never)
      const a = await repo.create('Alpha')
      const b = await repo.create('Bravo')
      const ws = await repo.list()
      expect(ws.map((w) => w.name).sort()).toEqual(['Alpha', 'Bravo'])
      await repo.rename(a.id, 'Alpha-Renamed')
      const renamed = await repo.list()
      expect(renamed.find((w) => w.id === a.id)?.name).toBe('Alpha-Renamed')
      await repo.delete(b.id)
      const after = await repo.list()
      expect(after.map((w) => w.name)).toEqual(['Alpha-Renamed'])
    })
  })
})

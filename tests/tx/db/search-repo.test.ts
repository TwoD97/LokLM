import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupDb, teardownDb, withTransaction } from './helpers/withTransaction'
import { workspaces, documents, chunks } from '@main/db/schema'
import { DocumentsRepo } from '@main/db/database'

const DIM = 1024
const vec = (seed: number): number[] =>
  Array.from({ length: DIM }, (_, i) => Math.sin((i + 1) * (seed + 1)))

describe('DocumentsRepo search methods (tx)', () => {
  beforeAll(setupDb, 30_000)
  afterAll(teardownDb)

  it('searchChunks does bilingual BM25 with workspace + status filters', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'doc.md', sourcePath: '/d', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 0, text: 'Hallo Welt english world', tokenCount: 4 },
        { documentId: doc!.id, ordinal: 1, text: 'Etwas anderes auf deutsch', tokenCount: 4 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const hits = await repo.searchChunks(ws!.id, 'welt', 5)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0]!.text).toContain('Welt')
    })
  })

  it('searchChunks skips documents whose status is not ready', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'indexing' })
        .returning()
      await tx
        .insert(chunks)
        .values({ documentId: doc!.id, ordinal: 0, text: 'lookup target', tokenCount: 2 })
      const repo = new DocumentsRepo(tx as never)
      const hits = await repo.searchChunks(ws!.id, 'target', 5)
      expect(hits).toHaveLength(0)
    })
  })

  it('searchChunks respects activeDocumentIds filter', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [a] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'a', sourcePath: '/a', status: 'ready' })
        .returning()
      const [b] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'b', sourcePath: '/b', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: a!.id, ordinal: 0, text: 'shared keyword content', tokenCount: 3 },
        { documentId: b!.id, ordinal: 0, text: 'shared keyword present', tokenCount: 3 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const filtered = await repo.searchChunks(ws!.id, 'keyword', 5, { activeDocumentIds: [a!.id] })
      expect(filtered).toHaveLength(1)
      expect(filtered[0]!.document_id).toBe(a!.id)
    })
  })

  it('searchChunks applies per-doc cap', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      for (let i = 0; i < 5; i++) {
        await tx
          .insert(chunks)
          .values({ documentId: doc!.id, ordinal: i, text: `match line ${i}`, tokenCount: 3 })
      }
      const repo = new DocumentsRepo(tx as never)
      const capped = await repo.searchChunks(ws!.id, 'match', 10, { perDocK: 2 })
      expect(capped.length).toBeLessThanOrEqual(2)
    })
  })

  it('searchChunksByVector returns nearest by cosine', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 0, text: 'A', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 1, text: 'B', tokenCount: 1 },
      ])
      const rows = await tx.execute(sql`SELECT id FROM chunks ORDER BY ordinal`)
      const ids = (rows.rows as { id: number }[]).map((r) => r.id)
      const repo = new DocumentsRepo(tx as never)
      await repo.setChunkEmbedding(ids[0]!, vec(1))
      await repo.setChunkEmbedding(ids[1]!, vec(50))
      const hits = await repo.searchChunksByVector(ws!.id, vec(50), 1)
      expect(hits).toHaveLength(1)
      expect(hits[0]!.chunk_id).toBe(ids[1])
    })
  })

  it('listChunksForDocument returns chunks in ordinal order', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 1, text: 'b', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 0, text: 'a', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 2, text: 'c', tokenCount: 1 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const rows = await repo.listChunksForDocument(doc!.id)
      expect(rows.map((r) => r.text)).toEqual(['a', 'b', 'c'])
    })
  })
})

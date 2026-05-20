import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupDb, teardownDb, withTransaction } from './helpers/withTransaction'
import { workspaces, documents, chunks } from '@main/db/schema'
import { DocumentsRepo } from '@main/db/database'

const DIM = 1024

function vec(seed: number): number[] {
  // deterministic pseudo-vector; pgvector cosine works on any non-zero vector
  return Array.from({ length: DIM }, (_, i) => Math.sin((i + 1) * (seed + 1)))
}

describe('DocumentsRepo embedding methods (tx)', () => {
  beforeAll(setupDb, 30_000)
  afterAll(teardownDb)

  it('setChunkEmbedding writes a vector and countChunksMissingEmbedding decreases', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 0, text: 'a', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 1, text: 'b', tokenCount: 1 },
      ])
      const repo = new DocumentsRepo(tx as never)
      expect(await repo.countChunksMissingEmbedding(ws!.id)).toBe(2)
      const written = await tx.execute(sql`SELECT id FROM chunks ORDER BY ordinal`)
      const ids = (written.rows as { id: number }[]).map((r) => r.id)
      await repo.setChunkEmbedding(ids[0]!, vec(1), 'bundled:bge-m3')
      expect(await repo.countChunksMissingEmbedding(ws!.id)).toBe(1)
    })
  })

  it('listChunksMissingEmbedding returns rows scoped to workspace and paged', async () => {
    await withTransaction(async (tx) => {
      const [wsA] = await tx.insert(workspaces).values({ name: 'a' }).returning()
      const [wsB] = await tx.insert(workspaces).values({ name: 'b' }).returning()
      const [docA] = await tx
        .insert(documents)
        .values({ workspaceId: wsA!.id, title: 'da', sourcePath: '/da' })
        .returning()
      const [docB] = await tx
        .insert(documents)
        .values({ workspaceId: wsB!.id, title: 'db', sourcePath: '/db' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: docA!.id, ordinal: 0, text: 'a0', tokenCount: 1 },
        { documentId: docA!.id, ordinal: 1, text: 'a1', tokenCount: 1 },
        { documentId: docA!.id, ordinal: 2, text: 'a2', tokenCount: 1 },
        { documentId: docB!.id, ordinal: 0, text: 'b0', tokenCount: 1 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const pageA = await repo.listChunksMissingEmbedding(wsA!.id, 2)
      expect(pageA).toHaveLength(2)
      for (const c of pageA) expect(['a0', 'a1', 'a2']).toContain(c.text)
      const pageB = await repo.listChunksMissingEmbedding(wsB!.id, 10)
      expect(pageB).toHaveLength(1)
      expect(pageB[0]!.text).toBe('b0')
    })
  })

  it('ensureVectorIndex is idempotent (no-op when index already exists)', async () => {
    await withTransaction(async (tx) => {
      const repo = new DocumentsRepo(tx as never)
      await repo.ensureVectorIndex()
      await repo.ensureVectorIndex()
      const r = await tx.execute(sql`
        SELECT count(*)::int AS n FROM pg_indexes
         WHERE indexname = 'idx_chunks_hnsw' AND tablename = 'chunks'
      `)
      expect((r.rows as { n: number }[])[0]!.n).toBe(1)
    })
  })

  it('cosine search via SQL returns nearest by embedding', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 0, text: 'A', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 1, text: 'B', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 2, text: 'C', tokenCount: 1 },
      ])
      const rows = await tx.execute(sql`SELECT id FROM chunks ORDER BY ordinal`)
      const ids = (rows.rows as { id: number }[]).map((r) => r.id)
      const repo = new DocumentsRepo(tx as never)
      await repo.setChunkEmbedding(ids[0]!, vec(1), 'bundled:bge-m3')
      await repo.setChunkEmbedding(ids[1]!, vec(2), 'bundled:bge-m3')
      await repo.setChunkEmbedding(ids[2]!, vec(99), 'bundled:bge-m3')
      const q = vec(2)
      const lit = '[' + q.join(',') + ']'
      const r = await tx.execute(sql`
        SELECT id FROM chunks
         ORDER BY embedding <=> ${lit}::vector
         LIMIT 1
      `)
      const top = (r.rows as { id: number }[])[0]!.id
      expect(top).toBe(ids[1])
    })
  })
})

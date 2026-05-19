import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupDb, teardownDb, withTransaction } from './helpers/withTransaction'

describe('schema-objects: triggers + function + procedure', () => {
  beforeAll(setupDb, 30_000)
  afterAll(teardownDb)

  it('chunks_tsv_biu trigger populates text_search on insert', async () => {
    await withTransaction(async (tx) => {
      const wsR = await tx.execute(sql`INSERT INTO workspaces (name) VALUES ('ws1') RETURNING id`)
      const wsId = (wsR.rows as { id: number }[])[0]!.id
      const docR = await tx.execute(sql`
        INSERT INTO documents (workspace_id, title, source_path)
        VALUES (${wsId}, 'doc.md', '/tmp/doc.md') RETURNING id
      `)
      const docId = (docR.rows as { id: number }[])[0]!.id
      const chunkR = await tx.execute(sql`
        INSERT INTO chunks (document_id, ordinal, text, token_count)
        VALUES (${docId}, 0, 'Hallo Welt english world', 5) RETURNING id
      `)
      const chunkId = (chunkR.rows as { id: number }[])[0]!.id
      const result = await tx.execute(sql`
        SELECT text_search IS NOT NULL AS has_tsv FROM chunks WHERE id = ${chunkId}
      `)
      expect((result.rows as { has_tsv: boolean }[])[0]!.has_tsv).toBe(true)
    })
  })

  it('chunks_count_aid trigger increments documents.chunk_count', async () => {
    await withTransaction(async (tx) => {
      const wsR = await tx.execute(sql`INSERT INTO workspaces (name) VALUES ('ws1') RETURNING id`)
      const wsId = (wsR.rows as { id: number }[])[0]!.id
      const docR = await tx.execute(sql`
        INSERT INTO documents (workspace_id, title, source_path)
        VALUES (${wsId}, 'doc.md', '/tmp/doc.md') RETURNING id
      `)
      const docId = (docR.rows as { id: number }[])[0]!.id
      await tx.execute(
        sql`INSERT INTO chunks (document_id, ordinal, text, token_count) VALUES (${docId}, 0, 'a', 1)`,
      )
      await tx.execute(
        sql`INSERT INTO chunks (document_id, ordinal, text, token_count) VALUES (${docId}, 1, 'b', 2)`,
      )
      const r = await tx.execute(
        sql`SELECT chunk_count, token_count FROM documents WHERE id = ${docId}`,
      )
      const row = (r.rows as { chunk_count: number; token_count: number }[])[0]!
      expect(row.chunk_count).toBe(2)
      expect(row.token_count).toBe(3)
    })
  })

  it('get_chunk_with_context returns target plus neighbours', async () => {
    await withTransaction(async (tx) => {
      const wsR = await tx.execute(sql`INSERT INTO workspaces (name) VALUES ('ws1') RETURNING id`)
      const wsId = (wsR.rows as { id: number }[])[0]!.id
      const docR = await tx.execute(
        sql`INSERT INTO documents (workspace_id, title, source_path) VALUES (${wsId}, 'd', '/d') RETURNING id`,
      )
      const docId = (docR.rows as { id: number }[])[0]!.id
      const chunkIds: number[] = []
      for (let i = 0; i < 5; i++) {
        const cr = await tx.execute(sql`
          INSERT INTO chunks (document_id, ordinal, text, token_count)
          VALUES (${docId}, ${i}, ${`chunk ${i}`}, 1) RETURNING id
        `)
        chunkIds.push((cr.rows as { id: number }[])[0]!.id)
      }
      // target is ordinal 2 (3rd chunk inserted, index 2)
      const targetId = chunkIds[2]!
      const r = await tx.execute(sql`SELECT * FROM get_chunk_with_context(${targetId}, 1, 1)`)
      const rows = r.rows as { ordinal: number; is_target: boolean }[]
      expect(rows.map((r) => r.ordinal)).toEqual([1, 2, 3])
      expect(rows.filter((r) => r.is_target).map((r) => r.ordinal)).toEqual([2])
    })
  })

  it('reindex_document procedure resets state', async () => {
    await withTransaction(async (tx) => {
      const wsR = await tx.execute(sql`INSERT INTO workspaces (name) VALUES ('ws1') RETURNING id`)
      const wsId = (wsR.rows as { id: number }[])[0]!.id
      const docR = await tx.execute(
        sql`INSERT INTO documents (workspace_id, title, source_path, status) VALUES (${wsId}, 'd', '/d', 'ready') RETURNING id`,
      )
      const docId = (docR.rows as { id: number }[])[0]!.id
      await tx.execute(
        sql`INSERT INTO chunks (document_id, ordinal, text, token_count) VALUES (${docId}, 0, 'a', 1)`,
      )
      await tx.execute(sql`CALL reindex_document(${docId})`)
      const r = await tx.execute(
        sql`SELECT status, chunk_count, token_count FROM documents WHERE id = ${docId}`,
      )
      const row = (r.rows as { status: string; chunk_count: number; token_count: number }[])[0]!
      expect(row.status).toBe('pending')
      expect(row.chunk_count).toBe(0)
      expect(row.token_count).toBe(0)
    })
  })

  it('idx_chunks_hnsw exists after migrations', async () => {
    await withTransaction(async (tx) => {
      const r = await tx.execute(sql`
        SELECT 1 AS ok FROM pg_indexes
         WHERE indexname = 'idx_chunks_hnsw' AND tablename = 'chunks'
      `)
      expect((r.rows as { ok: number }[]).length).toBe(1)
    })
  })
})

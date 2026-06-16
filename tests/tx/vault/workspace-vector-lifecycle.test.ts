import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceVectorService } from '@main/services/storage/WorkspaceVectorService'
import type { Database } from '@main/db/database'

// ADR-0005 clean cut: in the app, chunk vectors live ONLY in the encrypted
// LanceDB store; the pgvector column stays NULL and bookkeeping keys off the
// `embedded` marker. This pins that contract end-to-end through the real vault.

const DIMS = 8
const vec = (s: number, d: number = DIMS): number[] =>
  Array.from({ length: d }, (_, i) => Math.sin(s + i))

async function seedChunks(
  db: Database,
  workspaceId: number,
  n: number,
): Promise<{ docId: number; chunkIds: number[] }> {
  const [doc] = (
    await db.db.execute(sql`
      INSERT INTO documents (workspace_id, title, source_path, status)
      VALUES (${workspaceId}, 'Doc', '/tmp/d.txt', 'ready') RETURNING id
    `)
  ).rows as Array<{ id: number }>
  const chunkIds: number[] = []
  for (let i = 0; i < n; i++) {
    const [c] = (
      await db.db.execute(sql`
        INSERT INTO chunks (document_id, ordinal, text) VALUES (${doc!.id}, ${i}, ${'t' + i}) RETURNING id
      `)
    ).rows as Array<{ id: number }>
    chunkIds.push(c!.id)
  }
  return { docId: doc!.id, chunkIds }
}

const embeddingNullCount = async (db: Database, chunkIds: number[]): Promise<number> => {
  const lit = '{' + chunkIds.join(',') + '}'
  const r = await db.db.execute(sql`
    SELECT count(*)::int AS n FROM chunks WHERE id = ANY(${lit}::int[]) AND embedding IS NULL
  `)
  return (r.rows as Array<{ n: number }>)[0]!.n
}

describe('workspace vector lifecycle (clean cut)', () => {
  let userDataDir: string
  let auth: AuthService

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'loklm-vlife-'))
    auth = new AuthService(userDataDir)
    await auth.register({ displayName: 'Dominik', password: 'Test12345!', recoveryLang: 'de' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('sink-only path: vectors in Lance, pgvector NULL, marker drives the count', async () => {
    const db = auth.requireDatabase()
    const ws = await db.workspaces().create('W')
    const { docId, chunkIds } = await seedChunks(db, ws.id, 4)

    expect(await db.documents().countChunksMissingEmbedding(ws.id)).toBe(4)

    // app ingestion: vectors → Lance, marker → PGlite (no pgvector write)
    const vsvc = new WorkspaceVectorService(auth)
    await vsvc.upsert(
      ws.id,
      chunkIds.map((id, i) => ({ chunkId: id, documentId: docId, vector: vec(i) })),
    )
    await db.documents().markChunksEmbedded(chunkIds, 'bundled:bge-m3')

    expect(await db.documents().countChunksMissingEmbedding(ws.id)).toBe(0)
    expect(await embeddingNullCount(db, chunkIds)).toBe(4) // pgvector untouched
    const hits = await vsvc.search(ws.id, vec(1), 1)
    expect(hits[0]!.chunk_id).toBe(chunkIds[1])
  }, 60_000)

  it('model-swap purge resets the marker and drops the vectors from Lance', async () => {
    const db = auth.requireDatabase()
    const ws = await db.workspaces().create('W')
    const { docId, chunkIds } = await seedChunks(db, ws.id, 3)
    const vsvc = new WorkspaceVectorService(auth)
    await vsvc.upsert(
      ws.id,
      chunkIds.map((id, i) => ({ chunkId: id, documentId: docId, vector: vec(i) })),
    )
    await db.documents().markChunksEmbedded(chunkIds, 'bundled:bge-m3')
    expect(await db.documents().countChunksMissingEmbedding(ws.id)).toBe(0)

    // swap model → purge by old identity returns ids + resets the marker
    const purged = await db.documents().purgeEmbeddingsByIdentity(ws.id, 'bundled:bge-m3')
    expect(purged.sort()).toEqual([...chunkIds].sort())
    expect(await db.documents().countChunksMissingEmbedding(ws.id)).toBe(3) // missing again
    await vsvc.remove(ws.id, purged)
    expect(await vsvc.search(ws.id, vec(0), 5)).toHaveLength(0) // gone from Lance
  }, 60_000)

  it('legacy migration: copies pgvector → Lance then nulls the column', async () => {
    const db = auth.requireDatabase()
    const ws = await db.workspaces().create('W')
    const { chunkIds } = await seedChunks(db, ws.id, 3)
    // simulate a pre-ADR-0005 library: vectors stored in the pgvector column,
    // which is fixed at vector(1024) — so seed full-dimension embeddings.
    for (let i = 0; i < chunkIds.length; i++) {
      await db.documents().setChunkEmbedding(chunkIds[i]!, vec(i, 1024), 'bundled:bge-m3')
    }
    expect(await embeddingNullCount(db, chunkIds)).toBe(0) // all have vectors

    // first open through the bridge migrates them into Lance + reclaims pgvector
    const vsvc = new WorkspaceVectorService(auth)
    const hits = await vsvc.search(ws.id, vec(2, 1024), 1)
    expect(hits[0]!.chunk_id).toBe(chunkIds[2])
    expect(await embeddingNullCount(db, chunkIds)).toBe(3) // column reclaimed
    expect(await db.documents().countChunksMissingEmbedding(ws.id)).toBe(0) // still embedded
  }, 60_000)
})

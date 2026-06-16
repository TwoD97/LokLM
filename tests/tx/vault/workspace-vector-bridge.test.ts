import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceVectorService } from '@main/services/storage/WorkspaceVectorService'

// ADR-0005: the bridge the app wires — embeddings live in the per-workspace
// encrypted LanceDB store, chunk text/metadata in PGlite, and search() returns
// fully-hydrated SearchHit rows joined by chunkId.

const DIMS = 16
const vec = (seed: number): number[] =>
  Array.from({ length: DIMS }, (_, i) => Math.sin(seed * 0.7 + i) / 2 + 0.5)

describe('WorkspaceVectorService bridge (vault)', () => {
  let userDataDir: string
  let auth: AuthService

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'loklm-bridge-'))
    auth = new AuthService(userDataDir)
    await auth.register({ displayName: 'Dominik', password: 'Test12345!', recoveryLang: 'de' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('upserts to Lance and hydrates SearchHits from PGlite', async () => {
    const db = auth.requireDatabase()
    const ws = await db.workspaces().create('Research')

    // seed one ready document with three chunks (text lives in PGlite)
    const [docRow] = (
      await db.db.execute(sql`
        INSERT INTO documents (workspace_id, title, source_path, status)
        VALUES (${ws.id}, 'Doc A', '/tmp/a.txt', 'ready') RETURNING id
      `)
    ).rows as Array<{ id: number }>
    const docId = docRow!.id
    const chunkIds: number[] = []
    for (let ord = 0; ord < 3; ord++) {
      const [c] = (
        await db.db.execute(sql`
          INSERT INTO chunks (document_id, ordinal, text)
          VALUES (${docId}, ${ord}, ${'chunk text ' + ord}) RETURNING id
        `)
      ).rows as Array<{ id: number }>
      chunkIds.push(c!.id)
    }

    const vsvc = new WorkspaceVectorService(auth)
    await vsvc.upsert(ws.id, [
      { chunkId: chunkIds[0]!, documentId: docId, vector: vec(1) },
      { chunkId: chunkIds[1]!, documentId: docId, vector: vec(2) },
      { chunkId: chunkIds[2]!, documentId: docId, vector: vec(3) },
    ])

    // query closest to chunk #1's vector → returns it, hydrated with text+title
    const hits = await vsvc.search(ws.id, vec(2), 1)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.chunk_id).toBe(chunkIds[1])
    expect(hits[0]!.document_title).toBe('Doc A')
    expect(hits[0]!.text).toBe('chunk text 1')
    expect(hits[0]!.score).toBeGreaterThan(0.9)
  }, 60_000)

  it('drops hits whose document is not ready (hydrate filter)', async () => {
    const db = auth.requireDatabase()
    const ws = await db.workspaces().create('W')
    const [docRow] = (
      await db.db.execute(sql`
        INSERT INTO documents (workspace_id, title, source_path, status)
        VALUES (${ws.id}, 'Pending', '/tmp/p.txt', 'pending') RETURNING id
      `)
    ).rows as Array<{ id: number }>
    const docId = docRow!.id
    const [c] = (
      await db.db.execute(sql`
        INSERT INTO chunks (document_id, ordinal, text) VALUES (${docId}, 0, 'x') RETURNING id
      `)
    ).rows as Array<{ id: number }>

    const vsvc = new WorkspaceVectorService(auth)
    await vsvc.upsert(ws.id, [{ chunkId: c!.id, documentId: docId, vector: vec(1) }])
    expect(await vsvc.search(ws.id, vec(1), 5)).toHaveLength(0) // not 'ready' → filtered
  }, 60_000)
})

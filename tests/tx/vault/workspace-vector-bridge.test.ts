import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceVectorService } from '@main/services/storage/WorkspaceVectorService'

// ADR-0005: the bridge the app wires — vectors in the per-workspace encrypted
// LanceDB store, chunk text/metadata in the per-workspace encrypted SQLite, and
// search() returns fully-hydrated SearchHit rows joined by chunkId.

const DIMS = 16
const vec = (seed: number): number[] =>
  Array.from({ length: DIMS }, (_, i) => Math.sin(seed * 0.7 + i) / 2 + 0.5)

describe('WorkspaceVectorService bridge (SQLite + LanceDB)', () => {
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

  it('upserts to Lance and hydrates SearchHits from the workspace SQLite', async () => {
    const ws = await auth.getWorkspaceStore().create('Research')
    const db = await auth.getWorkspaceDb(ws.id)
    const doc = await db.addDocument({ title: 'Doc A', sourcePath: '/a.txt', status: 'ready' })
    const chunkIds = await db.persistChunks(doc.id, [
      { ordinal: 0, text: 'chunk text 0', pageFrom: null, pageTo: null, tokenCount: 2 },
      { ordinal: 1, text: 'chunk text 1', pageFrom: null, pageTo: null, tokenCount: 2 },
      { ordinal: 2, text: 'chunk text 2', pageFrom: null, pageTo: null, tokenCount: 2 },
    ])

    const vsvc = new WorkspaceVectorService(auth)
    await vsvc.upsert(
      ws.id,
      chunkIds.map((id, i) => ({ chunkId: id, documentId: doc.id, vector: vec(i + 1) })),
    )

    const hits = await vsvc.search(ws.id, vec(2), 1)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.chunk_id).toBe(chunkIds[1])
    expect(hits[0]!.document_title).toBe('Doc A')
    expect(hits[0]!.text).toBe('chunk text 1')
    expect(hits[0]!.score).toBeGreaterThan(0.9)
  }, 60_000)

  it('drops hits whose document is not ready (hydrate filter)', async () => {
    const ws = await auth.getWorkspaceStore().create('W')
    const db = await auth.getWorkspaceDb(ws.id)
    const doc = await db.addDocument({ title: 'Pending', sourcePath: '/p.txt', status: 'pending' })
    const [chunkId] = await db.persistChunks(doc.id, [
      { ordinal: 0, text: 'x', pageFrom: null, pageTo: null, tokenCount: 1 },
    ])

    const vsvc = new WorkspaceVectorService(auth)
    await vsvc.upsert(ws.id, [{ chunkId: chunkId!, documentId: doc.id, vector: vec(1) }])
    expect(await vsvc.search(ws.id, vec(1), 5)).toHaveLength(0) // not 'ready' → filtered
  }, 60_000)
})

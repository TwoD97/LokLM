import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceVectorService } from '@main/services/storage/WorkspaceVectorService'

// ADR-0005 end-to-end: vectors live ONLY in the encrypted LanceDB store; the
// workspace SQLite holds chunk text + the `embedded` marker. Search hydrates
// from SQLite; a lost/corrupt Lance store self-heals by re-marking chunks for
// re-embedding from the SQLite text (no permanent data loss).

const DIMS = 16
const vec = (s: number): number[] => Array.from({ length: DIMS }, (_, i) => Math.sin(s + i))

describe('workspace vector lifecycle (SQLite + LanceDB)', () => {
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

  async function seed(n: number): Promise<{ wsId: number; docId: number; chunkIds: number[] }> {
    const ws = await auth.getWorkspaceStore().create('W')
    const db = await auth.getWorkspaceDb(ws.id)
    const doc = await db.addDocument({ title: 'Doc', sourcePath: '/d.txt', status: 'ready' })
    const chunkIds = await db.persistChunks(
      doc.id,
      Array.from({ length: n }, (_, i) => ({
        ordinal: i,
        text: `chunk ${i}`,
        pageFrom: null,
        pageTo: null,
        tokenCount: 2,
      })),
    )
    return { wsId: ws.id, docId: doc.id, chunkIds }
  }

  it('vectors in Lance + embedded marker in SQLite; search hydrates from SQLite', async () => {
    const { wsId, docId, chunkIds } = await seed(4)
    const db = await auth.getWorkspaceDb(wsId)
    expect(await db.countChunksMissingEmbedding()).toBe(4)

    const vsvc = new WorkspaceVectorService(auth)
    await vsvc.upsert(
      wsId,
      chunkIds.map((id, i) => ({ chunkId: id, documentId: docId, vector: vec(i) })),
    )
    await db.markChunksEmbedded(chunkIds, 'bundled:bge-m3')

    expect(await db.countChunksMissingEmbedding()).toBe(0)
    const hit = (await vsvc.search(wsId, vec(1), 1))[0]
    expect(hit!.chunk_id).toBe(chunkIds[1])
  }, 60_000)

  it('model-swap purge resets the marker and drops vectors from Lance', async () => {
    const { wsId, docId, chunkIds } = await seed(3)
    const db = await auth.getWorkspaceDb(wsId)
    const vsvc = new WorkspaceVectorService(auth)
    await vsvc.upsert(
      wsId,
      chunkIds.map((id, i) => ({ chunkId: id, documentId: docId, vector: vec(i) })),
    )
    await db.markChunksEmbedded(chunkIds, 'bundled:bge-m3')
    expect(await db.countChunksMissingEmbedding()).toBe(0)

    const purged = await db.purgeEmbeddingsByIdentity('bundled:bge-m3')
    expect(purged.sort()).toEqual([...chunkIds].sort())
    expect(await db.countChunksMissingEmbedding()).toBe(3)
    await vsvc.remove(wsId, purged)
    expect(await vsvc.search(wsId, vec(0), 5)).toHaveLength(0)
  }, 60_000)

  it('recovers from a corrupt Lance store: no content loss, vectors re-scheduled', async () => {
    const { wsId, docId, chunkIds } = await seed(3)
    const db = await auth.getWorkspaceDb(wsId)
    const vsvc = new WorkspaceVectorService(auth)
    await vsvc.upsert(
      wsId,
      chunkIds.map((id, i) => ({ chunkId: id, documentId: docId, vector: vec(i) })),
    )
    await db.markChunksEmbedded(chunkIds, 'bundled:bge-m3')
    await auth.lock() // persists the encrypted Lance store + SQLite

    // corrupt a byte in the workspace's encrypted Lance tree
    const encDir = join(userDataDir, 'workspaces', `ws-${wsId}`, 'enc')
    const findFile = async (d: string): Promise<string | null> => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) {
          const hit = await findFile(p)
          if (hit) return hit
        } else if ((await stat(p)).size > 0) return p
      }
      return null
    }
    const victim = await findFile(encDir)
    const buf = await readFile(victim!)
    buf.writeUInt8(buf.readUInt8(buf.length - 1) ^ 0xff, buf.length - 1)
    await writeFile(victim!, buf)

    // restart + reopen: store quarantined → empty, markers reset so backfill
    // re-embeds; chunk text intact in SQLite
    const auth2 = new AuthService(userDataDir)
    expect((await auth2.login('Test12345!')).ok).toBe(true)
    const vsvc2 = new WorkspaceVectorService(auth2)
    expect(await vsvc2.search(wsId, vec(0), 5)).toHaveLength(0)
    const db2 = await auth2.getWorkspaceDb(wsId)
    expect(await db2.countChunksMissingEmbedding()).toBe(3) // re-embed pending
    expect((await db2.getDocument(docId))!.title).toBe('Doc') // text intact
    await auth2.lock()
  }, 90_000)
})

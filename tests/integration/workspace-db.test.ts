import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { WorkspaceDb } from '../../src/main/db/sqlite/WorkspaceDb'

// Stage 1 of the PGlite → libSQL migration (ADR-0005): the per-workspace
// encrypted relational + FTS5 store. Vectors are NOT here (LanceDB); this is
// documents, chunk text, BM25, and the embedded-marker bookkeeping.

describe('WorkspaceDb (encrypted libSQL + FTS5)', () => {
  let dir: string
  let dbPath: string
  let keyHex: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'loklm-wsdb-'))
    dbPath = join(dir, 'meta.db')
    keyHex = randomBytes(32).toString('hex')
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  async function seed(db: WorkspaceDb): Promise<number> {
    const doc = await db.addDocument({ title: 'Foxes', sourcePath: '/tmp/f.txt', status: 'ready' })
    await db.persistChunks(doc.id, [
      {
        ordinal: 0,
        text: 'the quick brown fox jumps over fences',
        pageFrom: 1,
        pageTo: 1,
        tokenCount: 7,
      },
      { ordinal: 1, text: 'lazy dogs sleep all day long', pageFrom: 1, pageTo: 1, tokenCount: 6 },
      {
        ordinal: 2,
        text: 'foxes are clever forest animals',
        pageFrom: 2,
        pageTo: 2,
        tokenCount: 5,
      },
    ])
    return doc.id
  }

  it('stores documents + chunks and BM25-ranks FTS5 search', async () => {
    const db = await WorkspaceDb.open(dbPath, keyHex)
    await seed(db)
    const hits = await db.searchChunks('fox', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.text).toContain('fox')
    expect(hits[0]!.document_title).toBe('Foxes')
    // score is -bm25 → higher is better, descending
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[hits.length - 1]!.score)
    db.close()
  })

  it('tracks the embedded marker and re-derives missing/embedded counts', async () => {
    const db = await WorkspaceDb.open(dbPath, keyHex)
    await seed(db)
    expect(await db.countChunksMissingEmbedding()).toBe(3)
    const missing = await db.listChunksMissingEmbedding(10)
    await db.markChunksEmbedded(
      missing.map((m) => m.id),
      'bundled:bge-m3',
    )
    expect(await db.countChunksMissingEmbedding()).toBe(0)
    expect(await db.distinctEmbedderIdentities()).toEqual(['bundled:bge-m3'])

    // model swap → purge by identity resets markers + returns ids for LanceDB
    const purged = await db.purgeEmbeddingsByIdentity('bundled:bge-m3')
    expect(purged).toHaveLength(3)
    expect(await db.countChunksMissingEmbedding()).toBe(3)
    db.close()
  })

  it('hydrates vector hits (Lance ids+scores) into SearchHit rows', async () => {
    const db = await WorkspaceDb.open(dbPath, keyHex)
    const docId = await seed(db)
    const ids = await db.chunkIdsForDocument(docId)
    const hits = await db.hydrateChunkHits([
      { chunkId: ids[2]!, documentId: docId, score: 0.91 },
      { chunkId: ids[0]!, documentId: docId, score: 0.42 },
    ])
    expect(hits.map((h) => h.chunk_id)).toEqual([ids[2], ids[0]]) // order preserved
    expect(hits[0]!.score).toBe(0.91)
    expect(hits[0]!.text).toContain('foxes')
    db.close()
  })

  it('reindex wipes chunks + resets the document; FTS stays consistent', async () => {
    const db = await WorkspaceDb.open(dbPath, keyHex)
    const docId = await seed(db)
    await db.reindexDocument(docId)
    expect(await db.chunkIdsForDocument(docId)).toHaveLength(0)
    expect(await db.searchChunks('fox', 5)).toHaveLength(0) // FTS purged via triggers
    expect((await db.getDocument(docId))!.status).toBe('pending')
    db.close()
  })

  it('is encrypted at rest and rejects the wrong key', async () => {
    const db = await WorkspaceDb.open(dbPath, keyHex)
    await seed(db)
    db.close()

    // bytes on disk must not contain plaintext chunk text
    const raw = await fs.readFile(dbPath)
    expect(raw.includes(Buffer.from('quick brown fox'))).toBe(false)

    // correct key reopens
    const ok = await WorkspaceDb.open(dbPath, keyHex)
    expect((await ok.searchChunks('fox', 5)).length).toBeGreaterThan(0)
    ok.close()

    // wrong key fails
    await expect(WorkspaceDb.open(dbPath, randomBytes(32).toString('hex'))).rejects.toThrow()
  })
})

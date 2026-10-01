import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { WorkspaceDb } from '@main/db/sqlite/WorkspaceDb'

describe('conditional summary and embedding writes', () => {
  let directory: string
  let db: WorkspaceDb
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'loklm-summary-race-'))
    db = await WorkspaceDb.open(join(directory, 'meta.db'), randomBytes(32).toString('hex'), 3)
  })
  afterEach(async () => {
    db?.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('keeps a replacement summary pending when an old embedding finishes late', async () => {
    const doc = await db.addDocument({
      title: 'Source',
      sourcePath: '/source.txt',
      status: 'ready',
    })
    await db.setSummary(doc.id, 'Original summary')
    await db.setSummary(doc.id, 'Replacement summary')
    expect(await db.setSummaryEmbedding(doc.id, [1, 0], 'fixture', 'Original summary')).toBe(false)
    expect(await db.listDocsMissingSummaryEmbedding(10)).toEqual([
      { id: doc.id, summary: 'Replacement summary' },
    ])
    expect(await db.setSummaryEmbedding(doc.id, [0, 1], 'fixture', 'Replacement summary')).toBe(
      true,
    )
    expect(await db.countDocsMissingSummaryEmbedding()).toBe(0)
  })

  it('rejects late vectors after reindex or deletion, including unchanged text while still indexing', async () => {
    const doc = await db.addDocument({
      title: 'Source',
      sourcePath: '/source.txt',
      status: 'ready',
    })
    await db.setSummary(doc.id, 'Original summary')
    await db.reindexDocument(doc.id)
    expect(await db.setSummaryEmbedding(doc.id, [1, 0], 'fixture', 'Original summary')).toBe(false)
    await db.setSummary(doc.id, 'Original summary')
    expect(await db.setSummaryEmbedding(doc.id, [1, 0], 'fixture', 'Original summary')).toBe(false)
    await db.deleteDocument(doc.id)
    expect(await db.setSummaryEmbedding(doc.id, [1, 0], 'fixture', 'Original summary')).toBe(false)
  })

  it.each(['original-hash', null])(
    'rejects an obsolete generated summary after completed reindex (source hash %j)',
    async (contentHash) => {
      const doc = await db.addDocument({
        title: 'Source',
        sourcePath: '/source.txt',
        status: 'ready',
        contentHash,
      })
      const chunks = [
        { ordinal: 0, text: 'Original source', pageFrom: 1, pageTo: 1, tokenCount: 4 },
      ]
      const ids = await db.persistChunks(doc.id, chunks)
      const revision = { contentHash, chunkCount: 1, lastChunkId: ids[0]! }
      expect(await db.setSummary(doc.id, 'Current summary', revision)).toBe(true)
      await db.setSummaryEmbedding(doc.id, [1, 0], 'fixture', 'Current summary')

      await db.reindexDocument(doc.id)
      expect(await db.setSummary(doc.id, 'Obsolete output while pending', revision)).toBe(false)
      const replacementIds = await db.persistChunks(doc.id, chunks)
      await db.setDocumentStatus(doc.id, 'ready')
      expect(replacementIds[0]).toBeGreaterThan(ids[0]!)
      expect(await db.setSummary(doc.id, 'Obsolete output after completion', revision)).toBe(false)
      expect((await db.getDocument(doc.id))?.summary).toBeNull()
      expect(await db.countDocsMissingSummaryEmbedding()).toBe(0)

      const current = { ...revision, lastChunkId: replacementIds[0]! }
      expect(await db.setSummary(doc.id, 'New generation', current)).toBe(true)
      await db.deleteDocument(doc.id)
      expect(await db.setSummary(doc.id, 'Deleted source output', current)).toBe(false)
    },
  )

  it('rejects a changed source hash before replacement chunks are persisted', async () => {
    const doc = await db.addDocument({
      title: 'Source',
      sourcePath: '/source.txt',
      status: 'ready',
      contentHash: 'original-hash',
    })
    const ids = await db.persistChunks(doc.id, [
      { ordinal: 0, text: 'Original source', pageFrom: 1, pageTo: 1, tokenCount: 4 },
    ])
    await db.setSourceMetadata(doc.id, { contentHash: 'replacement-hash' })
    expect(
      await db.setSummary(doc.id, 'Stale generation', {
        contentHash: 'original-hash',
        chunkCount: 1,
        lastChunkId: ids[0]!,
      }),
    ).toBe(false)
    expect((await db.getDocument(doc.id))?.summary).toBeNull()
  })

  it('finds summary vectors only in ready documents inside the requested source scope', async () => {
    const first = await db.addDocument({
      title: 'First',
      sourcePath: '/first.txt',
      status: 'ready',
    })
    const second = await db.addDocument({
      title: 'Second',
      sourcePath: '/second.txt',
      status: 'ready',
    })
    expect(await db.hasSummaryEmbeddings()).toBe(false)
    await db.setSummary(first.id, 'First summary')
    await db.setSummaryEmbedding(first.id, [1, 0], 'fixture', 'First summary')
    expect(await db.hasSummaryEmbeddings()).toBe(true)
    expect(await db.hasSummaryEmbeddings([])).toBe(true)
    expect(await db.hasSummaryEmbeddings([first.id])).toBe(true)
    expect(await db.hasSummaryEmbeddings([second.id])).toBe(false)
    await db.setDocumentStatus(first.id, 'indexing')
    expect(await db.hasSummaryEmbeddings()).toBe(false)
    expect(await db.hasSummaryEmbeddings([first.id])).toBe(false)
  })
})

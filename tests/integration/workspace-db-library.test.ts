import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { WorkspaceDb } from '../../src/main/db/sqlite/WorkspaceDb'

describe('WorkspaceDb.searchLibrary (FTS5)', () => {
  let dir: string
  let db: WorkspaceDb

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'loklm-lib-'))
    db = await WorkspaceDb.open(join(dir, 'meta.db'), randomBytes(32).toString('hex'), 1)
    const a = await db.addDocument({
      title: 'Photosynthesis',
      sourcePath: '/notes/photo.pdf',
      status: 'ready',
    })
    await db.persistChunks(a.id, [
      {
        ordinal: 0,
        text: 'chlorophyll converts sunlight into energy',
        pageFrom: 1,
        pageTo: 1,
        tokenCount: 5,
      },
    ])
    const b = await db.addDocument({
      title: 'TaxReturn2024',
      sourcePath: '/docs/tax.md',
      status: 'ready',
    })
    await db.persistChunks(b.id, [
      {
        ordinal: 0,
        text: 'income brackets and deductions explained',
        pageFrom: null,
        pageTo: null,
        tokenCount: 5,
      },
    ])
  })
  afterEach(async () => {
    db.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('content match returns the doc with a highlighted snippet + doc_type', async () => {
    const hits = await db.searchLibrary('chlorophyll')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.document_title).toBe('Photosynthesis')
    expect(hits[0]!.doc_type).toBe('pdf')
    expect(hits[0]!.headline).toContain('⟦')
  })

  it('title/filename match surfaces a doc even without a content hit', async () => {
    const hits = await db.searchLibrary('TaxReturn2024')
    expect(hits.map((h) => h.document_title)).toContain('TaxReturn2024')
    expect(hits.find((h) => h.document_title === 'TaxReturn2024')!.doc_type).toBe('md')
  })

  it('applies the type filter', async () => {
    // both docs mention nothing shared; query each term, filter to pdf only
    const hits = await db.searchLibrary('income', { types: ['pdf'] })
    expect(hits).toHaveLength(0) // the only 'income' hit is the .md doc, filtered out
  })
})

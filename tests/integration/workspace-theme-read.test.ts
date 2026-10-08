import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { WorkspaceDb } from '@main/db/sqlite/WorkspaceDb'

type ThemeRow = Awaited<ReturnType<WorkspaceDb['searchDocumentsByTheme']>>[number]
type SqlArg = string | number | bigint | Buffer | null
type RowBoundary = { rows(sql: string, args?: SqlArg[]): Record<string, unknown>[] }

describe('document theme lookup reads only needed summary vectors', () => {
  let directory: string
  let db: WorkspaceDb
  let rows: Record<string, ThemeRow>
  let vectorBytes: number

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'loklm-theme-read-'))
    db = await WorkspaceDb.open(join(directory, 'meta.db'), randomBytes(32).toString('hex'), 1)
    rows = {}
    const fixtures = [
      { key: 'many', title: 'Harbor', text: ['harbor schedules', 'harbor routes'] },
      { key: 'title', title: 'Harbor', text: ['vessel schedules'] },
      { key: 'chunk', title: 'Elsewhere', text: ['harbor cargo'] },
      { key: 'summary1', title: 'Same', text: ['unrelated'], summary: 'harbor operations' },
      { key: 'summary2', title: 'Same', text: ['unrelated'], summary: 'harbor operations' },
      { key: 'semantic', title: 'Semantic only', text: ['unrelated'], semantic: true },
      { key: 'pending', title: 'Harbor pending', text: ['harbor'], semantic: true, pending: true },
      { key: 'chunkless', title: 'Harbor empty', text: [], noVector: true },
      { key: 'unembedded', title: 'Harbor unembedded', text: ['unrelated'], noVector: true },
    ]
    for (const fixture of fixtures) {
      const doc = await db.addDocument({
        title: fixture.title,
        sourcePath: `/synthetic/${fixture.key}.txt`,
        status: fixture.pending ? 'pending' : 'ready',
      })
      const chunks = await db.persistChunks(
        doc.id,
        fixture.text.map((text, ordinal) => ({
          ordinal,
          text,
          pageFrom: 1,
          pageTo: 1,
          tokenCount: 3,
        })),
      )
      await db.setSummary(doc.id, fixture.summary ?? 'vessel operations')
      if (!fixture.noVector)
        await db.setSummaryEmbedding(
          doc.id,
          fixture.semantic ? [1, 0, 0, 0] : [0, 1, 0, 0],
          'synthetic-fixture',
        )
      rows[fixture.key] = {
        id: doc.id,
        title: fixture.title,
        chunkHits: 0,
        firstChunkId: chunks[0] ?? null,
      }
    }

    // Count real SQLite-to-JS vector bytes before the lookup's membership
    // filter consumes the rows. Checking only returned documents would miss
    // the waste: the public result intentionally contains no vector BLOBs.
    vectorBytes = 0
    const boundary = db as unknown as RowBoundary
    const readRows = boundary.rows.bind(db)
    vi.spyOn(boundary, 'rows').mockImplementation((sql, args) => {
      const result = readRows(sql, args)
      for (const row of result)
        if (Buffer.isBuffer(row.summary_embedding)) vectorBytes += row.summary_embedding.byteLength
      return result
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    db?.close()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  function row(key: string, chunkHits = 0): ThemeRow {
    return { ...rows[key]!, chunkHits }
  }

  function lexicalMatches(): ThemeRow[] {
    return [
      row('many', 2),
      row('chunk', 1),
      row('title'),
      row('chunkless'),
      row('unembedded'),
      row('summary1'),
      row('summary2'),
    ]
  }

  it.each([{}, { themeEmbedding: null }, { themeEmbedding: [] }])(
    'keeps lexical membership, counts, ordering and citations without a query vector: %j',
    async (opts) => {
      expect(await db.searchDocumentsByTheme(['harbor'], opts)).toEqual(lexicalMatches())
      expect(vectorBytes).toBe(0)
    },
  )

  it('lists ready documents including chunkless ones without loading vectors for an empty theme', async () => {
    expect(await db.searchDocumentsByTheme([])).toEqual([
      row('chunk'),
      row('many'),
      row('title'),
      row('chunkless'),
      row('unembedded'),
      row('summary1'),
      row('summary2'),
      row('semantic'),
    ])
    expect(vectorBytes).toBe(0)
  })

  it('keeps source focus and ready-state filtering on the lexical path', async () => {
    expect(
      await db.searchDocumentsByTheme(['harbor'], {
        activeDocumentIds: [rows.semantic!.id, rows.pending!.id, rows.many!.id, rows.summary2!.id],
      }),
    ).toEqual([row('many', 2), row('summary2')])
    expect(vectorBytes).toBe(0)
  })

  it('retains workspace-wide lookup for an empty source scope', async () => {
    expect(await db.searchDocumentsByTheme(['harbor'], { activeDocumentIds: [] })).toEqual(
      lexicalMatches(),
    )
    expect(vectorBytes).toBe(0)
  })

  it('returns no matches for an absent lexical theme without reading vectors', async () => {
    expect(await db.searchDocumentsByTheme(['observatory'])).toEqual([])
    expect(vectorBytes).toBe(0)
  })

  it('retains semantic-only membership without displacing lexical matches', async () => {
    expect(
      await db.searchDocumentsByTheme(['harbor'], {
        themeEmbedding: [1, 0, 0, 0],
        similarityThreshold: 1,
      }),
    ).toEqual([...lexicalMatches(), row('semantic')])
    expect(vectorBytes).toBeGreaterThan(0)
  })

  it('preserves source focus, ready-state filtering and the semantic threshold boundary', async () => {
    const opts = {
      themeEmbedding: [1, 0, 0, 0],
      activeDocumentIds: [rows.semantic!.id, rows.pending!.id],
    }
    expect(
      await db.searchDocumentsByTheme(['harbor'], { ...opts, similarityThreshold: 1 }),
    ).toEqual([row('semantic')])
    expect(
      await db.searchDocumentsByTheme(['harbor'], { ...opts, similarityThreshold: 1.01 }),
    ).toEqual([])
    expect(vectorBytes).toBeGreaterThan(0)
  })
})

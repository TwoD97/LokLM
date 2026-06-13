import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupDb, teardownDb, withTransaction, type Tx } from './helpers/withTransaction'
import { workspaces, documents, chunks } from '@main/db/schema'
import { DocumentsRepo } from '@main/db/database'

const DIM = 1024
const vec = (seed: number): number[] =>
  Array.from({ length: DIM }, (_, i) => Math.sin((i + 1) * (seed + 1)))

describe('DocumentsRepo search methods (tx)', () => {
  beforeAll(setupDb, 30_000)
  afterAll(teardownDb)

  it('searchChunks does bilingual BM25 with workspace + status filters', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'doc.md', sourcePath: '/d', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 0, text: 'Hallo Welt english world', tokenCount: 4 },
        { documentId: doc!.id, ordinal: 1, text: 'Etwas anderes auf deutsch', tokenCount: 4 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const hits = await repo.searchChunks(ws!.id, 'welt', 5)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0]!.text).toContain('Welt')
    })
  })

  it('searchChunks skips documents whose status is not ready', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'indexing' })
        .returning()
      await tx
        .insert(chunks)
        .values({ documentId: doc!.id, ordinal: 0, text: 'lookup target', tokenCount: 2 })
      const repo = new DocumentsRepo(tx as never)
      const hits = await repo.searchChunks(ws!.id, 'target', 5)
      expect(hits).toHaveLength(0)
    })
  })

  it('searchChunks respects activeDocumentIds filter', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [a] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'a', sourcePath: '/a', status: 'ready' })
        .returning()
      const [b] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'b', sourcePath: '/b', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: a!.id, ordinal: 0, text: 'shared keyword content', tokenCount: 3 },
        { documentId: b!.id, ordinal: 0, text: 'shared keyword present', tokenCount: 3 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const filtered = await repo.searchChunks(ws!.id, 'keyword', 5, { activeDocumentIds: [a!.id] })
      expect(filtered).toHaveLength(1)
      expect(filtered[0]!.document_id).toBe(a!.id)
    })
  })

  it('searchChunks applies per-doc cap', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      for (let i = 0; i < 5; i++) {
        await tx
          .insert(chunks)
          .values({ documentId: doc!.id, ordinal: i, text: `match line ${i}`, tokenCount: 3 })
      }
      const repo = new DocumentsRepo(tx as never)
      const capped = await repo.searchChunks(ws!.id, 'match', 10, { perDocK: 2 })
      expect(capped.length).toBeLessThanOrEqual(2)
    })
  })

  it('searchChunksByVector returns nearest by cosine', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 0, text: 'A', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 1, text: 'B', tokenCount: 1 },
      ])
      const rows = await tx.execute(sql`SELECT id FROM chunks ORDER BY ordinal`)
      const ids = (rows.rows as { id: number }[]).map((r) => r.id)
      const repo = new DocumentsRepo(tx as never)
      await repo.setChunkEmbedding(ids[0]!, vec(1), 'bundled:bge-m3')
      await repo.setChunkEmbedding(ids[1]!, vec(50), 'bundled:bge-m3')
      const hits = await repo.searchChunksByVector(ws!.id, vec(50), 1)
      expect(hits).toHaveLength(1)
      expect(hits[0]!.chunk_id).toBe(ids[1])
    })
  })

  it('listChunksForDocument returns chunks in ordinal order', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 1, text: 'b', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 0, text: 'a', tokenCount: 1 },
        { documentId: doc!.id, ordinal: 2, text: 'c', tokenCount: 1 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const rows = await repo.listChunksForDocument(doc!.id)
      expect(rows.map((r) => r.text)).toEqual(['a', 'b', 'c'])
    })
  })
})

describe('DocumentsRepo.searchLibrary (tx)', () => {
  beforeAll(setupDb, 30_000)
  afterAll(teardownDb)

  // helper: insert a ready document + one chunk, returns the document id
  async function seedDoc(
    tx: Tx,
    workspaceId: number,
    opts: {
      title: string
      sourcePath: string
      text: string
      language?: 'de' | 'en' | 'other'
      byteSize?: number
      addedAt?: number
      pageFrom?: number
      headingPath?: string[]
    },
  ): Promise<number> {
    const [doc] = await tx
      .insert(documents)
      .values({
        workspaceId,
        title: opts.title,
        sourcePath: opts.sourcePath,
        status: 'ready',
        byteSize: opts.byteSize ?? null,
        addedAt: opts.addedAt ?? 1000,
      })
      .returning()
    await tx.insert(chunks).values({
      documentId: doc!.id,
      ordinal: 0,
      text: opts.text,
      tokenCount: 4,
      language: opts.language ?? null,
      pageFrom: opts.pageFrom ?? null,
      pageTo: opts.pageFrom ?? null,
      headingPath: opts.headingPath ?? null,
    })
    return doc!.id
  }

  it('returns [] for an empty query', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const repo = new DocumentsRepo(tx as never)
      expect(await repo.searchLibrary(ws!.id, '   ')).toEqual([])
    })
  })

  it('wraps matched terms in ⟦⟧ sentinels for de and en chunks', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      await seedDoc(tx, ws!.id, {
        title: 'de',
        sourcePath: '/de.md',
        text: 'Der schnelle braune Fuchs springt über den faulen Hund',
        language: 'de',
      })
      await seedDoc(tx, ws!.id, {
        title: 'en',
        sourcePath: '/en.md',
        text: 'The quick brown fox jumps over the lazy dog',
        language: 'en',
      })
      const repo = new DocumentsRepo(tx as never)

      const de = await repo.searchLibrary(ws!.id, 'Fuchs')
      expect(de).toHaveLength(1)
      expect(de[0]!.headline).toContain('⟦')
      expect(de[0]!.headline.toLowerCase()).toContain('⟦fuchs⟧')

      const en = await repo.searchLibrary(ws!.id, 'fox')
      expect(en).toHaveLength(1)
      expect(en[0]!.headline.toLowerCase()).toContain('⟦fox⟧')
    })
  })

  it('always returns a non-empty headline for a matching document', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      await seedDoc(tx, ws!.id, {
        title: 'd',
        sourcePath: '/d.md',
        text: 'alpha beta gamma keyword delta epsilon',
        language: 'en',
      })
      const repo = new DocumentsRepo(tx as never)
      const hits = await repo.searchLibrary(ws!.id, 'keyword')
      expect(hits).toHaveLength(1)
      expect(hits[0]!.headline.length).toBeGreaterThan(0)
    })
  })

  it('derives doc_type from the source-path extension', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const text = 'shared keyword content here'
      await seedDoc(tx, ws!.id, { title: 'a', sourcePath: '/a.pdf', text })
      await seedDoc(tx, ws!.id, { title: 'b', sourcePath: '/b.md', text })
      await seedDoc(tx, ws!.id, { title: 'c', sourcePath: '/c.ts', text })
      await seedDoc(tx, ws!.id, { title: 'd', sourcePath: '/d.docx', text })
      await seedDoc(tx, ws!.id, { title: 'e', sourcePath: '/e.txt', text })
      const repo = new DocumentsRepo(tx as never)
      const hits = await repo.searchLibrary(ws!.id, 'keyword')
      const byTitle = Object.fromEntries(hits.map((h) => [h.document_title, h.doc_type]))
      expect(byTitle).toEqual({ a: 'pdf', b: 'md', c: 'code', d: 'docx', e: 'txt' })
    })
  })

  it('filters by document type', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const text = 'typed keyword content'
      await seedDoc(tx, ws!.id, { title: 'a', sourcePath: '/a.pdf', text })
      await seedDoc(tx, ws!.id, { title: 'b', sourcePath: '/b.md', text })
      await seedDoc(tx, ws!.id, { title: 'c', sourcePath: '/c.ts', text })
      const repo = new DocumentsRepo(tx as never)

      const pdfOnly = await repo.searchLibrary(ws!.id, 'keyword', { types: ['pdf'] })
      expect(pdfOnly.map((h) => h.document_title)).toEqual(['a'])

      const codeOnly = await repo.searchLibrary(ws!.id, 'keyword', { types: ['code'] })
      expect(codeOnly.map((h) => h.document_title)).toEqual(['c'])

      const pdfOrMd = await repo.searchLibrary(ws!.id, 'keyword', { types: ['pdf', 'md'] })
      expect(pdfOrMd.map((h) => h.document_title).sort()).toEqual(['a', 'b'])
    })
  })

  it('filters by added_at lower bound', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      await seedDoc(tx, ws!.id, {
        title: 'old',
        sourcePath: '/old.md',
        text: 'datefilter term',
        addedAt: 1000,
      })
      await seedDoc(tx, ws!.id, {
        title: 'new',
        sourcePath: '/new.md',
        text: 'datefilter term',
        addedAt: 2000,
      })
      const repo = new DocumentsRepo(tx as never)
      const recent = await repo.searchLibrary(ws!.id, 'datefilter', { addedAfter: 1500 })
      expect(recent.map((h) => h.document_title)).toEqual(['new'])
    })
  })

  it('filters by byte-size bounds', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      await seedDoc(tx, ws!.id, {
        title: 'small',
        sourcePath: '/s.md',
        text: 'sizefilter term',
        byteSize: 500,
      })
      await seedDoc(tx, ws!.id, {
        title: 'big',
        sourcePath: '/b.md',
        text: 'sizefilter term',
        byteSize: 5_000_000,
      })
      const repo = new DocumentsRepo(tx as never)

      const large = await repo.searchLibrary(ws!.id, 'sizefilter', { minBytes: 1000 })
      expect(large.map((h) => h.document_title)).toEqual(['big'])

      const tiny = await repo.searchLibrary(ws!.id, 'sizefilter', { maxBytes: 1000 })
      expect(tiny.map((h) => h.document_title)).toEqual(['small'])
    })
  })

  it('sorts by filename (case-insensitive) and by import date', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const text = 'sortterm appears here'
      await seedDoc(tx, ws!.id, { title: 'Zebra', sourcePath: '/z.md', text, addedAt: 300 })
      await seedDoc(tx, ws!.id, { title: 'alpha', sourcePath: '/a.md', text, addedAt: 100 })
      await seedDoc(tx, ws!.id, { title: 'Mango', sourcePath: '/m.md', text, addedAt: 200 })
      const repo = new DocumentsRepo(tx as never)

      const byName = await repo.searchLibrary(ws!.id, 'sortterm', { sort: 'filename' })
      expect(byName.map((h) => h.document_title)).toEqual(['alpha', 'Mango', 'Zebra'])

      const byDate = await repo.searchLibrary(ws!.id, 'sortterm', { sort: 'added' })
      expect(byDate.map((h) => h.document_title)).toEqual(['Zebra', 'Mango', 'alpha'])
    })
  })

  it('collapses a document with several matching chunks to one best hit', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'multi', sourcePath: '/multi.md', status: 'ready' })
        .returning()
      await tx.insert(chunks).values([
        { documentId: doc!.id, ordinal: 0, text: 'dedupterm once', tokenCount: 2 },
        { documentId: doc!.id, ordinal: 1, text: 'dedupterm dedupterm twice', tokenCount: 3 },
        { documentId: doc!.id, ordinal: 2, text: 'dedupterm thrice here', tokenCount: 3 },
      ])
      const repo = new DocumentsRepo(tx as never)
      const hits = await repo.searchLibrary(ws!.id, 'dedupterm')
      expect(hits).toHaveLength(1)
      expect(hits[0]!.document_id).toBe(doc!.id)
    })
  })

  it('only searches the given workspace and ready documents', async () => {
    await withTransaction(async (tx) => {
      const [ws1] = await tx.insert(workspaces).values({ name: 'ws1' }).returning()
      const [ws2] = await tx.insert(workspaces).values({ name: 'ws2' }).returning()
      await seedDoc(tx, ws1!.id, { title: 'in', sourcePath: '/in.md', text: 'isolation term' })
      await seedDoc(tx, ws2!.id, {
        title: 'other',
        sourcePath: '/other.md',
        text: 'isolation term',
      })
      const [pending] = await tx
        .insert(documents)
        .values({ workspaceId: ws1!.id, title: 'pending', sourcePath: '/p.md', status: 'indexing' })
        .returning()
      await tx
        .insert(chunks)
        .values({ documentId: pending!.id, ordinal: 0, text: 'isolation term', tokenCount: 2 })
      const repo = new DocumentsRepo(tx as never)
      const hits = await repo.searchLibrary(ws1!.id, 'isolation')
      expect(hits.map((h) => h.document_title)).toEqual(['in'])
    })
  })
  describe('searchDocumentsByTheme (corpus route)', () => {
    it('ranks by chunk BM25 hits and returns the first chunk id per doc', async () => {
      await withTransaction(async (tx) => {
        const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
        const [a] = await tx
          .insert(documents)
          .values({ workspaceId: ws!.id, title: 'Grundlagen', sourcePath: '/a', status: 'ready' })
          .returning()
        const [b] = await tx
          .insert(documents)
          .values({ workspaceId: ws!.id, title: 'Notizen', sourcePath: '/b', status: 'ready' })
          .returning()
        const [c] = await tx
          .insert(documents)
          .values({ workspaceId: ws!.id, title: 'Kochbuch', sourcePath: '/c', status: 'ready' })
          .returning()
        const [a0] = await tx
          .insert(chunks)
          .values({
            documentId: a!.id,
            ordinal: 0,
            text: 'Strom ist der Fluss von Ladung',
            tokenCount: 6,
          })
          .returning()
        await tx.insert(chunks).values([
          { documentId: a!.id, ordinal: 1, text: 'Strom und Spannung im Detail', tokenCount: 5 },
          { documentId: b!.id, ordinal: 0, text: 'Notiz über Strom im Labor', tokenCount: 5 },
          { documentId: c!.id, ordinal: 0, text: 'Pfannkuchen mit Butter', tokenCount: 4 },
        ])
        const repo = new DocumentsRepo(tx as never)
        const rows = await repo.searchDocumentsByTheme(ws!.id, ['strom'])
        expect(rows.map((r) => r.id)).toEqual([a!.id, b!.id])
        expect(rows[0]!.chunkHits).toBe(2)
        expect(rows[1]!.chunkHits).toBe(1)
        expect(rows[0]!.firstChunkId).toBe(a0!.id)
      })
    })

    it('title and summary matches count even with zero chunk hits', async () => {
      await withTransaction(async (tx) => {
        const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
        const [titled] = await tx
          .insert(documents)
          .values({
            workspaceId: ws!.id,
            title: 'Strom Formelsammlung',
            sourcePath: '/t',
            status: 'ready',
          })
          .returning()
        const [summarized] = await tx
          .insert(documents)
          .values({
            workspaceId: ws!.id,
            title: 'Skript Kapitel 3',
            sourcePath: '/s',
            status: 'ready',
            summary: 'Behandelt strom und widerstand im gleichstromkreis.',
          })
          .returning()
        await tx.insert(chunks).values([
          {
            documentId: titled!.id,
            ordinal: 0,
            text: 'Formeln ohne das Themenwort',
            tokenCount: 4,
          },
          {
            documentId: summarized!.id,
            ordinal: 0,
            text: 'Inhalt ohne das Themenwort',
            tokenCount: 4,
          },
        ])
        const repo = new DocumentsRepo(tx as never)
        const rows = await repo.searchDocumentsByTheme(ws!.id, ['strom'])
        expect(rows.map((r) => r.id).sort()).toEqual([titled!.id, summarized!.id].sort())
        expect(rows.every((r) => r.chunkHits === 0)).toBe(true)
      })
    })

    it('empty theme returns every ready doc (count-all questions)', async () => {
      await withTransaction(async (tx) => {
        const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
        await tx.insert(documents).values([
          { workspaceId: ws!.id, title: 'eins', sourcePath: '/1', status: 'ready' },
          { workspaceId: ws!.id, title: 'zwei', sourcePath: '/2', status: 'ready' },
          { workspaceId: ws!.id, title: 'drei', sourcePath: '/3', status: 'indexing' },
        ])
        const repo = new DocumentsRepo(tx as never)
        const rows = await repo.searchDocumentsByTheme(ws!.id, [])
        expect(rows.map((r) => r.title).sort()).toEqual(['eins', 'zwei'])
      })
    })

    it('respects the activeDocumentIds pin', async () => {
      await withTransaction(async (tx) => {
        const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
        const [a] = await tx
          .insert(documents)
          .values({ workspaceId: ws!.id, title: 'a strom', sourcePath: '/a', status: 'ready' })
          .returning()
        await tx
          .insert(documents)
          .values({ workspaceId: ws!.id, title: 'b strom', sourcePath: '/b', status: 'ready' })
        const repo = new DocumentsRepo(tx as never)
        const rows = await repo.searchDocumentsByTheme(ws!.id, ['strom'], {
          activeDocumentIds: [a!.id],
        })
        expect(rows.map((r) => r.id)).toEqual([a!.id])
      })
    })

    it('escapes ILIKE wildcards in theme tokens — "100%" is a literal % , not match-all', async () => {
      await withTransaction(async (tx) => {
        const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
        // 'Kapitel 100 von 200' contains "100" but no literal '%' — with broken
        // escaping the pattern degrades to %100% and matches this; with correct
        // escaping (\%) it must NOT. '100% Erfolg' contains a literal '%' and
        // must match. Title-only docs (no chunks) so only the ILIKE branch fires.
        await tx.insert(documents).values([
          { workspaceId: ws!.id, title: 'Kapitel 100 von 200', sourcePath: '/k', status: 'ready' },
          { workspaceId: ws!.id, title: '100% Erfolg', sourcePath: '/e', status: 'ready' },
        ])
        const repo = new DocumentsRepo(tx as never)
        const rows = await repo.searchDocumentsByTheme(ws!.id, ['100%'])
        expect(rows.map((r) => r.title)).toEqual(['100% Erfolg'])
      })
    })

    it('a bare "%" token is a literal percent, never a match-everything wildcard', async () => {
      await withTransaction(async (tx) => {
        const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
        await tx.insert(documents).values([
          { workspaceId: ws!.id, title: 'plain title', sourcePath: '/p', status: 'ready' },
          { workspaceId: ws!.id, title: '50 % Rabatt', sourcePath: '/r', status: 'ready' },
        ])
        const repo = new DocumentsRepo(tx as never)
        const rows = await repo.searchDocumentsByTheme(ws!.id, ['%'])
        expect(rows.map((r) => r.title)).toEqual(['50 % Rabatt'])
      })
    })

    it('underscore in a theme token is literal, not a single-char wildcard', async () => {
      await withTransaction(async (tx) => {
        const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
        await tx.insert(documents).values([
          { workspaceId: ws!.id, title: 'aXb variant', sourcePath: '/x', status: 'ready' },
          { workspaceId: ws!.id, title: 'a_b literal', sourcePath: '/u', status: 'ready' },
        ])
        const repo = new DocumentsRepo(tx as never)
        const rows = await repo.searchDocumentsByTheme(ws!.id, ['a_b'])
        expect(rows.map((r) => r.title)).toEqual(['a_b literal'])
      })
    })
  })
})

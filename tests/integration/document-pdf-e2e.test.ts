import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import type { IndexProgress } from '@main/services/documents/types'

const FIX = resolve(__dirname, '..', 'unit', 'fixtures')

// AP-T.2 (Pflichtenheft §8.2) — DocumentService E2E: committetes Beispiel-PDF
// importieren und den Datenfluss bis in die DB verifizieren — documents-Zeile,
// Chunks, Volltextsuche, denormalisiertes chunk_count. Läuft ohne Modelle
// (DocumentService ohne Registry → kein Embedding nötig), also auch in CI.
//
// Hinweis zur Spec: "text_search durch Trigger befüllt" stammt aus der Zeit vor
// Migration 0006 — die Spalte samt Trigger wurde durch den GIN-Expression-Index
// idx_chunks_fts ersetzt. Geprüft wird hier das heutige Äquivalent: der Index
// existiert und die FTS-Expression matcht real importierten Chunk-Text.
describe('AP-T.2 DocumentService E2E (PDF-Import)', () => {
  let dir: string
  let auth: AuthService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-docpdf-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  async function importSamplePdf() {
    const ws = await new WorkspaceService(auth).create('WS')
    // Fixture in den Temp-Ordner kopieren — DocumentService speichert den
    // sourcePath, das committete Original soll unangetastet bleiben.
    const path = join(dir, 'sample.pdf')
    await copyFile(join(FIX, 'sample.pdf'), path)

    const sent: IndexProgress[] = []
    const fakeSender = { send: (_ch: string, payload: IndexProgress) => sent.push(payload) }
    const docs = new DocumentService(auth)
    const doc = await docs.importFile({
      workspaceId: ws.id,
      sourcePath: path,
      sender: fakeSender as unknown as Electron.WebContents,
    })
    await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 20_000)
    expect(sent.at(-1)?.phase).toBe('done')
    return doc
  }

  it('PDF-Import → documents-Zeile ready, Chunks vorhanden, chunk_count denormalisiert', async () => {
    const doc = await importSamplePdf()
    expect(doc.mimeType).toBe('application/pdf')

    const repo = auth.requireDatabase().documents()
    const refreshed = await repo.getDocument(doc.id)
    expect(refreshed?.status).toBe('ready')

    const chunks = await repo.listChunksForDocument(doc.id)
    expect(chunks.length).toBeGreaterThan(0)
    // chunk_count wird vom Statement-Trigger (Migration 0003) gepflegt und muss
    // exakt der echten Chunk-Anzahl entsprechen.
    expect(refreshed?.chunkCount).toBe(chunks.length)
  }, 30_000)

  it('Volltextsuche: idx_chunks_fts existiert und matcht importierten Chunk-Text', async () => {
    const doc = await importSamplePdf()
    const db = auth.requireDatabase()

    const idx = await db.db.execute(sql`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'chunks' AND indexname = 'idx_chunks_fts'
    `)
    expect((idx.rows as { indexname: string }[]).length).toBe(1)

    // Kandidaten-Wörter aus dem ersten Chunk ziehen (≥6 Zeichen, um Stopwords
    // zu meiden) und verlangen, dass die FTS-Expression — dieselbe wie in
    // searchChunks — den Chunk über mindestens eines davon wiederfindet.
    const chunks = await db.documents().listChunksForDocument(doc.id)
    const first = chunks[0]!
    const words = first.text.split(/[^A-Za-zÄÖÜäöüß]+/).filter((w) => w.length >= 6)
    expect(words.length).toBeGreaterThan(0)

    let matched = false
    for (const word of words.slice(0, 5)) {
      const r = await db.db.execute(sql`
        SELECT id FROM chunks
         WHERE document_id = ${doc.id}
           AND (setweight(to_tsvector('german',  text), 'A') ||
                setweight(to_tsvector('english', text), 'B')) @@ plainto_tsquery('english', ${word})
      `)
      if ((r.rows as { id: number }[]).some((row) => row.id === first.id)) {
        matched = true
        break
      }
    }
    expect(matched).toBe(true)
  }, 30_000)

  it('chunk_count folgt auch der Löschung (Statement-Trigger, DELETE-Pfad)', async () => {
    const doc = await importSamplePdf()
    const db = auth.requireDatabase()

    await db.db.execute(sql`DELETE FROM chunks WHERE document_id = ${doc.id}`)

    const refreshed = await db.documents().getDocument(doc.id)
    expect(refreshed?.chunkCount).toBe(0)
    expect(refreshed?.tokenCount).toBe(0)
  }, 30_000)
})

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}

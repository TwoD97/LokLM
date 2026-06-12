import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import type { IndexProgress } from '@main/services/documents/types'

// AP-6 DoD (Pflichtenheft §3.5): "Mit Test-Korpus aus M2/M3 liefert die Suche
// gefilterte, sortierte, gehighlightete Treffer." This drives a small corpus
// (markdown + plain text + code — the M3 markdown scenario plus the PDF/MD/TXT/
// Code/DOCX type spread) through the REAL import pipeline, then asserts
// searchLibrary returns filtered, sorted and highlighted hits. FTS-only, so it
// needs no embedder model and runs in CI (unlike the gated retrieval test).
// PDF/DOCX type classification is covered deterministically by the tx test and
// the docType unit test; the full click→SourceViewer path by the manual
// M-scenario (docs/manual-scenarios/AP-6-suche-filter.md).

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('searchLibrary over an imported corpus (integration)', () => {
  let dir: string
  let auth: AuthService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-libsearch-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('delivers filtered, sorted and highlighted hits', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)
    const sent: IndexProgress[] = []
    const sender = {
      send: (_ch: string, p: IndexProgress) => sent.push(p),
    } as unknown as Electron.WebContents

    const corpus: Array<[string, string]> = [
      ['bericht.md', '# Bericht\n\nDer schnelle braune Fuchs trägt das keyword durch den Wald.'],
      ['notes.txt', 'The quick brown fox carries the keyword across the meadow.'],
      ['script.ts', 'export const note = "the keyword lives in this code file"\n'],
    ]
    const ids: number[] = []
    for (const [name, body] of corpus) {
      const path = join(dir, name)
      await writeFile(path, body, 'utf-8')
      const doc = await docs.importFile({ workspaceId: ws.id, sourcePath: path, sender })
      ids.push(doc.id)
    }
    await waitFor(() => {
      const done = new Set(sent.filter((e) => e.phase === 'done').map((e) => e.documentId))
      return ids.every((id) => done.has(id))
    }, 30_000)

    const repo = auth.requireDatabase().documents()

    // highlighted: the matched German term is wrapped in ⟦…⟧ sentinels.
    const fuchs = await repo.searchLibrary(ws.id, 'Fuchs')
    expect(fuchs.length).toBe(1)
    expect(fuchs[0]!.headline.toLowerCase()).toContain('⟦fuchs⟧')

    // the shared term matches all three documents, one hit each.
    const all = await repo.searchLibrary(ws.id, 'keyword')
    expect(new Set(all.map((h) => h.doc_type))).toEqual(new Set(['md', 'txt', 'code']))
    expect(all.every((h) => h.headline.includes('⟦'))).toBe(true)

    // filtered by document type.
    const codeOnly = await repo.searchLibrary(ws.id, 'keyword', { types: ['code'] })
    expect(codeOnly.map((h) => h.doc_type)).toEqual(['code'])
    const textTypes = await repo.searchLibrary(ws.id, 'keyword', { types: ['md', 'txt'] })
    expect(new Set(textTypes.map((h) => h.doc_type))).toEqual(new Set(['md', 'txt']))

    // sorted by filename (case-insensitive ascending).
    const byName = await repo.searchLibrary(ws.id, 'keyword', { sort: 'filename' })
    const titles = byName.map((h) => h.document_title)
    expect(titles).toEqual(
      [...titles].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    )
  }, 60_000)
})

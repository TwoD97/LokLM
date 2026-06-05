import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import { ImportError, type IndexProgress } from '@main/services/documents/types'

const FIX = resolve(__dirname, '..', 'unit', 'fixtures')

describe('DocumentService.importFile (integration)', () => {
  let dir: string
  let auth: AuthService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-doc-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('imports a markdown file → ready, chunks present', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const path = join(dir, 'sample.md')
    await writeFile(path, '# Hello\n\nFirst paragraph.\n\nSecond paragraph.', 'utf-8')

    const sent: IndexProgress[] = []
    const fakeSender = { send: (_ch: string, payload: IndexProgress) => sent.push(payload) }
    const docs = new DocumentService(auth)
    const doc = await docs.importFile({
      workspaceId: ws.id,
      sourcePath: path,
      sender: fakeSender as unknown as Electron.WebContents,
    })
    expect(doc.status).toBe('pending')

    await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 5000)
    expect(sent.at(-1)?.phase).toBe('done')

    const refreshed = await auth.requireDatabase().documents().getDocument(doc.id)
    expect(refreshed?.status).toBe('ready')
    expect(refreshed?.chunkCount).toBeGreaterThan(0)
  }, 30_000)

  it('imports a docx file → markdown-aware chunks with heading_path populated', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    // Copy the fixture into the temp dir — DocumentService stores sourcePath,
    // we don't want the test to mutate the committed fixture by accident.
    const path = join(dir, 'sample.docx')
    await copyFile(join(FIX, 'sample.docx'), path)

    const sent: IndexProgress[] = []
    const fakeSender = { send: (_ch: string, payload: IndexProgress) => sent.push(payload) }
    const docs = new DocumentService(auth)
    const doc = await docs.importFile({
      workspaceId: ws.id,
      sourcePath: path,
      sender: fakeSender as unknown as Electron.WebContents,
    })
    expect(doc.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )

    await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 10000)
    expect(sent.at(-1)?.phase).toBe('done')

    const refreshed = await auth.requireDatabase().documents().getDocument(doc.id)
    expect(refreshed?.status).toBe('ready')
    expect(refreshed?.chunkCount).toBeGreaterThan(0)

    // The DOCX → markdown → chunkMarkdown path must populate heading_path so
    // citations render breadcrumbs. At least one chunk should carry the
    // 'Einführung' or 'Methoden' H1 from the fixture.
    const repo = auth.requireDatabase().documents()
    const chunks = await repo.listChunksForDocument(doc.id)
    const withHeading = chunks.filter((c) => c.heading_path && c.heading_path.length > 0)
    expect(withHeading.length).toBeGreaterThan(0)
    const allHeadings = withHeading.flatMap((c) => c.heading_path ?? [])
    expect(allHeadings).toEqual(expect.arrayContaining(['Einführung']))
    expect(allHeadings).toEqual(expect.arrayContaining(['Methoden']))
  }, 30_000)

  it('rejects unsupported extensions', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)
    await expect(
      docs.importFile({ workspaceId: ws.id, sourcePath: '/tmp/foo.xyz' }),
    ).rejects.toThrow(/unsupported/i)
  })

  it('rejects files over 50 MB', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const path = join(dir, 'big.txt')
    const fh = await (await import('node:fs/promises')).open(path, 'w')
    await fh.truncate(51 * 1024 * 1024)
    await fh.close()
    const docs = new DocumentService(auth)
    await expect(docs.importFile({ workspaceId: ws.id, sourcePath: path })).rejects.toThrow(
      /50 MB/i,
    )
  })

  // Regression: clicking Reindex on a previously-imported doc used to trip the
  // (workspace_id, source_path) unique index because the old IPC handler did
  // reindex_document + importFile back-to-back. The fix routes through
  // DocumentService.reindex which updates the existing row in place. This test
  // exercises the same flow end-to-end so the bug can't sneak back.
  it('reindex re-vectorizes an already-imported doc without insert collision', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const path = join(dir, 'sample.md')
    await writeFile(path, '# Hello\n\nBefore reindex.', 'utf-8')

    const sent: IndexProgress[] = []
    const fakeSender = { send: (_ch: string, payload: IndexProgress) => sent.push(payload) }
    const docs = new DocumentService(auth)
    const doc = await docs.importFile({
      workspaceId: ws.id,
      sourcePath: path,
      sender: fakeSender as unknown as Electron.WebContents,
    })
    await waitFor(() => sent.some((e) => e.documentId === doc.id && e.phase === 'done'), 5000)

    // Mutate file so the reindex has different bytes ; the hash short-circuit
    // wouldn't kick in here (service.reindex is unconditional) but this keeps
    // the test honest about the new chunk count being driven by the new bytes.
    await writeFile(path, '# Hello\n\nFirst paragraph.\n\nSecond paragraph.', 'utf-8')

    sent.length = 0
    const refreshed = await docs.reindex(doc.id, fakeSender as unknown as Electron.WebContents)
    expect(refreshed.id).toBe(doc.id) // same row, not a new insert
    await waitFor(() => sent.some((e) => e.documentId === doc.id && e.phase === 'done'), 5000)

    const repo = auth.requireDatabase().documents()
    const after = await repo.getDocument(doc.id)
    expect(after?.status).toBe('ready')
    expect(after?.chunkCount).toBeGreaterThan(0)

    // And only ONE row exists for that (workspace, path) — the unique index
    // would have rejected a duplicate insert, so this asserts we didn't even
    // try.
    const all = await repo.listDocumentsByWorkspace(ws.id)
    expect(all.filter((d) => d.sourcePath === path)).toHaveLength(1)
  }, 30_000)

  // Belt-and-suspenders: any future caller that re-imports an already-known
  // path (sync loop, mis-wired button, copy/paste in a test) gets a coded
  // ImportError instead of the raw `insert into "documents"` SQL trace.
  it('importFile throws ImportError(already_imported) for a known (workspace, path)', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const path = join(dir, 'sample.md')
    await writeFile(path, '# Hello\n\nFirst paragraph.', 'utf-8')

    const docs = new DocumentService(auth)
    await docs.importFile({ workspaceId: ws.id, sourcePath: path })

    await expect(docs.importFile({ workspaceId: ws.id, sourcePath: path })).rejects.toMatchObject({
      name: 'ImportError',
      code: 'already_imported',
      path,
    })
  }, 15_000)

  // Bounded indexing queue: a batch of imports must ALL reach 'ready' even
  // though only MAX_CONCURRENT_INDEXING run at once — i.e. the pump drains the
  // backlog rather than stalling after the first couple of jobs.
  it('drains a batch of imports through the bounded queue (all reach ready)', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const sent: IndexProgress[] = []
    const fakeSender = { send: (_ch: string, payload: IndexProgress) => sent.push(payload) }
    const docs = new DocumentService(auth)
    const N = 5
    const created: Array<{ id: number }> = []
    for (let i = 0; i < N; i++) {
      const path = join(dir, `batch-${i}.md`)
      await writeFile(path, `# Doc ${i}\n\nBody paragraph number ${i} with some words.`, 'utf-8')
      created.push(
        await docs.importFile({
          workspaceId: ws.id,
          sourcePath: path,
          sender: fakeSender as unknown as Electron.WebContents,
        }),
      )
    }
    await waitFor(() => {
      const done = new Set(sent.filter((e) => e.phase === 'done').map((e) => e.documentId))
      return created.every((d) => done.has(d.id))
    }, 20_000)
    const repo = auth.requireDatabase().documents()
    for (const d of created) {
      expect((await repo.getDocument(d.id))?.status).toBe('ready')
    }
  }, 30_000)

  // Cold-boot orphan sweep: docs left 'indexing'/'pending' by a crashed session
  // get flipped to 'failed'; 'ready' docs are untouched.
  it('sweepOrphanedIndexing flips stuck pending/indexing docs to failed', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const repo = auth.requireDatabase().documents()
    const base = {
      workspaceId: ws.id,
      mimeType: 'text/markdown',
      byteSize: 1,
      sourceMtime: 1,
    }
    const stuckIndexing = await repo.addDocument({
      ...base,
      title: 'a',
      sourcePath: join(dir, 'a.md'),
      contentHash: 'h1',
    })
    const stuckPending = await repo.addDocument({
      ...base,
      title: 'b',
      sourcePath: join(dir, 'b.md'),
      contentHash: 'h2',
    })
    const ready = await repo.addDocument({
      ...base,
      title: 'c',
      sourcePath: join(dir, 'c.md'),
      contentHash: 'h3',
    })
    await repo.setDocumentStatus(stuckIndexing.id, 'indexing')
    // stuckPending keeps the addDocument default ('pending')
    await repo.setDocumentStatus(ready.id, 'ready')

    const reset = await new DocumentService(auth).sweepOrphanedIndexing()
    expect(reset).toBe(2)
    expect((await repo.getDocument(stuckIndexing.id))?.status).toBe('failed')
    expect((await repo.getDocument(stuckPending.id))?.status).toBe('failed')
    expect((await repo.getDocument(ready.id))?.status).toBe('ready')
  })

  // Cancellation drops still-queued imports (placeholder rows are deleted) and
  // leaves a consistent library: surviving docs = N − cancelled, none stuck.
  it('cancelWorkspaceIndexing removes queued imports and settles cleanly', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const docs = new DocumentService(auth)
    const N = 12
    for (let i = 0; i < N; i++) {
      const path = join(dir, `cancel-${i}.md`)
      await writeFile(path, `# C ${i}\n\nBody ${i}.`, 'utf-8')
      await docs.importFile({ workspaceId: ws.id, sourcePath: path })
    }
    const cancelled = await docs.cancelWorkspaceIndexing(ws.id)
    expect(cancelled).toBeGreaterThanOrEqual(0)
    expect(cancelled).toBeLessThanOrEqual(N)

    // Let any in-flight (non-cancelled) jobs settle, then assert the invariant.
    await new Promise((r) => setTimeout(r, 2000))
    const repo = auth.requireDatabase().documents()
    const all = await repo.listDocumentsByWorkspace(ws.id)
    expect(all.length).toBe(N - cancelled)
    for (const d of all) expect(['ready', 'failed']).toContain(d.status)
  }, 30_000)

  // Probe against the actual problem doc from the user's bug report. Skipped
  // when the file isn't present (CI, other machines) ; runs locally where the
  // PDF lives at C:\Users\denys\Documents\Test\... to confirm the fix holds on
  // the exact file that triggered the original error.
  const REAL_PDF =
    'C:/Users/denys/Documents/Test/_OceanofPDF.com_Thinking_Fast_and_Slow_By_Daniel_Kahneman_-_Thinking_Fast_and_Slow_By_Daniel_Kahneman.pdf'
  const realPdfAvailable = existsSync(REAL_PDF)
  ;(realPdfAvailable ? it : it.skip)(
    'reindex round-trips the Thinking_Fast_and_Slow PDF (user repro)',
    async () => {
      const ws = await new WorkspaceService(auth).create('WS')

      const sent: IndexProgress[] = []
      const fakeSender = { send: (_ch: string, payload: IndexProgress) => sent.push(payload) }
      const docs = new DocumentService(auth)
      const doc = await docs.importFile({
        workspaceId: ws.id,
        sourcePath: REAL_PDF,
        sender: fakeSender as unknown as Electron.WebContents,
      })
      // Bigger PDF , wider budget. Parsing+chunking dominates ; embedder is
      // optional (DocumentService is built here without a registry).
      await waitFor(
        () =>
          sent.some((e) => e.documentId === doc.id && (e.phase === 'done' || e.phase === 'failed')),
        120_000,
      )
      const importFailure = sent.find((e) => e.phase === 'failed')
      if (importFailure) {
        console.error('[import-failed]', importFailure)
      }
      expect(sent.at(-1)?.phase).toBe('done')

      sent.length = 0
      const refreshed = await docs.reindex(doc.id, fakeSender as unknown as Electron.WebContents)
      expect(refreshed.id).toBe(doc.id)
      await waitFor(
        () =>
          sent.some((e) => e.documentId === doc.id && (e.phase === 'done' || e.phase === 'failed')),
        120_000,
      )
      expect(sent.at(-1)?.phase).toBe('done')

      const repo = auth.requireDatabase().documents()
      const after = await repo.getDocument(doc.id)
      expect(after?.status).toBe('ready')
      expect(after?.chunkCount).toBeGreaterThan(0)

      // And the guard fires loud on a third would-be import of the same path.
      await expect(
        docs.importFile({ workspaceId: ws.id, sourcePath: REAL_PDF }),
      ).rejects.toBeInstanceOf(ImportError)
    },
    300_000,
  )
})

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}

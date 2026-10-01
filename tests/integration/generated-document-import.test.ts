import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import { WorkspaceDb } from '@main/db/sqlite/WorkspaceDb'
import { WORKSPACE_SCHEMA_SQL } from '@main/db/sqlite/schema.sql'
import { DocumentService } from '@main/services/documents/DocumentService'
import { isGeneratedDocumentSource } from '@shared/documentSource'
import { deferred } from '../unit/fixtures/retrievalHarness'

vi.mock('@main/services/documents/languageDetector', () => ({
  detectChunkLanguages: async (texts: string[]) => texts.map(() => 'en'),
}))

describe('durable generated document sources', () => {
  let directory: string
  let path: string
  let key: string
  let db: WorkspaceDb
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'loklm-generated-'))
    path = join(directory, 'meta.db')
    key = randomBytes(32).toString('hex')
    db = await WorkspaceDb.open(path, key, 3)
  })
  afterEach(async () => {
    db?.close()
    await rm(directory, { recursive: true, force: true })
  })

  function fixture(registry?: unknown) {
    const repo = {
      addDocument: (input: Parameters<WorkspaceDb['addDocument']>[0]) => db.addDocument(input),
      getDocument: (id: number) => db.getDocument(id),
      getGeneratedText: (id: number) => db.getGeneratedText(id),
      setDocumentStatus: (id: number, status: string) => db.setDocumentStatus(id, status),
      persistChunks: (id: number, chunks: Parameters<WorkspaceDb['persistChunks']>[1]) =>
        db.persistChunks(id, chunks),
      reindexDocument: (id: number) => db.reindexDocument(id),
      deleteDocument: (id: number) => db.deleteDocument(id),
      setChunkEmbeddingsBatch: (rows: Array<{ id: number }>, identity: string) =>
        db.markChunksEmbedded(
          rows.map((row) => row.id),
          identity,
        ),
    }
    const auth = {
      isUnlocked: () => true,
      requireDatabase: () => ({ documents: () => repo, documentsFor: async () => repo }),
    }
    const worker = { parseAndChunk: vi.fn(), registerOcrProgress: vi.fn() }
    const service = new DocumentService(auth as never, registry as never, worker as never)
    return { service, worker }
  }

  it('stores the exact source before returning and indexes without a plaintext file', async () => {
    const { service, worker } = fixture()
    const text = '# Übersetzung\r\n\r\nPrivate fixture phrase: Neral 42\r\n'
    const doc = await service.importGeneratedText({
      workspaceId: 3,
      title: 'Translation',
      text,
      mimeType: 'text/markdown',
    })
    expect(isGeneratedDocumentSource(doc.sourcePath)).toBe(true)
    expect(doc.sourcePath.endsWith('.md')).toBe(true)
    expect(await db.getGeneratedText(doc.id)).toBe(text)
    expect(doc.byteSize).toBe(Buffer.byteLength(text, 'utf8'))
    await vi.waitFor(() => expect(service.isIndexing()).toBe(false))
    expect((await db.getDocument(doc.id))?.status).toBe('ready')
    expect((await db.listChunksForDocument(doc.id))[0]?.text).toContain('Neral 42')
    expect(worker.parseAndChunk).not.toHaveBeenCalled()
    expect(await service.refreshDocument(doc.id)).toBe('unchanged')
    expect((await db.getDocument(doc.id))?.missingAt).toBeNull()
    expect((await readdir(directory)).every((name) => name.startsWith('meta.db'))).toBe(true)
    expect((await readFile(path)).includes(Buffer.from('Private fixture phrase'))).toBe(false)
  })

  it('keeps the only source after cancellation and can reindex after reopening the workspace', async () => {
    const prepared = deferred<{ update: () => void; release: () => void }>()
    const lease = { update: vi.fn(), release: vi.fn() }
    const embedder = { beginIndexing: () => prepared.promise }
    const { service } = fixture({ embedder: () => embedder })
    const text = 'Durable transcript: calibrated parcel 17.'
    const doc = await service.importGeneratedText({
      workspaceId: 3,
      title: 'Transcript',
      text,
      mimeType: 'text/plain',
    })
    expect(await db.getGeneratedText(doc.id)).toBe(text)
    expect(await service.cancelWorkspaceIndexing(3)).toBe(1)
    prepared.resolve(lease)
    await vi.waitFor(() => expect(service.isIndexing()).toBe(false))
    expect((await db.getDocument(doc.id))?.status).toBe('failed')
    expect(lease.release).toHaveBeenCalledOnce()
    db.close()
    db = await WorkspaceDb.open(path, key, 3)
    const reopened = fixture().service
    await reopened.reindex(doc.id)
    await vi.waitFor(() => expect(reopened.isIndexing()).toBe(false))
    expect((await db.getDocument(doc.id))?.status).toBe('ready')
    expect(await db.getGeneratedText(doc.id)).toBe(text)
    expect((await db.listChunksForDocument(doc.id))[0]?.text).toBe(text)
  })

  it('preserves queued generated documents when all indexing is canceled before their turn', async () => {
    const prepared = deferred<{ update: () => void; release: () => void }>()
    const lease = { update: vi.fn(), release: vi.fn() }
    const { service } = fixture({ embedder: () => ({ beginIndexing: () => prepared.promise }) })
    const docs = []
    for (let index = 0; index < 3; index++)
      docs.push(
        await service.importGeneratedText({
          workspaceId: 3,
          title: `Transcript ${index}`,
          text: `Stored source ${index}`,
          mimeType: 'text/plain',
        }),
      )
    expect(await service.cancelAllIndexing(true)).toBe(3)
    prepared.resolve(lease)
    await vi.waitFor(() => expect(service.isIndexing()).toBe(false))
    for (const [index, doc] of docs.entries()) {
      expect((await db.getDocument(doc.id))?.status).toBe('failed')
      expect(await db.getGeneratedText(doc.id)).toBe(`Stored source ${index}`)
    }
  })

  it('adds the generated source column to an older encrypted workspace without rewriting its documents', async () => {
    db.close()
    const legacyPath = join(directory, 'legacy.db')
    const legacy = new Database(legacyPath)
    legacy.pragma("cipher='sqlcipher'")
    legacy.pragma(`key="x'${key}'"`)
    legacy.exec(WORKSPACE_SCHEMA_SQL.replace('  generated_text            TEXT,\n', ''))
    legacy
      .prepare("INSERT INTO documents(title, source_path) VALUES ('Prior source', '/prior.txt')")
      .run()
    legacy.close()
    db = await WorkspaceDb.open(legacyPath, key, 3)
    expect((await db.getDocument(1))?.title).toBe('Prior source')
    expect(await db.getGeneratedText(1)).toBeNull()
    const added = await db.addDocument({
      title: 'Generated',
      sourcePath: 'loklm-generated:test.txt',
      generatedText: 'Durable source',
    })
    expect(await db.getGeneratedText(added.id)).toBe('Durable source')
    db.close()
    db = await WorkspaceDb.open(legacyPath, key, 3)
    expect(await db.getGeneratedText(added.id)).toBe('Durable source')
  })
})

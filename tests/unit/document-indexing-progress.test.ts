import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DocumentService } from '@main/services/documents/DocumentService'
import { EmbeddingBackfillService } from '@main/services/embeddings/EmbeddingBackfillService'
import type { IndexProgress } from '@main/services/documents/types'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loklm-index-test-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function fixture(contextPrefix?: string) {
  const sourcePath = join(dir, 'test.txt')
  await writeFile(sourcePath, 'A test document.')
  const doc = { id: 1, workspaceId: 7, sourcePath, title: 'Test', status: 'pending' }
  const chunks = Array.from({ length: 9 }, (_, ordinal) => ({
    text: `passage ${ordinal}`,
    ordinal,
    pageFrom: 1,
    pageTo: 1,
    headingPath: null,
    language: null,
    contextPrefix: ordinal === 0 ? contextPrefix : undefined,
  }))
  const repo = {
    findByWorkspaceAndPath: vi.fn().mockResolvedValue(null),
    addDocument: vi.fn().mockResolvedValue(doc),
    setDocumentStatus: vi.fn().mockResolvedValue(undefined),
    persistChunks: vi.fn().mockResolvedValue(chunks.map((c) => c.ordinal + 1)),
    setChunkEmbeddingsBatch: vi.fn().mockResolvedValue(undefined),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
  }
  const auth = {
    isUnlocked: () => true,
    requireDatabase: () => ({ documents: () => repo, documentsFor: async () => repo }),
  }
  const lease = { update: vi.fn(), release: vi.fn() }
  const embedder = {
    beginIndexing: vi.fn(async () => lease),
    ensureReady: async () => {},
    isReady: () => true,
    preferredBatchSize: () => 4,
    identity: () => 'bundled:test',
    embed: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([1, 2]))),
  }
  const worker = { parseAndChunk: async () => ({ chunks }), registerOcrProgress: () => () => {} }
  const service = new DocumentService(
    auth as never,
    { embedder: () => embedder } as never,
    worker as never,
  )
  const events: IndexProgress[] = []
  const input = {
    workspaceId: 7,
    sourcePath,
    sender: { send: (_channel: string, p: IndexProgress) => events.push(p) },
  }
  return { service, repo, embedder, events, input, lease }
}

describe('document indexing responsiveness', () => {
  it('backfills a failed passage with the exact fresh-import input and keeps citations unprefixed', async () => {
    const prefix = 'src/readPDF.ts read PDF'
    const { service, repo, embedder, input } = await fixture(prefix)
    embedder.embed.mockRejectedValueOnce(new Error('temporary embedding failure'))
    await service.importFile(input)
    await vi.waitFor(() => expect(service.isIndexing()).toBe(false))
    const persisted = repo.persistChunks.mock.calls[0]![1] as Array<{
      text: string
      contextPrefix: string | null
    }>
    expect(persisted[0]).toMatchObject({ text: 'passage 0', contextPrefix: prefix })
    expect(embedder.embed.mock.calls[0]?.[0]).toEqual([`${prefix}\npassage 0`])
    let pending = [
      {
        id: 1,
        document_id: 1,
        text: persisted[0]!.text,
        context_prefix: persisted[0]!.contextPrefix,
      },
    ]
    const backfillRepo = {
      countChunksMissingEmbedding: async () => pending.length,
      listChunksMissingEmbedding: async () => pending,
      listDocsMissingSummaryEmbedding: async () => [],
      distinctEmbedderIdentities: async () => [],
      distinctSummaryEmbedderIdentities: async () => [],
      setChunkEmbeddingsBatch: async () => {
        pending = []
      },
      ensureVectorIndex: async () => {},
    }
    const backfill = new EmbeddingBackfillService(
      { documentsFor: async () => backfillRepo } as never,
      { embedder: () => embedder } as never,
    )
    await backfill.run(7)
    expect(backfill.status(7)).toMatchObject({ state: 'done', done: 1 })
    expect(embedder.embed.mock.calls.at(-1)?.[0]).toEqual(embedder.embed.mock.calls[0]?.[0])
  })

  it('reports the first chunk promptly, then uses bounded batches and persists all vectors', async () => {
    const { service, repo, embedder, events, input, lease } = await fixture()
    await service.importFile(input)
    await vi.waitFor(() => expect(service.isIndexing()).toBe(false))
    expect(embedder.embed.mock.calls.map(([texts]) => texts.length)).toEqual([1, 4, 4])
    expect(events.filter((p) => p.phase === 'embedding').map((p) => p.chunksDone)).toEqual([
      0, 1, 5, 9,
    ])
    expect(events.at(-1)?.phase).toBe('done')
    expect(repo.setChunkEmbeddingsBatch.mock.calls[0]![0]).toHaveLength(9)
    expect(lease.release).toHaveBeenCalledOnce()
    expect(lease.update).toHaveBeenCalledWith(9, 9)
  })
  it('stops an active import after its current batch and does not start the remaining chunks', async () => {
    const { service, repo, embedder, events, input, lease } = await fixture()
    let finish!: (vectors: Float32Array<ArrayBuffer>[]) => void
    embedder.embed.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await service.importFile(input)
    await vi.waitFor(() => expect(embedder.embed).toHaveBeenCalledOnce())
    expect(await service.cancelWorkspaceIndexing(7)).toBe(1)
    finish([new Float32Array([1, 2])])
    await vi.waitFor(() => expect(service.isIndexing()).toBe(false))
    expect(embedder.embed).toHaveBeenCalledOnce()
    expect(repo.persistChunks).not.toHaveBeenCalled()
    expect(repo.deleteDocument).toHaveBeenCalledWith(1)
    expect(events.at(-1)).toMatchObject({ phase: 'failed', error: 'Indexing cancelled.' })
    expect(lease.release).toHaveBeenCalledOnce()
  })
  it('cancels only the selected workspace when documents share the same local id', async () => {
    const { service, repo, embedder, events, input } = await fixture()
    const finishes: Array<(vectors: Float32Array<ArrayBuffer>[]) => void> = []
    const paused = () =>
      new Promise<Float32Array<ArrayBuffer>[]>((resolve) => finishes.push(resolve))
    embedder.embed.mockImplementationOnce(paused).mockImplementationOnce(paused)
    await service.importFile(input)
    repo.addDocument.mockResolvedValueOnce({
      id: 1,
      workspaceId: 8,
      sourcePath: input.sourcePath,
      title: 'Other',
      status: 'pending',
    })
    await service.importFile({ ...input, workspaceId: 8 })
    await vi.waitFor(() => expect(finishes).toHaveLength(2))
    expect(await service.cancelWorkspaceIndexing(7)).toBe(1)
    for (const finish of finishes) finish([new Float32Array([1, 2])])
    await vi.waitFor(() => expect(service.isIndexing()).toBe(false))
    expect(events).toContainEqual(expect.objectContaining({ title: 'Test', phase: 'failed' }))
    expect(events).toContainEqual(expect.objectContaining({ title: 'Other', phase: 'done' }))
    expect(repo.persistChunks).toHaveBeenCalledOnce()
  })
})

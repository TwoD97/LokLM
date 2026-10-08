import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DocumentService } from '@main/services/documents/DocumentService'
import { EmbeddingService } from '@main/services/embeddings/EmbeddingService'
import { GpuWorkCoordinator } from '@main/services/workers/GpuWorkCoordinator'

let directory: string
let cleanup: Array<() => void>
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'loklm-index-gpu-lease-'))
  cleanup = []
})
afterEach(async () => {
  for (const close of cleanup) close()
  await vi.advanceTimersByTimeAsync(0)
  vi.clearAllTimers()
  vi.useRealTimers()
  await rm(directory, { recursive: true, force: true })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function fixture(chunkCount = 5) {
  const sourcePath = join(directory, 'synthetic.txt')
  await writeFile(sourcePath, 'Synthetic indexing scheduler fixture.')
  vi.useFakeTimers()
  const restore = vi.fn(async () => {})
  const coordinator = new GpuWorkCoordinator(restore, vi.fn(), () => false)
  const release = vi.fn()
  const acquire = vi.fn((job: { workspaceId: number; title: string }) => {
    const lease = coordinator.acquire(job)
    return {
      update: lease.update,
      release: () => {
        release()
        lease.release()
      },
    }
  })
  const embedding = new EmbeddingService({
    client: { setStatusListener: vi.fn(), beginIndexing: acquire } as never,
  })
  const ready = vi.spyOn(embedding, 'ensureReady').mockResolvedValue(true)
  const chunks = Array.from({ length: chunkCount }, (_, ordinal) => ({
    text: `Synthetic passage ${ordinal}`,
    ordinal,
    pageFrom: 1,
    pageTo: 1,
    headingPath: null,
    language: null,
  }))
  const parse = deferred<{ chunks: typeof chunks }>()
  const parser = vi.fn(() => parse.promise)
  const embed = vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([1, 0])))
  const provider = {
    beginIndexing: embedding.beginIndexing.bind(embedding),
    ensureReady: vi.fn(async () => {}),
    isReady: () => true,
    preferredBatchSize: () => 4,
    identity: () => 'synthetic-gpu',
    embed,
  }
  const document = { id: 1, workspaceId: 7, sourcePath, title: 'Synthetic', status: 'pending' }
  const repo = {
    findByWorkspaceAndPath: vi.fn(async () => null),
    addDocument: vi.fn(async () => document),
    setDocumentStatus: vi.fn(async () => {}),
    persistChunks: vi.fn(async () => chunks.map((chunk) => chunk.ordinal + 1)),
    setChunkEmbeddingsBatch: vi.fn(async () => {}),
    deleteDocument: vi.fn(async () => {}),
  }
  const auth = {
    isUnlocked: () => true,
    requireDatabase: () => ({ documents: () => repo, documentsFor: async () => repo }),
  }
  const service = new DocumentService(
    auth as never,
    { embedder: () => provider } as never,
    { parseAndChunk: parser, registerOcrProgress: () => () => {} } as never,
  )
  cleanup.push(() => {
    service.invalidateSession()
    parse.resolve({ chunks })
    coordinator.reset(undefined, true)
  })
  await service.importFile({ workspaceId: 7, sourcePath })
  await vi.waitFor(() => expect(parser).toHaveBeenCalledOnce())
  return {
    service,
    coordinator,
    restore,
    release,
    acquire,
    ready,
    chunks,
    parse,
    parser,
    embed,
    provider,
    repo,
    sourcePath,
    document,
  }
}

describe('GPU lease starts when parsed chunks need embedding', () => {
  it('allows chat during parsing, then protects all embedding batches and vector persistence', async () => {
    const f = await fixture()
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.ready).not.toHaveBeenCalled()
    await f.coordinator.waitForChat()
    const first = deferred<Float32Array<ArrayBuffer>[]>()
    const persisted = deferred<void>()
    cleanup.push(() => {
      first.resolve([])
      persisted.resolve()
    })
    f.embed.mockImplementationOnce(() => first.promise)
    f.repo.setChunkEmbeddingsBatch.mockImplementationOnce(() => persisted.promise)
    f.parse.resolve({ chunks: f.chunks })
    await vi.waitFor(() => expect(f.embed).toHaveBeenCalledOnce())
    expect(f.acquire).toHaveBeenCalledOnce()
    const chat = vi.fn()
    const waiting = f.coordinator.waitForChat().then(chat)
    await vi.advanceTimersByTimeAsync(1000)
    expect(chat).not.toHaveBeenCalled()
    first.resolve([new Float32Array([1, 0])])
    await vi.waitFor(() => expect(f.repo.setChunkEmbeddingsBatch).toHaveBeenCalledOnce())
    expect(f.repo.setChunkEmbeddingsBatch).toHaveBeenCalledWith(
      Array.from({ length: 5 }, (_, index) => ({
        id: index + 1,
        vector: new Float32Array([1, 0]),
      })),
      'synthetic-gpu',
    )
    expect(f.embed.mock.calls.map(([texts]) => texts.length)).toEqual([1, 4])
    expect(f.release).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
    persisted.resolve()
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(f.release).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(250)
    await waiting
    expect(chat).toHaveBeenCalledOnce()
    expect(f.restore).not.toHaveBeenCalled()
  })

  it('does not acquire or warm an embedder when parsing fails', async () => {
    const f = await fixture()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      f.parse.reject(new Error('Synthetic parser failure'))
      await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
      expect(f.acquire).not.toHaveBeenCalled()
      expect(f.ready).not.toHaveBeenCalled()
      expect(f.embed).not.toHaveBeenCalled()
      expect(f.release).not.toHaveBeenCalled()
      expect(f.repo.setDocumentStatus).toHaveBeenCalledWith(1, 'failed')
      expect(f.coordinator.status().phase).toBe('idle')
    } finally {
      log.mockRestore()
    }
  })

  it('persists an empty parsed document without reserving or warming the GPU', async () => {
    const f = await fixture(0)
    f.parse.resolve({ chunks: [] })
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.ready).not.toHaveBeenCalled()
    expect(f.provider.ensureReady).not.toHaveBeenCalled()
    expect(f.embed).not.toHaveBeenCalled()
    expect(f.repo.persistChunks).toHaveBeenCalledWith(1, [])
    expect(f.repo.setDocumentStatus).toHaveBeenCalledWith(1, 'ready')
  })

  it('cancels during parsing without acquiring a later GPU lease', async () => {
    const f = await fixture()
    expect(await f.service.cancelWorkspaceIndexing(7)).toBe(1)
    await f.coordinator.waitForChat()
    f.parse.resolve({ chunks: f.chunks })
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.ready).not.toHaveBeenCalled()
    expect(f.embed).not.toHaveBeenCalled()
    expect(f.repo.persistChunks).not.toHaveBeenCalled()
    expect(f.repo.deleteDocument).toHaveBeenCalledWith(1)
  })

  it('releases exactly once when cancellation happens while embedding readiness is awaited', async () => {
    const f = await fixture()
    const loading = deferred<boolean>()
    cleanup.push(() => loading.resolve(true))
    f.ready.mockImplementationOnce(() => loading.promise)
    f.parse.resolve({ chunks: f.chunks })
    await vi.waitFor(() => expect(f.acquire).toHaveBeenCalledOnce())
    expect(await f.service.cancelWorkspaceIndexing(7)).toBe(1)
    expect(f.release).not.toHaveBeenCalled()
    loading.resolve(true)
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(f.release).toHaveBeenCalledOnce()
    expect(f.embed).not.toHaveBeenCalled()
    expect(f.provider.ensureReady).not.toHaveBeenCalled()
    expect(f.repo.deleteDocument).toHaveBeenCalledWith(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(f.coordinator.status().phase).toBe('idle')
  })

  it('releases the internally acquired lease if embedding readiness fails', async () => {
    const f = await fixture()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      f.ready.mockRejectedValueOnce(new Error('Synthetic GPU unavailable'))
      f.parse.resolve({ chunks: f.chunks })
      await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
      expect(f.acquire).toHaveBeenCalledOnce()
      expect(f.release).toHaveBeenCalledOnce()
      expect(f.embed).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(250)
      expect(f.coordinator.status().phase).toBe('idle')
    } finally {
      log.mockRestore()
    }
  })

  it('releases after batch failures persist chunks for backfill', async () => {
    const f = await fixture()
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      f.embed.mockRejectedValue(new Error('Synthetic embedding failure'))
      f.parse.resolve({ chunks: f.chunks })
      await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
      expect(f.embed).toHaveBeenCalledTimes(2)
      expect(f.repo.persistChunks).toHaveBeenCalledOnce()
      expect(f.repo.setChunkEmbeddingsBatch).not.toHaveBeenCalled()
      expect(f.release).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(250)
      expect(f.coordinator.status().phase).toBe('idle')
    } finally {
      log.mockRestore()
    }
  })

  it('does not eagerly restore chat between a finished document and a later parse on a small GPU', async () => {
    const f = await fixture(1)
    const secondParse = deferred<{ chunks: typeof f.chunks }>()
    const secondBatch = deferred<Float32Array<ArrayBuffer>[]>()
    cleanup.push(() => {
      secondParse.resolve({ chunks: [] })
      secondBatch.resolve([])
    })
    f.parser.mockImplementationOnce(() => secondParse.promise)
    f.repo.addDocument.mockResolvedValueOnce({ ...f.document, id: 2, workspaceId: 8 })
    await f.service.importFile({ workspaceId: 8, sourcePath: f.sourcePath })
    await vi.waitFor(() => expect(f.parser).toHaveBeenCalledTimes(2))
    expect(f.acquire).not.toHaveBeenCalled()
    f.parse.resolve({ chunks: f.chunks })
    await vi.waitFor(() => expect(f.release).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.service.isIndexing()).toBe(true)
    expect(f.coordinator.status().phase).toBe('idle')
    expect(f.restore).not.toHaveBeenCalled()
    expect(f.ready).toHaveBeenCalledOnce()
    await f.coordinator.waitForChat()
    f.embed.mockImplementationOnce(() => secondBatch.promise)
    secondParse.resolve({ chunks: f.chunks })
    await vi.waitFor(() => expect(f.acquire).toHaveBeenCalledTimes(2))
    const chat = vi.fn()
    const waiting = f.coordinator.waitForChat().then(chat)
    await vi.advanceTimersByTimeAsync(500)
    expect(chat).not.toHaveBeenCalled()
    secondBatch.resolve([new Float32Array([1, 0])])
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(f.release).toHaveBeenCalledTimes(2)
    expect(f.repo.persistChunks).toHaveBeenCalledTimes(2)
    expect(f.repo.setChunkEmbeddingsBatch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(250)
    await waiting
    expect(f.restore).not.toHaveBeenCalled()
  })
})

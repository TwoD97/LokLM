import { describe, expect, it, vi } from 'vitest'
import { EmbeddingBackfillService } from '@main/services/embeddings/EmbeddingBackfillService'
import { deferred } from './fixtures/retrievalHarness'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

function fixture(count = 2) {
  let rows = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    text: `chunk ${i}`,
    document_id: 1,
    context_prefix: null,
  }))
  const lease = { update: vi.fn(), release: vi.fn() }
  const embedder = {
    identity: () => 'bundled:test',
    ensureReady: vi.fn(async () => {}),
    isReady: () => true,
    preferredBatchSize: () => 4,
    beginIndexing: vi.fn(async () => lease),
    embed: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([1, 2]))),
  }
  const repo = {
    countChunksMissingEmbedding: async () => rows.length,
    listChunksMissingEmbedding: async () => [...rows],
    listDocsMissingSummaryEmbedding: async () => [],
    distinctEmbedderIdentities: async () => [],
    distinctSummaryEmbedderIdentities: async () => [],
    setChunkEmbeddingsBatch: vi.fn(async () => {
      rows = []
    }),
    ensureVectorIndex: async () => {},
  }
  const db = { documentsFor: vi.fn(async () => repo) }
  const service = new EmbeddingBackfillService(db as never, { embedder: () => embedder } as never)
  return { service, embedder, repo, db, lease }
}

describe('GPU backfill lifecycle', () => {
  it('does not load models or acquire the GPU for an already indexed workspace', async () => {
    const { service, embedder } = fixture(0)
    await service.run(3)
    expect(embedder.beginIndexing).not.toHaveBeenCalled()
    expect(embedder.ensureReady).not.toHaveBeenCalled()
    expect(service.status(3).state).toBe('done')
  })
  it('holds one lease across all batches and writes to the owning workspace', async () => {
    const { service, embedder, db, lease, repo } = fixture()
    await service.run(3)
    expect(embedder.beginIndexing).toHaveBeenCalledOnce()
    expect(db.documentsFor).toHaveBeenCalledWith(3)
    expect(repo.setChunkEmbeddingsBatch).toHaveBeenCalledOnce()
    expect(lease.release).toHaveBeenCalledOnce()
    expect(service.status(3)).toMatchObject({ state: 'done', done: 2 })
  })
  it('cancels while preparing the GPU without embedding or leaking its lease', async () => {
    const { service, embedder, lease } = fixture()
    let prepared!: () => void
    embedder.beginIndexing.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        prepared = resolve
      })
      return lease
    })
    const running = service.run(3)
    await vi.waitFor(() => expect(embedder.beginIndexing).toHaveBeenCalledOnce())
    service.cancelRunning()
    prepared()
    await running
    expect(embedder.embed).not.toHaveBeenCalled()
    expect(lease.release).toHaveBeenCalledOnce()
    expect(service.isAnyRunning()).toBe(false)
  })
  it('releases GPU ownership after a storage error', async () => {
    const { service, repo, lease } = fixture()
    repo.setChunkEmbeddingsBatch.mockRejectedValue(new Error('storage unavailable'))
    await service.run(3)
    expect(service.status(3).state).toBe('failed')
    expect(lease.release).toHaveBeenCalledOnce()
  })

  it('discards late native results and suppresses progress after session invalidation', async () => {
    const { service, embedder, repo, lease } = fixture(1)
    const pending = deferred<Float32Array<ArrayBuffer>[]>()
    const listener = vi.fn()
    service.subscribe(listener)
    embedder.embed.mockReturnValueOnce(pending.promise)
    const run = service.run(3)
    await vi.waitFor(() => expect(embedder.embed).toHaveBeenCalledOnce())
    service.invalidateSession()
    const events = listener.mock.calls.length
    const leaseProgress = lease.update.mock.calls.length
    pending.resolve([new Float32Array([1, 2])])
    await run
    expect(repo.setChunkEmbeddingsBatch).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledTimes(events)
    expect(lease.update).toHaveBeenCalledTimes(leaseProgress)
    expect(lease.release).toHaveBeenCalledOnce()
    expect(service.isAnyRunning()).toBe(false)
    await service.run(3)
    expect(embedder.embed).toHaveBeenCalledOnce()
  })
  it('stops when storage reports success but the same chunk remains unembedded', async () => {
    const { service, embedder, repo, lease } = fixture(1)
    repo.setChunkEmbeddingsBatch.mockImplementation(async () => {})
    // Bound the old buggy loop too, so a failing regression cannot spin forever.
    let calls = 0
    embedder.embed.mockImplementation(async () => {
      if (++calls > 3) service.cancelWorkspace(3)
      return [new Float32Array([1, 2])]
    })
    await service.run(3)
    expect(service.status(3)).toMatchObject({
      state: 'failed',
      done: 0,
      message: expect.stringContaining('still pending'),
    })
    expect(embedder.embed).toHaveBeenCalledOnce()
    expect(repo.setChunkEmbeddingsBatch).toHaveBeenCalledOnce()
    expect(lease.release).toHaveBeenCalledOnce()
  })
  it.each(
    [[], [new Float32Array()], [new Float32Array([NaN, 1])], [new Float32Array([0, 0])]].map(
      (vectors) => ({ vectors }),
    ),
  )(
    'does not mark invalid vectors embedded or report a successful backfill: %j',
    async ({ vectors }) => {
      const { service, embedder, repo, lease } = fixture(1)
      embedder.embed.mockResolvedValue(vectors)
      await service.run(3)
      expect(service.status(3)).toMatchObject({ state: 'failed', done: 0 })
      expect(repo.setChunkEmbeddingsBatch).not.toHaveBeenCalled()
      expect(embedder.embed).toHaveBeenCalledTimes(2)
      expect(lease.release).toHaveBeenCalledOnce()
    },
  )
})

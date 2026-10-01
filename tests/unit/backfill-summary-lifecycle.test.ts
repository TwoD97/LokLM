import { describe, expect, it, vi } from 'vitest'
import { EmbeddingBackfillService } from '@main/services/embeddings/EmbeddingBackfillService'
import { deferred } from './fixtures/retrievalHarness'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

function fixture() {
  let summaries = [
    { id: 1, summary: 'Original summary' },
    { id: 2, summary: 'Second summary' },
  ]
  const lease = { update: vi.fn(), release: vi.fn() }
  const embedder = {
    identity: () => 'fixture',
    ensureReady: async () => {},
    isReady: () => true,
    preferredBatchSize: () => 1,
    beginIndexing: async () => lease,
    embed: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([1, 0]))),
  }
  const repo = {
    countChunksMissingEmbedding: async () => 0,
    listChunksMissingEmbedding: async () => [],
    listDocsMissingSummaryEmbedding: async (_workspace: number, limit: number) =>
      summaries.slice(0, limit).map((row) => ({ ...row })),
    distinctEmbedderIdentities: async () => [],
    distinctSummaryEmbedderIdentities: async () => [],
    ensureVectorIndex: async () => {},
    setSummaryEmbedding: vi.fn(
      async (id: number, _vector: number[], _identity: string, expectedSummary: string) => {
        const match = summaries.some((row) => row.id === id && row.summary === expectedSummary)
        if (match) summaries = summaries.filter((row) => row.id !== id)
        return match
      },
    ),
  }
  const service = new EmbeddingBackfillService(
    { documentsFor: async () => repo } as never,
    { embedder: () => embedder } as never,
  )
  return {
    service,
    embedder,
    lease,
    repo,
    replaceFirstSummary: () => {
      summaries[0]!.summary = 'Replacement summary'
    },
  }
}

describe('summary embedding backfill lifecycle', () => {
  it('counts summaries in final progress and guards each write with the text embedded', async () => {
    const f = fixture()
    await f.service.run(3)
    expect(f.service.status(3)).toMatchObject({ state: 'done', done: 2, total: 2 })
    expect(f.repo.setSummaryEmbedding).toHaveBeenNthCalledWith(
      1,
      1,
      [1, 0],
      'fixture',
      'Original summary',
    )
  })

  it('retries a replacement summary instead of attaching the old vector to it', async () => {
    const f = fixture()
    const model = deferred<Float32Array<ArrayBuffer>[]>()
    f.embedder.embed.mockReturnValueOnce(model.promise)
    const running = f.service.run(3)
    await vi.waitFor(() => expect(f.embedder.embed).toHaveBeenCalledOnce())
    f.replaceFirstSummary()
    model.resolve([new Float32Array([1, 0])])
    await running
    expect(f.embedder.embed.mock.calls).toEqual([
      [['Original summary']],
      [['Replacement summary']],
      [['Second summary']],
    ])
    expect(f.service.status(3)).toMatchObject({ state: 'done', done: 2 })
  })

  it('reports a stop at the summary batch boundary as idle, not backfill complete', async () => {
    const f = fixture()
    const model = deferred<Float32Array<ArrayBuffer>[]>()
    f.embedder.embed.mockReturnValueOnce(model.promise)
    const running = f.service.run(3)
    await vi.waitFor(() => expect(f.embedder.embed).toHaveBeenCalledOnce())
    f.service.cancelWorkspace(3)
    model.resolve([new Float32Array([1, 0])])
    await running
    expect(f.service.status(3)).toMatchObject({ state: 'idle', done: 1 })
    expect(f.embedder.embed).toHaveBeenCalledOnce()
    expect(f.lease.release).toHaveBeenCalledOnce()
  })

  it('does not repeatedly embed a summary after a successful no-op storage write', async () => {
    const f = fixture()
    f.repo.setSummaryEmbedding.mockResolvedValue(true)
    let calls = 0
    f.embedder.embed.mockImplementation(async () => {
      if (++calls > 3) f.service.cancelWorkspace(3)
      return [new Float32Array([1, 0])]
    })
    await f.service.run(3)
    expect(f.service.status(3)).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('no progress'),
    })
    expect(f.embedder.embed).toHaveBeenCalledOnce()
    expect(f.lease.release).toHaveBeenCalledOnce()
  })

  it('does not save a summary vector or publish progress from a retired session', async () => {
    const f = fixture()
    const pending = deferred<Float32Array<ArrayBuffer>[]>()
    f.embedder.embed.mockReturnValueOnce(pending.promise)
    const listener = vi.fn()
    f.service.subscribe(listener)
    const run = f.service.run(3)
    await vi.waitFor(() => expect(f.embedder.embed).toHaveBeenCalledOnce())
    f.service.invalidateSession()
    const eventCount = listener.mock.calls.length
    pending.resolve([new Float32Array([1, 0])])
    await run
    expect(f.repo.setSummaryEmbedding).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledTimes(eventCount)
    expect(f.lease.release).toHaveBeenCalledOnce()
    expect(f.service.isAnyRunning()).toBe(false)
  })
})

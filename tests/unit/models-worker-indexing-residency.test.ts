import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerPush, WorkerRequest } from '@main/services/workers/protocol'

const mocks = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork }, app: { once: vi.fn() } }))
import { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => vi.useRealTimers())

function fixture(initialVram: number | null, hasGpu = true) {
  let resources = initialVram == null ? null : { hasGpu, totalVramGB: initialVram }
  const operations: string[] = []
  const child = new EventEmitter() as EventEmitter & { postMessage(m: WorkerRequest): void }
  child.postMessage = (m) => {
    operations.push(m.op)
    const result =
      m.op === 'planner.refresh'
        ? resources
        : m.op === 'embedder.load'
          ? { resources }
          : { raw: 'answer' }
    queueMicrotask(() => child.emit('message', { id: m.id, ok: true, result }))
  }
  mocks.fork.mockImplementation(() => {
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
  return {
    client: new ModelsWorkerClient(),
    operations,
    push: (event: WorkerPush) => child.emit('message', event),
    setVram: (totalVramGB: number) => {
      resources = { hasGpu: true, totalVramGB }
    },
  }
}

const job = { workspaceId: 1, title: 'document' }
const ask = { streamId: 'answer', question: 'Question', prompt: 'Prompt', maxTokens: 10 }

describe('post-indexing model residency', () => {
  it.each([4.1, 6])('keeps the embedder resident on an actual %s GiB GPU', async (vram) => {
    const { client, operations } = fixture(vram)
    await client.refreshResources()
    const lease = client.beginIndexing(job)
    const pending = client.llmAsk(ask)
    lease.release()
    await vi.advanceTimersByTimeAsync(249)
    expect(operations).toEqual(['planner.refresh'])
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(operations).toEqual(['planner.refresh', 'llm.ask'])
    expect(client.activity().phase).toBe('idle')
  })

  it.each([8, 0, null, Number.NaN, Number.POSITIVE_INFINITY])(
    'retains eager restoration when VRAM is roomy or unknown (%s)',
    async (vram) => {
      const { client, operations } = fixture(vram)
      await client.refreshResources()
      client.beginIndexing(job).release()
      await vi.advanceTimersByTimeAsync(250)
      expect(operations).toEqual(['planner.refresh', 'gpu.restoreChat'])
    },
  )

  it('does not infer a working GPU from a VRAM value alone', async () => {
    const { client, operations } = fixture(4, false)
    await client.refreshResources()
    client.beginIndexing(job).release()
    await vi.advanceTimersByTimeAsync(250)
    expect(operations).toContain('gpu.restoreChat')
  })

  it('uses the most recent selected-device resources and explicit restoration remains available', async () => {
    const { client, operations, setVram } = fixture(8)
    await client.refreshResources()
    const lease = client.beginIndexing(job)
    setVram(4)
    await client.embedderLoad({
      modelPath: 'fixture.gguf',
      weightsBytes: 1,
      contextSize: 512,
      placement: 'gpu',
    })
    const explicit = client.restoreChat()
    lease.release()
    await vi.advanceTimersByTimeAsync(250)
    await explicit
    expect(operations).toEqual(['planner.refresh', 'embedder.load', 'gpu.restoreChat'])
  })

  it('observes hardware updates from lazy LLM load pushes', async () => {
    const { client, operations, push } = fixture(8)
    await client.refreshResources()
    push({
      ev: 'llm.loaded',
      result: { resources: { hasGpu: true, totalVramGB: 4 } },
    } as WorkerPush)
    client.beginIndexing(job).release()
    await vi.advanceTimersByTimeAsync(250)
    expect(operations).toEqual(['planner.refresh'])
  })

  it('delivers cancellation while a foreground request waits and adds no restore ahead of it', async () => {
    const { client, operations } = fixture(4)
    await client.refreshResources()
    const lease = client.beginIndexing(job)
    const pending = client.llmAsk(ask)
    await client.llmAbort(ask.streamId)
    expect(operations).toEqual(['planner.refresh', 'llm.abort'])
    lease.release()
    await vi.advanceTimersByTimeAsync(250)
    await pending
    // The real worker consumes this abort tombstone before ensureResident.
    expect(operations).toEqual(['planner.refresh', 'llm.abort', 'llm.ask'])
  })
})

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorkerRequest } from '@main/services/workers/protocol'

const mocks = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork }, app: { once: vi.fn() } }))
import { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

function fixture() {
  const operations: string[] = []
  let backgroundId: number | undefined
  const child = new EventEmitter() as EventEmitter & { postMessage(m: WorkerRequest): void }
  child.postMessage = (m) => {
    operations.push(m.op)
    if (m.op === 'llm.generateRaw' && m.payload.background) {
      backgroundId = m.id
      return
    }
    if (m.op === 'llm.abort' && backgroundId != null)
      child.emit('message', { id: backgroundId, ok: false, error: 'aborted' })
    queueMicrotask(() => child.emit('message', { id: m.id, ok: true, result: [] }))
  }
  mocks.fork.mockImplementation(() => {
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
  return { client: new ModelsWorkerClient(), operations }
}

it('interrupts a title before submitting query embeddings to the shared FIFO', async () => {
  const { client, operations } = fixture()
  const title = client.llmGenerateRaw({ streamId: 'title', prompt: 'Title', background: true })
  const rejected = expect(title).rejects.toThrow('aborted')
  await vi.waitFor(() => expect(operations).toEqual(['llm.generateRaw']))
  await client.embedderEmbed(['query'])
  await rejected
  expect(operations).toEqual(['llm.generateRaw', 'llm.abort', 'embedder.embed'])
})

it('interrupts a title when indexing acquires the GPU, before parsing or loading embeddings', async () => {
  vi.useFakeTimers()
  const { client, operations } = fixture()
  const title = client.llmGenerateRaw({ streamId: 'title', prompt: 'Title', background: true })
  const rejected = expect(title).rejects.toThrow('aborted')
  await vi.waitFor(() => expect(operations).toEqual(['llm.generateRaw']))
  const lease = client.beginIndexing({ workspaceId: 1, title: 'document' })
  await rejected
  expect(operations).toEqual(['llm.generateRaw', 'llm.abort'])
  await expect(
    client.llmGenerateRaw({ streamId: 'next', prompt: 'Title', background: true }),
  ).rejects.toThrow('busy')
  lease.release()
  await vi.advanceTimersByTimeAsync(250)
})

it('does not queue duplicate titles behind an existing generation', async () => {
  const { client, operations } = fixture()
  const title = client.llmGenerateRaw({ streamId: 'first', prompt: 'Title', background: true })
  const rejected = expect(title).rejects.toThrow('aborted')
  await expect(
    client.llmGenerateRaw({ streamId: 'second', prompt: 'Title', background: true }),
  ).rejects.toThrow('busy')
  await vi.waitFor(() => expect(operations).toEqual(['llm.generateRaw']))
  await client.llmGenerateRaw({ streamId: 'translation', prompt: 'Translate' })
  await rejected
  expect(operations).toEqual(['llm.generateRaw', 'llm.abort', 'llm.generateRaw'])
})

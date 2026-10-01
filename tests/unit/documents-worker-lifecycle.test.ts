import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocWorkerRequest } from '@main/services/workers/documentsProtocol'

const mocks = vi.hoisted(() => ({ fork: vi.fn(), once: vi.fn() }))
vi.mock('electron', () => ({
  utilityProcess: { fork: mocks.fork },
  app: { once: mocks.once, isPackaged: false, getAppPath: () => '/app' },
}))
import { DocumentsWorkerClient } from '@main/services/workers/DocumentsWorkerClient'

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

function childFixture(autoSpawn = true, autoExit = true) {
  const child = new EventEmitter() as EventEmitter & {
    postMessage(message: DocWorkerRequest): void
    kill(): boolean
  }
  const sent: DocWorkerRequest[] = []
  const respond = (message: DocWorkerRequest, result: unknown = { chunks: [] }) => {
    child.emit('message', { id: message.id, ok: true, result })
  }
  child.postMessage = (message) => {
    sent.push(message)
    if (message.op === 'shutdown')
      queueMicrotask(() => {
        respond(message)
        if (autoExit) child.emit('exit', 0)
      })
  }
  child.kill = vi.fn(() => {
    child.emit('exit', 0)
    return true
  })
  mocks.fork.mockImplementationOnce(() => {
    if (autoSpawn) queueMicrotask(() => child.emit('spawn'))
    return child
  })
  return { child, sent, respond }
}

const input = { sourcePath: '/private/document.pdf', documentId: 1 }

describe('document worker session lifecycle', () => {
  it('never forks while locked or after application shutdown before first use', async () => {
    const client = new DocumentsWorkerClient()
    await client.resetSession()
    await expect(client.parseAndChunk(input)).rejects.toThrow('session is closed')
    expect(mocks.fork).not.toHaveBeenCalled()
    client.resumeSession()
    await client.shutdown()
    await expect(client.parseAndChunk(input)).rejects.toThrow('shutting down')
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('owns and reaps a spawning worker without dispatching its retired source path', async () => {
    const { child, sent } = childFixture(false)
    const client = new DocumentsWorkerClient()
    const parsing = client.parseAndChunk(input)
    const rejected = expect(parsing).rejects.toThrow('session is closed')
    const reset = client.resetSession()
    expect(client.resetSession()).toBe(reset)
    child.emit('spawn')
    await Promise.all([reset, rejected])
    expect(sent.map((m) => m.op)).toEqual(['shutdown'])
    expect(child.kill).not.toHaveBeenCalled()
    await expect(client.parseAndChunk(input)).rejects.toThrow('session is closed')
  })

  it('handles quit during first spawn and registers only one quit hook after respawn', async () => {
    const first = childFixture(false)
    const client = new DocumentsWorkerClient()
    const parsing = client.parseAndChunk(input)
    const rejected = expect(parsing).rejects.toThrow('shutting down')
    expect(mocks.once).toHaveBeenCalledWith('before-quit', expect.any(Function))
    mocks.once.mock.calls[0]![1]()
    first.child.emit('spawn')
    await Promise.all([client.shutdown(), rejected])
    expect(first.sent.map((m) => m.op)).toEqual(['shutdown'])
    expect(() => client.resumeSession()).toThrow('cleanup is not complete')
  })

  it('routes overlapping workspace-local document IDs by parse request, not document ID', async () => {
    const { child, sent, respond } = childFixture()
    const client = new DocumentsWorkerClient()
    const progressA = vi.fn()
    const progressB = vi.fn()
    const a = client.parseAndChunk(input, progressA)
    const b = client.parseAndChunk({ ...input, sourcePath: '/other/document.pdf' }, progressB)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    child.emit('message', { ev: 'ocr', requestId: sent[0]!.id, done: 1, total: 3 })
    child.emit('message', { ev: 'ocr', requestId: sent[1]!.id, done: 4, total: 5 })
    expect(progressA.mock.calls).toEqual([[1, 3]])
    expect(progressB.mock.calls).toEqual([[4, 5]])
    respond(sent[0]!)
    await a
    child.emit('message', { ev: 'ocr', requestId: sent[0]!.id, done: 3, total: 3 })
    expect(progressA).toHaveBeenCalledOnce()
    respond(sent[1]!)
    await b
    await client.shutdown()
  })

  it('drops private parse results/progress while waiting for native shutdown to exit', async () => {
    const first = childFixture(true, false)
    const client = new DocumentsWorkerClient()
    const progress = vi.fn()
    const parsing = client.parseAndChunk(input, progress)
    const rejected = expect(parsing).rejects.toThrow('session is closed')
    await vi.waitFor(() => expect(first.sent).toHaveLength(1))
    const reset = client.resetSession()
    await rejected
    first.child.emit('message', { ev: 'ocr', requestId: first.sent[0]!.id, done: 1, total: 2 })
    first.respond(first.sent[0]!, { chunks: [{ text: 'private content' }] })
    expect(progress).not.toHaveBeenCalled()
    expect(() => client.resumeSession()).toThrow('cleanup is not complete')
    first.child.emit('exit', 0)
    await reset
    const second = childFixture()
    client.resumeSession()
    const fresh = client.parseAndChunk(input)
    await vi.waitFor(() => expect(second.sent).toHaveLength(1))
    second.respond(second.sent[0]!)
    await fresh
    expect(mocks.once).toHaveBeenCalledOnce()
    await client.shutdown()
  })

  it('rejects a completed parse result if lock races with its promise continuation', async () => {
    const { sent, respond } = childFixture()
    const client = new DocumentsWorkerClient()
    const parsing = client.parseAndChunk(input)
    const rejected = expect(parsing).rejects.toThrow('session is closed')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    respond(sent[0]!, { chunks: [{ text: 'late private source' }] })
    await client.resetSession()
    await rejected
  })

  it('bounds a hung OCR shutdown and keeps a failed termination closed across repeated lock hooks', async () => {
    vi.useFakeTimers()
    const fixture = childFixture(true, false)
    fixture.child.kill = vi.fn(() => false)
    const client = new DocumentsWorkerClient()
    const parsing = client.parseAndChunk(input)
    const rejectedParse = expect(parsing).rejects.toThrow('session is closed')
    await vi.advanceTimersByTimeAsync(0)
    const reset = client.resetSession()
    const rejectedReset = expect(reset).rejects.toThrow('did not exit')
    await rejectedParse
    await vi.advanceTimersByTimeAsync(3_000)
    await rejectedReset
    expect(fixture.child.kill).toHaveBeenCalledOnce()
    await expect(client.resetSession()).rejects.toThrow('did not exit')
    expect(() => client.resumeSession()).toThrow('cleanup is not complete')
    fixture.child.emit('exit', 0)
    await client.resetSession()
    client.resumeSession()
    await client.shutdown()
  })
})

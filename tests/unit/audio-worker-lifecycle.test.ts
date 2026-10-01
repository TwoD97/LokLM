import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ fork: vi.fn(), once: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork }, app: { once: mocks.once } }))
import { TranscriptionWorkerClient } from '@main/services/workers/TranscriptionWorkerClient'
import { DiarizationWorkerClient } from '@main/services/workers/DiarizationWorkerClient'

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

function childFixture(autoSpawn = true) {
  const child = new EventEmitter() as EventEmitter & {
    postMessage: ReturnType<typeof vi.fn>
    kill: ReturnType<typeof vi.fn>
  }
  child.postMessage = vi.fn()
  child.kill = vi.fn(() => {
    child.emit('exit', 0)
    return true
  })
  mocks.fork.mockImplementationOnce(() => {
    if (autoSpawn) queueMicrotask(() => child.emit('spawn'))
    return child
  })
  const respond = (result: unknown): void => {
    const message = child.postMessage.mock.calls.at(-1)?.[0]
    child.emit('message', { id: message.id, ok: true, result })
  }
  return { child, respond }
}

const variants = [
  {
    name: 'transcription',
    create: () => new TranscriptionWorkerClient(),
    request: (client: unknown) =>
      (client as TranscriptionWorkerClient).transcribe({ streamId: 'audio' } as never),
  },
  {
    name: 'diarization',
    create: () => new DiarizationWorkerClient(),
    request: (client: unknown) =>
      (client as DiarizationWorkerClient).diarize({ streamId: 'audio' } as never),
  },
]

describe.each(variants)('$name process lifecycle', ({ create, request }) => {
  it('does not spawn after permanent shutdown before first use', async () => {
    const client = create()
    await client.shutdown()
    await expect(request(client)).rejects.toThrow('shutting down')
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('owns a spawning worker, aborts its old request on reset, and permits a new process later', async () => {
    const first = childFixture(false)
    const client = create()
    const pending = request(client)
    const rejected = expect(pending).rejects.toThrow('before spawn')
    await Promise.resolve()
    expect(mocks.once).toHaveBeenCalledWith('before-quit', expect.any(Function))
    await client.reset()
    await rejected
    expect(first.child.postMessage).not.toHaveBeenCalled()
    const second = childFixture()
    const next = request(client)
    await vi.waitFor(() => expect(second.child.postMessage).toHaveBeenCalledOnce())
    second.respond({ segments: [] })
    await next
    expect(mocks.once).toHaveBeenCalledOnce()
    await client.shutdown()
  })

  it('rejects in-flight work and removes progress subscriptions across reset', async () => {
    const fixture = childFixture()
    const client = create()
    const progress = vi.fn()
    client.registerProgress('audio', progress)
    const pending = request(client)
    const rejected = expect(pending).rejects.toThrow('stopped')
    await vi.waitFor(() => expect(fixture.child.postMessage).toHaveBeenCalledOnce())
    await client.reset()
    await rejected
    fixture.child.emit('message', { ev: 'progress', streamId: 'audio', done: 99, total: 100 })
    expect(progress).not.toHaveBeenCalled()
  })

  it('suppresses a completed result if reset wins its final continuation', async () => {
    const fixture = childFixture()
    const client = create()
    const pending = request(client)
    const rejected = expect(pending).rejects.toThrow('stopped')
    await vi.waitFor(() => expect(fixture.child.postMessage).toHaveBeenCalledOnce())
    fixture.respond({ segments: [{ text: 'old account transcript' }] })
    await client.reset()
    await rejected
  })

  it('does not respawn alongside a worker that fails to terminate', async () => {
    vi.useFakeTimers()
    const fixture = childFixture()
    const client = create()
    const pending = request(client)
    const rejected = expect(pending).rejects.toThrow('stopped')
    await vi.advanceTimersByTimeAsync(0)
    fixture.child.kill.mockReturnValue(false)
    const reset = client.reset()
    const failed = expect(reset).rejects.toThrow('did not exit')
    await vi.advanceTimersByTimeAsync(2000)
    await failed
    await expect(request(client)).rejects.toThrow('could not be stopped')
    expect(mocks.fork).toHaveBeenCalledOnce()
    fixture.child.emit('exit', 0)
    await rejected
  })
})

it('does not cache a diarization load acknowledged just before session reset', async () => {
  const first = childFixture()
  const client = new DiarizationWorkerClient()
  const options = { segmentationPath: 'a.onnx', embeddingPath: 'b.onnx', threads: 2 }
  const initial = client.ensureLoaded(options)
  const rejected = expect(initial).rejects.toThrow('stopped')
  await vi.waitFor(() => expect(first.child.postMessage).toHaveBeenCalledOnce())
  first.respond(null)
  await client.reset()
  await rejected
  const second = childFixture()
  const next = client.ensureLoaded(options)
  await vi.waitFor(() => expect(second.child.postMessage).toHaveBeenCalledOnce())
  expect(second.child.postMessage.mock.calls[0]?.[0].op).toBe('diar.load')
  second.respond(null)
  await next
  await client.shutdown()
})

it('serializes native audio calls across Whisper and diarization and releases the queue after failure', async () => {
  const first = childFixture()
  const second = childFixture()
  const whisper = new TranscriptionWorkerClient()
  const diar = new DiarizationWorkerClient()
  const transcript = whisper.transcribe({ streamId: 'first' } as never)
  const failure = expect(transcript).rejects.toThrow('native failure')
  const load = diar.ensureLoaded({ segmentationPath: 'seg', embeddingPath: 'emb', threads: 2 })
  await vi.waitFor(() => expect(first.child.postMessage).toHaveBeenCalledOnce())
  expect(mocks.fork).toHaveBeenCalledOnce()
  first.child.emit('message', {
    id: first.child.postMessage.mock.calls[0]?.[0].id,
    ok: false,
    error: 'native failure',
  })
  await failure
  await vi.waitFor(() => expect(second.child.postMessage).toHaveBeenCalledOnce())
  second.respond(null)
  await load
  await Promise.all([whisper.shutdown(), diar.shutdown()])
})

it('skips a cancelled queued audio call without entering native code', async () => {
  const fixture = childFixture()
  const client = new TranscriptionWorkerClient()
  const active = client.transcribe({ streamId: 'active' } as never)
  const controller = new AbortController()
  const queued = client.transcribe({ streamId: 'cancelled' } as never, controller.signal)
  const cancelled = expect(queued).rejects.toThrow(/abort/i)
  const next = client.transcribe({ streamId: 'next' } as never)
  await vi.waitFor(() => expect(fixture.child.postMessage).toHaveBeenCalledOnce())
  controller.abort()
  fixture.respond({ segments: [] })
  await Promise.all([active, cancelled])
  await vi.waitFor(() => expect(fixture.child.postMessage).toHaveBeenCalledTimes(2))
  expect(fixture.child.postMessage.mock.calls[1]?.[0].payload.streamId).toBe('next')
  fixture.respond({ segments: [] })
  await next
  await client.shutdown()
})

it('holds the shared audio slot until a reset process actually exits', async () => {
  const first = childFixture()
  const second = childFixture()
  const whisper = new TranscriptionWorkerClient()
  const diar = new DiarizationWorkerClient()
  const transcript = whisper.transcribe({ streamId: 'active' } as never)
  const cancelled = expect(transcript).rejects.toThrow('stopped')
  const load = diar.ensureLoaded({ segmentationPath: 'seg', embeddingPath: 'emb', threads: 2 })
  await vi.waitFor(() => expect(first.child.postMessage).toHaveBeenCalledOnce())
  first.child.kill.mockReturnValue(true)
  const reset = whisper.reset()
  await Promise.resolve()
  await Promise.resolve()
  expect(mocks.fork).toHaveBeenCalledOnce()
  first.child.emit('exit', 0)
  await Promise.all([reset, cancelled])
  await vi.waitFor(() => expect(second.child.postMessage).toHaveBeenCalledOnce())
  second.respond(null)
  await load
  await diar.shutdown()
})

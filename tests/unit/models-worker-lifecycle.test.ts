import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmLoadPayload, WorkerRequest } from '@main/services/workers/protocol'

const mocks = vi.hoisted(() => ({ fork: vi.fn(), once: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork }, app: { once: mocks.once } }))
import { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

function childFixture(autoSpawn = true, autoExit = true) {
  const child = new EventEmitter() as EventEmitter & {
    postMessage(message: WorkerRequest): void
    kill(): boolean
  }
  const sent: WorkerRequest[] = []
  const respond = (message: WorkerRequest, result: unknown = []): void => {
    child.emit('message', { id: message.id, ok: true, result })
  }
  child.postMessage = (message) => {
    sent.push(message)
    queueMicrotask(() => {
      if (message.op === 'llm.ask' || message.op === 'llm.generateRaw') return
      respond(message)
      if (message.op === 'shutdown' && autoExit) child.emit('exit', 0)
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

const ask = { streamId: 'chat', question: 'Question', prompt: 'Prompt', maxTokens: 10 }

describe('model worker lifecycle admission', () => {
  it('retains only full-context allocation metadata across vault lock, with explicit reuse opt-out', async () => {
    vi.stubEnv('LOKLM_REUSE_GPU_LAYER_PLAN', '1')
    try {
      const first = childFixture()
      const client = new ModelsWorkerClient()
      await client.embedderEmbed(['private input that is never retained'])
      const hint = {
        key: 'complete identity',
        layers: 14,
        requestedContext: 8192,
        achievedContext: 8192,
      }
      first.child.emit('message', { ev: 'llm.loaded', result: { gpuLayerPlanHint: hint } })
      first.child.emit('message', {
        ev: 'llm.loaded',
        result: { gpuLayerPlanHint: { ...hint, key: 'reduced', achievedContext: 4096 } },
      })
      await client.resetSession()
      const second = childFixture()
      client.resumeSession()
      await client.llmLoad({ modelPath: 'model.gguf' } as LlmLoadPayload)
      const load = second.sent.find((message) => message.op === 'llm.load')
      expect(load).toMatchObject({
        payload: { modelPath: 'model.gguf', gpuLayerPlanHints: [hint] },
      })
      expect(JSON.stringify(load)).not.toContain('private input')
      vi.stubEnv('LOKLM_REUSE_GPU_LAYER_PLAN', '0')
      await client.llmLoad({ modelPath: 'model.gguf' } as LlmLoadPayload)
      expect(second.sent.at(-1)).toMatchObject({ payload: { gpuLayerPlanHints: [] } })
      await client.shutdown()
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('never starts a worker after shutdown before first use', async () => {
    const client = new ModelsWorkerClient()
    await client.shutdown()
    await expect(client.embedderEmbed(['late batch'])).rejects.toThrow('shutting down')
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('owns a worker that is still spawning and suppresses its original request on shutdown', async () => {
    const { child, sent } = childFixture(false)
    const client = new ModelsWorkerClient()
    const batch = client.embedderEmbed(['passage'])
    const rejected = expect(batch).rejects.toThrow('shutting down')
    const stopping = client.shutdown()
    child.emit('spawn')
    await Promise.all([stopping, rejected])
    expect(sent.map((message) => message.op)).toEqual(['shutdown'])
    expect(child.kill).not.toHaveBeenCalled()
    await expect(client.embedderEmbed(['later'])).rejects.toThrow('shutting down')
    expect(mocks.fork).toHaveBeenCalledOnce()
  })

  it('rejects new work while graceful shutdown is draining the native process', async () => {
    const { child, sent } = childFixture(true, false)
    const client = new ModelsWorkerClient()
    await client.embedderEmbed(['first'])
    const stopping = client.shutdown()
    await expect(client.embedderEmbed(['too late'])).rejects.toThrow('shutting down')
    expect(sent.map((message) => message.op)).toEqual(['embedder.embed', 'shutdown'])
    child.emit('exit', 0)
    await stopping
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('handles app quit during the first worker spawn', async () => {
    const { child, sent } = childFixture(false)
    const client = new ModelsWorkerClient()
    const batch = client.embedderEmbed(['passage'])
    const rejected = expect(batch).rejects.toThrow('shutting down')
    expect(mocks.once).toHaveBeenCalledWith('before-quit', expect.any(Function))
    mocks.once.mock.calls[0]![1]()
    child.emit('spawn')
    await Promise.all([client.shutdown(), rejected])
    expect(sent.map((message) => message.op)).toEqual(['shutdown'])
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('bounds a stuck native shutdown and rejects outstanding work when killed', async () => {
    vi.useFakeTimers()
    const { child } = childFixture(true, false)
    const client = new ModelsWorkerClient()
    const generation = client.llmAsk(ask)
    const rejected = expect(generation).rejects.toThrow('exited')
    await vi.advanceTimersByTimeAsync(0)
    const stopping = client.shutdown()
    await vi.advanceTimersByTimeAsync(1999)
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([stopping, rejected])
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('changes the device during spawn without keeping the old device worker', async () => {
    const first = childFixture(false)
    const second = childFixture()
    const client = new ModelsWorkerClient()
    const initial = client.embedderEmbed(['old device'])
    const rejected = expect(initial).rejects.toThrow('shutting down')
    const switched = client.setDevicePlan({
      backend: 'vulkan',
      ggmlVkVisibleDevices: '1',
      cudaVisibleDevices: null,
      expectedName: 'Second GPU',
      expectedKind: 'dedicated',
    } as never)
    await Promise.resolve()
    first.child.emit('spawn')
    await Promise.all([switched, rejected])
    await client.embedderEmbed(['new device'])
    expect(first.sent.map((message) => message.op)).toEqual(['shutdown'])
    expect(second.sent.map((message) => message.op)).toEqual(['embedder.embed'])
    expect(mocks.fork.mock.calls[1]?.[2].env.GGML_VK_VISIBLE_DEVICES).toBe('1')
    await client.shutdown()
  })
})

describe('generation cancellation before native admission', () => {
  it.each(['ask', 'generateRaw'] as const)(
    'cancels %s during indexing without spawning a worker',
    async (kind) => {
      const client = new ModelsWorkerClient()
      const lease = client.beginIndexing({ workspaceId: 1, title: 'Document' })
      const request =
        kind === 'ask'
          ? client.llmAsk(ask)
          : client.llmGenerateRaw({ streamId: ask.streamId, prompt: 'Translate' })
      const rejected = expect(request).rejects.toThrow(/abort/i)
      await client.llmAbort(ask.streamId)
      await rejected
      expect(client.activity().phase).toBe('indexing')
      expect(mocks.fork).not.toHaveBeenCalled()
      await client.shutdown()
      lease.release()
    },
  )

  it('does not respawn a worker for an unknown or completed stream cancellation', async () => {
    const client = new ModelsWorkerClient()
    await client.llmAbort('finished')
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('rejects cancellation racing with the final worker response', async () => {
    const { sent, respond } = childFixture()
    const client = new ModelsWorkerClient()
    const request = client.llmAsk(ask)
    const rejected = expect(request).rejects.toThrow(/abort/i)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    respond(sent[0]!, { raw: 'late answer' })
    await client.llmAbort(ask.streamId)
    await rejected
    await client.shutdown()
  })
})

describe('model session privacy boundary', () => {
  it('leaves active indexing intact when an already open session resumes again', () => {
    const client = new ModelsWorkerClient()
    const lease = client.beginIndexing({ workspaceId: 1, title: 'Active indexing' })
    client.resumeSession()
    expect(client.activity().phase).toBe('indexing')
    void client.shutdown()
    lease.release()
  })

  it('does not spawn on lock and requires explicit resume before accepting work', async () => {
    const client = new ModelsWorkerClient()
    await client.resetSession()
    await client.resetSession()
    await expect(client.embedderEmbed(['private'])).rejects.toThrow('session is closed')
    expect(() => client.beginIndexing({ workspaceId: 1, title: 'Private' })).toThrow(
      'session is closed',
    )
    expect(mocks.fork).not.toHaveBeenCalled()
    const child = childFixture()
    client.resumeSession()
    await client.embedderEmbed(['fresh session'])
    expect(child.sent.map((m) => m.op)).toEqual(['embedder.embed'])
    await client.shutdown()
  })

  it('retires queued work even if the next session resumes before it reaches native admission', async () => {
    const client = new ModelsWorkerClient()
    client.beginIndexing({ workspaceId: 1, title: 'Old upload' })
    const queued = client.rerankerRank('private query', ['private source'])
    const rejected = expect(queued).rejects.toThrow(/session is closed|shutting down/)
    await client.resetSession()
    client.resumeSession()
    await rejected
    expect(mocks.fork).not.toHaveBeenCalled()
    await client.shutdown()
  })

  it('rejects private requests immediately, suppresses late pushes and waits for actual worker exit', async () => {
    const first = childFixture(true, false)
    const client = new ModelsWorkerClient()
    const token = vi.fn()
    const status = vi.fn()
    const loaded = vi.fn()
    client.registerStream('chat', token)
    client.setStatusListener('llm', status)
    client.setLlmLoadListener(loaded)
    const generation = client.llmAsk(ask)
    const rejected = expect(generation).rejects.toThrow('session is closed')
    await vi.waitFor(() => expect(first.sent).toHaveLength(1))
    const resetting = client.resetSession()
    expect(client.resetSession()).toBe(resetting)
    await rejected
    first.child.emit('message', { ev: 'token', streamId: 'chat', text: 'private late answer' })
    first.child.emit('message', {
      ev: 'status',
      service: 'llm',
      status: { state: 'ready', resident: true },
    })
    first.child.emit('message', { ev: 'llm.loaded', result: {} })
    expect(token).not.toHaveBeenCalled()
    expect(loaded).not.toHaveBeenCalled()
    expect(status.mock.calls.at(-1)?.[0]).toMatchObject({ state: 'unloaded', resident: false })
    expect(() => client.resumeSession()).toThrow('cleanup is not complete')
    first.child.emit('exit', 0)
    await resetting
    const second = childFixture()
    client.resumeSession()
    await client.embedderEmbed(['new session'])
    expect(second.sent.map((m) => m.op)).toEqual(['embedder.embed'])
    await client.shutdown()
  })

  it('terminates a native call that ignores cancellation within the existing shutdown bound', async () => {
    vi.useFakeTimers()
    const fixture = childFixture(true, false)
    const client = new ModelsWorkerClient()
    const generation = client.llmAsk(ask)
    const rejected = expect(generation).rejects.toThrow('session is closed')
    await vi.advanceTimersByTimeAsync(0)
    const reset = client.resetSession()
    await rejected
    await vi.advanceTimersByTimeAsync(2_000)
    await reset
    expect(fixture.child.kill).toHaveBeenCalledOnce()
    await expect(client.refreshResources()).rejects.toThrow('session is closed')
    await client.shutdown()
  })

  it('preserves an unconfirmed termination failure across repeated reset hooks', async () => {
    vi.useFakeTimers()
    const fixture = childFixture(true, false)
    fixture.child.kill = vi.fn(() => false)
    const client = new ModelsWorkerClient()
    const initial = client.embedderEmbed(['batch'])
    await vi.advanceTimersByTimeAsync(0)
    await initial
    const resetting = client.resetSession()
    const rejected = expect(resetting).rejects.toThrow(/exit|stop|terminate/i)
    await vi.advanceTimersByTimeAsync(3_000)
    await rejected
    await expect(client.resetSession()).rejects.toThrow(/exit|stop|terminate/i)
    expect(() => client.resumeSession()).toThrow('cleanup is not complete')
    await expect(client.embedderEmbed(['must not run'])).rejects.toThrow('session is closed')
    fixture.child.emit('exit', 0)
    await client.resetSession()
    client.resumeSession()
    expect(mocks.fork).toHaveBeenCalledOnce()
    await client.shutdown()
  })
})

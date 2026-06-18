import { describe, it, expect } from 'vitest'
import { createBackendSerializer, SERIALIZED_OPS } from '@main/services/workers/backendSerializer'

// The embedder + reranker run on a dedicated CPU backend, so their ops bypass
// this serializer entirely. What it guards is the GPU (chat) backend: the main
// chat session (`llm.ask`) and the utility session (`llm.generateRaw`) decode on
// one device, so a background generation overlapping a live chat could fast-fail
// the process. This serializer makes the chat backend's ops run one-at-a-time
// while letting control ops (abort) and the CPU-backend ops jump the queue.

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Drain all pending microtasks (a macrotask turn) so scheduled continuations
// have definitely run before we assert on ordering.
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('backendSerializer', () => {
  it('runs two GPU-backend ops one at a time, in submission order', async () => {
    const run = createBackendSerializer()
    const events: string[] = []
    const gate = deferred()

    const p1 = run('llm.generateRaw', async () => {
      events.push('gen:start')
      await gate.promise
      events.push('gen:end')
    })
    const p2 = run('llm.ask', async () => {
      events.push('ask:start')
    })

    await tick()
    // The second op must NOT have started while the first still holds the queue.
    expect(events).toEqual(['gen:start'])

    gate.resolve()
    await Promise.all([p1, p2])
    expect(events).toEqual(['gen:start', 'gen:end', 'ask:start'])
  })

  it('lets a bypass op (llm.abort) run while a GPU op holds the queue', async () => {
    const run = createBackendSerializer()
    const events: string[] = []
    const gate = deferred()

    const p1 = run('llm.ask', async () => {
      events.push('ask:start')
      await gate.promise
      events.push('ask:end')
    })

    await tick()
    expect(events).toEqual(['ask:start']) // ask is in flight, holding the queue

    // Cancel must reach the worker even though the ask it cancels owns the queue.
    const pAbort = run('llm.abort', async () => {
      events.push('abort')
    })
    await pAbort
    expect(events).toEqual(['ask:start', 'abort'])

    gate.resolve()
    await p1
    expect(events).toEqual(['ask:start', 'abort', 'ask:end'])
  })

  it('does not serialize CPU-backend ops (embedder/reranker) against the GPU queue', async () => {
    const run = createBackendSerializer()
    const events: string[] = []
    const gate = deferred()

    const pAsk = run('llm.ask', async () => {
      events.push('ask:start')
      await gate.promise
      events.push('ask:end')
    })

    await tick()
    expect(events).toEqual(['ask:start']) // GPU op holds the queue

    // An embed running on the separate CPU backend must NOT wait for the chat.
    const pEmbed = run('embedder.embed', async () => {
      events.push('embed')
    })
    await pEmbed
    expect(events).toEqual(['ask:start', 'embed'])

    gate.resolve()
    await pAsk
  })

  it('releases the queue when a GPU op rejects', async () => {
    const run = createBackendSerializer()
    const events: string[] = []

    const p1 = run('llm.generateRaw', async () => {
      events.push('one')
      throw new Error('boom')
    })
    const p2 = run('llm.ask', async () => {
      events.push('two')
    })

    await expect(p1).rejects.toThrow('boom')
    await p2
    expect(events).toEqual(['one', 'two'])
  })

  it('serializes exactly the GPU (chat) backend ops', () => {
    for (const op of [
      'llm.load',
      'llm.unload',
      'llm.ask',
      'llm.generateRaw',
      'planner.refresh',
    ] as const) {
      expect(SERIALIZED_OPS.has(op)).toBe(true)
    }
  })

  it('never serializes CPU-backend ops or control ops', () => {
    // embedder/reranker live on their own CPU backend; abort must interrupt a
    // held ask; setLanguage is a JS-only patch; shutdown runs its own teardown.
    for (const op of [
      'embedder.embed',
      'embedder.load',
      'reranker.rank',
      'reranker.load',
      'llm.abort',
      'llm.setLanguage',
      'shutdown',
    ] as const) {
      expect(SERIALIZED_OPS.has(op)).toBe(false)
    }
  })
})

import { describe, it, expect } from 'vitest'
import { createBackendSerializer, SERIALIZED_OPS } from '@main/services/workers/backendSerializer'

// The chat LLM, embedder AND reranker all share ONE Vulkan backend on a small
// AMD iGPU (two Vulkan devices fast-fail the driver). This serializer funnels
// every native op on that shared device through one FIFO so no two overlap
// (the cross-op 0xC0000409 class). Only control ops (abort / setLanguage /
// shutdown) jump the queue.

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
  it('runs two backend ops one at a time, in submission order', async () => {
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

  it('lets a bypass op (llm.abort) run while a backend op holds the queue', async () => {
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

  it('serializes an embed BEHIND a held chat op (shared GPU backend)', async () => {
    const run = createBackendSerializer()
    const events: string[] = []
    const gate = deferred()

    const pAsk = run('llm.ask', async () => {
      events.push('ask:start')
      await gate.promise
      events.push('ask:end')
    })

    await tick()
    expect(events).toEqual(['ask:start']) // chat op holds the queue

    // The embedder now shares the GPU device, so an embed MUST wait — it cannot
    // decode concurrently with the chat ask.
    let embedRan = false
    const pEmbed = run('embedder.embed', async () => {
      embedRan = true
      events.push('embed')
    })
    await tick()
    expect(embedRan).toBe(false) // still queued behind the ask

    gate.resolve()
    await Promise.all([pAsk, pEmbed])
    expect(events).toEqual(['ask:start', 'ask:end', 'embed'])
  })

  it('releases the queue when a backend op rejects', async () => {
    const run = createBackendSerializer()
    const events: string[] = []

    const p1 = run('embedder.embed', async () => {
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

  it('serializes every native op on the shared backend', () => {
    for (const op of [
      'llm.load',
      'llm.unload',
      'llm.ask',
      'llm.generateRaw',
      'embedder.load',
      'embedder.unload',
      'embedder.embed',
      'reranker.load',
      'reranker.unload',
      'reranker.rank',
      'planner.refresh',
    ] as const) {
      expect(SERIALIZED_OPS.has(op)).toBe(true)
    }
  })

  it('never serializes control ops', () => {
    // abort must interrupt a held ask; setLanguage is a JS-only patch; shutdown
    // runs its own teardown on quit.
    for (const op of ['llm.abort', 'llm.setLanguage', 'shutdown'] as const) {
      expect(SERIALIZED_OPS.has(op)).toBe(false)
    }
  })
})

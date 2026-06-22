import { describe, it, expect } from 'vitest'
import { createBackendSerializer, SERIALIZED_OPS } from '@main/services/workers/backendSerializer'

// The worker is spawned as two isolated processes (chat = llm ops; retrieval =
// embedder + reranker ops), each with its own Vulkan backend. Every native op on
// a process's backend must run one-at-a-time (node-llama-cpp only globally
// serialises the decode call, and only on Vulkan), so this serializer covers all
// of them; only control ops (abort/setLanguage/shutdown) jump the queue. A
// process only ever receives its own subset, so the one op set fits both roles.

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

  it('serializes embedder + reranker ops within the retrieval process', async () => {
    const run = createBackendSerializer()
    const events: string[] = []
    const gate = deferred()

    const pEmbed = run('embedder.embed', async () => {
      events.push('embed:start')
      await gate.promise
      events.push('embed:end')
    })
    const pRank = run('reranker.rank', async () => {
      events.push('rank')
    })

    await tick()
    // reranker must wait behind the in-flight embed — one Vulkan backend per process.
    expect(events).toEqual(['embed:start'])

    gate.resolve()
    await Promise.all([pEmbed, pRank])
    expect(events).toEqual(['embed:start', 'embed:end', 'rank'])
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

  it('serializes every native-backend op (llm + embedder + reranker)', () => {
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
    // abort must interrupt a held ask; setLanguage is a JS-only chat-history
    // patch; shutdown runs its own teardown.
    for (const op of ['llm.abort', 'llm.setLanguage', 'shutdown'] as const) {
      expect(SERIALIZED_OPS.has(op)).toBe(false)
    }
  })
})

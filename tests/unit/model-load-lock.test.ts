import { describe, it, expect } from 'vitest'
import { ModelLoadLock } from '@main/services/concurrency/ModelLoadLock'

// unit: ModelLoadLock ist reine JS-logik , keine native deps. testet die
// FIFO-serialisierung die wir brauchen damit LLM + embedder + reranker nicht
// gleichzeitig laden. wenn dieser test passt , ist die "never load two models
// at the same time"-zusage des moduls eingehalten.

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('ModelLoadLock', () => {
  it('grants the first acquire immediately', async () => {
    const lock = new ModelLoadLock()
    const release = await lock.acquire('llm')
    expect(lock.current()).toBe('llm')
    release()
    expect(lock.current()).toBe(null)
  })

  it('serialises concurrent acquires in FIFO order', async () => {
    const lock = new ModelLoadLock()
    const order: string[] = []

    const first = lock.acquire('llm').then((release) => {
      order.push('llm-acquired')
      return release
    })
    const second = lock.acquire('embedder').then((release) => {
      order.push('embedder-acquired')
      return release
    })
    const third = lock.acquire('reranker').then((release) => {
      order.push('reranker-acquired')
      return release
    })

    const releaseFirst = await first
    await tick()
    // second + third still queued — only llm is in the holder slot
    expect(lock.current()).toBe('llm')
    expect(order).toEqual(['llm-acquired'])

    releaseFirst()
    const releaseSecond = await second
    await tick()
    expect(lock.current()).toBe('embedder')
    expect(order).toEqual(['llm-acquired', 'embedder-acquired'])

    releaseSecond()
    const releaseThird = await third
    expect(lock.current()).toBe('reranker')
    expect(order).toEqual(['llm-acquired', 'embedder-acquired', 'reranker-acquired'])
    releaseThird()
    expect(lock.current()).toBe(null)
  })

  it('release is idempotent — second call is a no-op', async () => {
    const lock = new ModelLoadLock()
    const release = await lock.acquire('llm')
    release()
    expect(lock.current()).toBe(null)
    // A double-release must NOT clobber the next holder. Acquire again and
    // confirm the second-call no-op did not pop the new holder off the slot.
    const nextRelease = await lock.acquire('embedder')
    release() // stale release from the prior holder
    expect(lock.current()).toBe('embedder')
    nextRelease()
  })

  it('subscribe fires on every holder transition', async () => {
    const lock = new ModelLoadLock()
    const transitions: Array<ReturnType<typeof lock.current>> = []
    const off = lock.subscribe((h) => transitions.push(h))

    const r1 = await lock.acquire('llm')
    r1()
    const r2 = await lock.acquire('reranker')
    r2()

    off()
    expect(transitions).toEqual(['llm', null, 'reranker', null])
  })

  it('a thrown handler unblocks the queue when release is called from finally', async () => {
    const lock = new ModelLoadLock()
    const ran: string[] = []

    const first = (async () => {
      const release = await lock.acquire('llm')
      try {
        ran.push('first-body')
        throw new Error('boom')
      } finally {
        release()
      }
    })()

    const second = (async () => {
      const release = await lock.acquire('embedder')
      try {
        ran.push('second-body')
      } finally {
        release()
      }
    })()

    await expect(first).rejects.toThrow('boom')
    await second
    expect(ran).toEqual(['first-body', 'second-body'])
    expect(lock.current()).toBe(null)
  })
})

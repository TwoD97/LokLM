// FIFO serializer for the modelsWorker's shared GPU backend.
//
// On a small AMD iGPU the chat LLM, the embedder and the reranker all live on
// ONE Vulkan backend (two separate Vulkan devices fast-fail the driver, so a
// single shared device is the only stable layout). node-llama-cpp only globally
// serialises the decode *call*, and only on Vulkan (`decodeSyncWorkaround.
// vulkanLock`); context loads/disposes, sampling and KV edits across the chat /
// embedder / reranker contexts can otherwise overlap and fast-fail the whole
// process (0xC0000409) on a fragile driver — seen when a background embed raced
// a chat ask or a reranker load.
//
// So EVERY op that issues native work on the shared backend is funnelled
// through this one FIFO and runs strictly one-at-a-time; only control ops
// (abort / setLanguage / shutdown) bypass it.

import type { WorkerRequest } from './protocol'

export type WorkerOp = WorkerRequest['op']

/**
 * Ops that issue native work on the shared GPU backend and therefore must run
 * one-at-a-time. Loads/unloads allocate and free device buffers; ask /
 * generateRaw / embed / rank decode on a context; `planner.refresh` probes VRAM
 * on the same device.
 *
 * NOT included: `llm.abort` (must interrupt an ask that is HOLDING the queue),
 * `llm.setLanguage` (JS-only chat-history patch), and `shutdown` (runs its own
 * dispose on quit).
 */
export const SERIALIZED_OPS: ReadonlySet<WorkerOp> = new Set<WorkerOp>([
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
])

export type BackendSerializer = <T>(op: WorkerOp, fn: () => Promise<T>) => Promise<T>

/**
 * Build a FIFO serializer. Serialized ops chain on a single tail promise so the
 * next one only starts after the previous resolves OR rejects; non-serialized
 * ops run immediately. A rejecting op still releases the queue (the release runs
 * in `finally`), so one failed generation never wedges every later request.
 */
export function createBackendSerializer(): BackendSerializer {
  let tail: Promise<void> = Promise.resolve()
  return function run<T>(op: WorkerOp, fn: () => Promise<T>): Promise<T> {
    if (!SERIALIZED_OPS.has(op)) return fn()
    const prev = tail
    let release: () => void = () => {}
    tail = new Promise<void>((resolve) => {
      release = resolve
    })
    return (async () => {
      // `prev` is the previous op's tail; it never rejects (it resolves via the
      // `release()` below, which always runs), so this await can't throw.
      await prev
      try {
        return await fn()
      } finally {
        release()
      }
    })()
  }
}

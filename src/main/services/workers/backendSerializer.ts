// FIFO serializer for the modelsWorker's GPU (chat) backend.
//
// The embedder + reranker run on a dedicated CPU backend (see modelsWorker's
// 'aux' backend), so they make no GPU calls and can never collide with the chat
// model — they don't need this serializer. What DOES still need it is the chat
// model's own backend: it runs two contexts on one device (the main chat
// session and the small utility session for raw generations). node-llama-cpp
// serialises decode only *per context*, so a `llm.ask` on the main session and a
// `llm.generateRaw` on the utility session — e.g. a background quiz/summary
// running while the user chats — can decode on the GPU at the same instant and
// fast-fail the process (0xC0000409 on a fragile Vulkan driver). Within a single
// query the LLM calls are already sequential (contextualize → retrieve → rerank
// → ask); this guards only the cross-flow case.
//
// So: serialise the chat backend's generation/load ops; let control ops
// (abort/setLanguage/shutdown) and the CPU-backend ops (embedder/reranker)
// bypass.

import type { WorkerRequest } from './protocol'

export type WorkerOp = WorkerRequest['op']

/**
 * Ops that issue native work on the shared GPU (chat) backend and therefore must
 * run strictly one-at-a-time. `llm.load`/`unload` allocate and free device
 * buffers; `llm.ask`/`generateRaw` decode and sample on the main vs utility
 * context; `planner.refresh` probes VRAM on the same backend.
 *
 * NOT included: `embedder.*` / `reranker.*` (own CPU backend — concurrent CPU
 * decode across contexts is node-llama-cpp's supported thread-splitter path),
 * `llm.abort` (must interrupt an ask that is HOLDING the queue), `llm.setLanguage`
 * (JS-only chat-history patch), and `shutdown` (runs its own dispose on quit).
 */
export const SERIALIZED_OPS: ReadonlySet<WorkerOp> = new Set<WorkerOp>([
  'llm.load',
  'llm.unload',
  'llm.ask',
  'llm.generateRaw',
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

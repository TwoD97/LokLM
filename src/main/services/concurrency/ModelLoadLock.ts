/**
 * FIFO mutex that serialises heavy GGUF load operations across the three model
 * services (LLM , embedder , reranker). Acquire before the slow
 * `lib.loadModel(...)` / createContext call ; release in a `finally`. The lock
 * guards the load operation only , not the entire lifetime of the model , so
 * residency can still overlap (the ResourcePlanner decides whether that fits).
 *
 * Why: without this , a freshly-unlocked session kicks off LLM autoLoad ,
 * embedder backfill , and the first reranker call in parallel — three
 * concurrent native inits fighting for VRAM and CPU, which on tight machines
 * either spins everything to a crawl or crashes the second backend init mid-
 * allocation. Serialising the *load* keeps the loads themselves "nice"
 * (one at a time, predictable status messages, no native-init thrash).
 *
 * The lock is FIFO. `acquire()` returns a release function ; calling it twice
 * is a no-op so callers can put the release in a finally without worrying
 * about double-release on error paths.
 */
export type ModelLoadHolder = 'llm' | 'embedder' | 'reranker'

export class ModelLoadLock {
  private tail: Promise<void> = Promise.resolve()
  private holder: ModelLoadHolder | null = null
  private listeners: Array<(holder: ModelLoadHolder | null) => void> = []

  /**
   * Wait for the queue to drain , then mark the lock held by `holder` and
   * return a release function. The release function is idempotent.
   */
  async acquire(holder: ModelLoadHolder): Promise<() => void> {
    let release: () => void = () => {}
    const wait = this.tail
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await wait
    this.holder = holder
    this.emit()
    let released = false
    return () => {
      if (released) return
      released = true
      this.holder = null
      this.emit()
      release()
    }
  }

  current(): ModelLoadHolder | null {
    return this.holder
  }

  subscribe(cb: (holder: ModelLoadHolder | null) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l(this.holder)
      } catch {
        /* ignore listener errors */
      }
    }
  }
}

import {
  IDLE_MODEL_TRANSITION,
  type IndexingJob,
  type IndexingLease,
  type ModelActivity,
  type ModelTransition,
} from '../../../shared/modelActivity'

/** Hold the GPU across an entire indexing run, not just a single batch. */
export class GpuWorkCoordinator {
  private jobs = new Map<symbol, IndexingJob>()
  private transition: ModelTransition = IDLE_MODEL_TRANSITION
  private gate: { promise: Promise<void>; resolve: () => void } | null = null
  private restoreTimer: ReturnType<typeof setTimeout> | null = null
  private restoring = false
  private stopped = false
  private epoch = 0

  constructor(
    private readonly restoreChat: () => Promise<void>,
    private readonly changed: (activity: ModelActivity) => void,
    private readonly shouldRestoreChat: () => boolean = () => true,
  ) {}

  status(): ModelActivity {
    return {
      ...this.transition,
      phase:
        this.transition.phase === 'error'
          ? 'error'
          : this.restoring || (this.gate && !this.jobs.size && this.shouldRestoreChat())
            ? 'restoring'
            : this.transition.phase === 'switching'
              ? 'switching'
              : this.jobs.size > 0 || this.gate
                ? 'indexing'
                : 'idle',
      jobs: [...this.jobs.values()],
    }
  }

  setTransition(transition: ModelTransition): void {
    this.transition = transition
    this.publish()
  }

  private publish(): void {
    this.changed(this.status())
  }

  acquire(job: Omit<IndexingJob, 'done' | 'total'>): IndexingLease {
    if (this.stopped) throw new Error('Model worker is shutting down.')
    if (this.restoreTimer) clearTimeout(this.restoreTimer)
    this.restoreTimer = null
    if (!this.gate) {
      let resolve!: () => void
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      this.gate = { promise, resolve }
    }
    const key = Symbol()
    this.jobs.set(key, { ...job, done: 0, total: 0 })
    this.publish()
    return {
      update: (done, total) => {
        if (!this.jobs.has(key)) return
        this.jobs.set(key, { ...job, done, total })
        this.publish()
      },
      release: () => {
        if (!this.jobs.delete(key)) return
        this.publish()
        if (this.jobs.size || this.stopped) return
        // Let the next queued document acquire its lease before releasing the
        // indexing gate. Small GPUs keep search resident until chat is needed.
        this.restoreTimer = setTimeout(() => {
          this.restoreTimer = null
          void this.restore()
        }, 250)
      },
    }
  }

  async waitForChat(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    while (this.gate) {
      const gate = this.gate.promise
      if (!signal) await gate
      else
        await new Promise<void>((resolve, reject) => {
          const abort = (): void => reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
          void gate.then(resolve).finally(() => signal.removeEventListener('abort', abort))
        })
      signal?.throwIfAborted()
    }
    if (this.stopped) throw new Error('Model worker is shutting down.')
  }

  private async restore(): Promise<void> {
    if (this.jobs.size || this.stopped || this.restoring) return
    const epoch = this.epoch
    if (!this.shouldRestoreChat()) {
      // ask/generate/rank ensure their own model is resident inside the native
      // FIFO. Unblock those callers without an eager chat load that the next
      // document query would immediately undo to embed its question.
      this.gate?.resolve()
      this.gate = null
      this.publish()
      return
    }
    this.restoring = true
    this.publish()
    try {
      await this.restoreChat()
      if (epoch === this.epoch) this.transition = IDLE_MODEL_TRANSITION
    } catch (error) {
      if (epoch === this.epoch)
        this.transition = { ...IDLE_MODEL_TRANSITION, phase: 'error', error: String(error) }
    } finally {
      if (epoch === this.epoch) {
        this.restoring = false
        if (!this.jobs.size) {
          this.gate?.resolve()
          this.gate = null
        }
        this.publish()
      }
    }
  }

  reset(error?: string, stopped = false): void {
    this.epoch++
    this.stopped = stopped
    if (this.restoreTimer) clearTimeout(this.restoreTimer)
    this.restoreTimer = null
    this.jobs.clear()
    this.gate?.resolve()
    this.gate = null
    this.restoring = false
    this.transition = error
      ? { ...IDLE_MODEL_TRANSITION, phase: 'error', error }
      : IDLE_MODEL_TRANSITION
    this.publish()
  }
}

import { app, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

// Whisper and diarization are separate processes but share host resources.
// Admit one native audio operation at a time, including model loading. This
// prevents parallel windows from loading/decoding multiple audio models at once.
let audioWork: Promise<void> = Promise.resolve()
const failedAudioStops = new Set<UtilityProcess>()

/** Audio bindings cannot interrupt native inference. Reset ends their isolated
 * process, rejecting pending work before another session can reuse it. */
export abstract class AudioWorkerClient<Push> {
  private child: UtilityProcess | null = null
  private spawning: Promise<UtilityProcess> | null = null
  private stopping: Promise<void> | null = null
  private stopped = false
  private epoch = 0
  private nextId = 1
  private pending = new Map<number, Pending>()
  private quitRegistered = false

  protected constructor(
    private readonly name: string,
    private readonly file: string,
  ) {}

  protected abstract handlePush(push: Push): void
  protected abstract workerStopped(): void

  protected async send<T>(op: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const epoch = this.epoch
    const previous = audioWork
    let release!: () => void
    audioWork = new Promise<void>((resolve) => {
      release = resolve
    })
    let admitted = false
    try {
      await waitForAudioSlot(previous, signal)
      admitted = true
      if (this.stopped) throw new Error(`${this.name} worker is shutting down.`)
      if (epoch !== this.epoch) throw new Error(`${this.name} worker was stopped.`)
      if (failedAudioStops.size)
        throw new Error(
          'An audio worker could not be stopped. Restart LokLM before starting transcription.',
        )
      signal?.throwIfAborted()
      return await this.dispatchRequest<T>(op, payload, epoch, signal)
    } finally {
      // A canceled queued request has never entered native code, so its caller
      // can clean up immediately. Keep its place in the shared queue until the
      // preceding operation finishes; releasing now would admit overlapping work.
      if (!admitted) {
        void previous.then(release)
      } else {
        // A reset rejects its caller immediately, but native code still owns the
        // audio slot until the OS confirms termination (or the failure gate trips).
        if (epoch !== this.epoch && this.stopping) await this.stopping.catch(() => undefined)
        release()
      }
    }
  }

  private async dispatchRequest<T>(
    op: string,
    payload: unknown,
    epoch: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const child = await this.ensureChild()
    signal?.throwIfAborted()
    if (this.stopped || epoch !== this.epoch || child !== this.child)
      throw new Error(`${this.name} worker was stopped.`)
    const id = this.nextId++
    const result = await new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      try {
        child.postMessage(payload === undefined ? { id, op } : { id, op, payload })
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    // A reset can run after the response is received but before its consumer
    // resumes. Never publish that old result or cache its loaded model state.
    if (this.stopped || epoch !== this.epoch || child !== this.child)
      throw new Error(`${this.name} worker was stopped.`)
    signal?.throwIfAborted()
    return result
  }

  private async ensureChild(): Promise<UtilityProcess> {
    if (this.stopping) await this.stopping
    if (this.stopped) throw new Error(`${this.name} worker is shutting down.`)
    if (this.spawning) return this.spawning
    if (this.child) return this.child
    if (!this.quitRegistered) {
      this.quitRegistered = true
      app.once('before-quit', () => void this.shutdown().catch(() => undefined))
    }
    this.spawning = (async () => {
      const child = utilityProcess.fork(join(__dirname, this.file), [], {
        stdio: 'inherit',
        serviceName: `loklm-${this.name}`,
      })
      this.child = child
      child.on('message', (raw: unknown) => {
        if (this.child !== child) return
        const message = (raw as { data?: unknown } | null)?.data ?? raw
        if (!message || typeof message !== 'object') return
        if ('ev' in message) {
          this.handlePush(message as Push)
          return
        }
        const response = message as { id?: number; ok?: boolean; result?: unknown; error?: string }
        if (typeof response.id !== 'number') return
        const pending = this.pending.get(response.id)
        if (!pending) return
        this.pending.delete(response.id)
        if (response.ok) pending.resolve(response.result)
        else pending.reject(new Error(response.error ?? `${this.name} worker failed.`))
      })
      child.on('exit', (code) => {
        failedAudioStops.delete(child)
        if (this.child !== child) return
        this.child = null
        this.stopping = null
        for (const pending of this.pending.values())
          pending.reject(new Error(`${this.name} worker exited (code=${code ?? 'null'})`))
        this.pending.clear()
        this.workerStopped()
      })
      await new Promise<void>((resolve, reject) => {
        const onSpawn = (): void => {
          child.removeListener('exit', onExit)
          resolve()
        }
        const onExit = (): void => {
          child.removeListener('spawn', onSpawn)
          reject(new Error(`${this.name} worker exited before spawn.`))
        }
        child.once('spawn', onSpawn)
        child.once('exit', onExit)
      })
      return child
    })()
    const spawning = this.spawning
    try {
      return await spawning
    } finally {
      if (this.spawning === spawning) this.spawning = null
    }
  }

  /** Cancel native work for a vault/session boundary; later use may respawn. */
  async reset(): Promise<void> {
    if (this.stopping) return this.stopping
    this.epoch++
    this.workerStopped()
    // Release callers and queued work even if native termination takes time.
    // Admission still waits for confirmed process exit before another spawn.
    for (const pending of this.pending.values())
      pending.reject(new Error(`${this.name} worker was stopped.`))
    this.pending.clear()
    const child = this.child
    if (!child) return
    const stopping = new Promise<void>((resolve, reject) => {
      const terminate = (): void => {
        try {
          child.kill()
        } catch {
          // Exit confirms termination even when kill throws or is rejected.
        }
      }
      const timer = setTimeout(() => {
        failedAudioStops.add(child)
        reject(new Error(`${this.name} worker did not exit.`))
      }, 2000)
      child.once('exit', () => {
        child.removeListener('spawn', terminate)
        clearTimeout(timer)
        resolve()
      })
      // Electron can reject kill before assigning a pid. Retain ownership of
      // that spawn and terminate it when it becomes killable, even after the
      // bounded stop reports failure. Never dispatch the retired request.
      child.once('spawn', terminate)
      terminate()
    })
    this.stopping = stopping
    await stopping
    if (this.stopping === stopping) this.stopping = null
  }

  async shutdown(): Promise<void> {
    this.stopped = true
    await this.reset()
  }
}

function waitForAudioSlot(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return previous
  return new Promise<void>((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    void previous.then(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    })
  })
}

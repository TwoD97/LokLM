import { utilityProcess, app, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type {
  TxWorkerRequest,
  TxWorkerResponse,
  TxWorkerPush,
  WhisperTranscribePayload,
  WhisperTranscribeResult,
} from './transcriptionProtocol'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

/**
 * Main-side wrapper around the transcriptionWorker utilityProcess. Spawned
 * lazily on first transcribe, multiplexes request/response by id, and fans
 * progress pushes out to per-stream listeners. Kept separate from the models +
 * documents workers so whisper inference never shares an event loop with chat
 * streaming or document parsing.
 *
 * The kutalia binding loads the model per call (no resident state) and cannot
 * abort mid-run, so there is no load/abort op here — cancellation is handled by
 * the TranscriptionService ignoring an aborted stream's result.
 */
export class TranscriptionWorkerClient {
  private child: UtilityProcess | null = null
  private spawnPromise: Promise<UtilityProcess> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private progress = new Map<string, (done: number, total: number) => void>()
  private beforeQuitRegistered = false

  registerProgress(streamId: string, cb: (done: number, total: number) => void): () => void {
    this.progress.set(streamId, cb)
    return () => this.progress.delete(streamId)
  }

  private async ensureChild(): Promise<UtilityProcess> {
    if (this.child) return this.child
    if (this.spawnPromise) return this.spawnPromise
    this.spawnPromise = (async () => {
      const workerPath = join(__dirname, 'transcriptionWorker.js')
      const child = utilityProcess.fork(workerPath, [], {
        stdio: 'inherit',
        serviceName: 'loklm-transcription',
      })
      await new Promise<void>((resolve, reject) => {
        const onSpawn = (): void => {
          child.removeListener('exit', onExit)
          resolve()
        }
        const onExit = (code: number | null): void => {
          child.removeListener('spawn', onSpawn)
          reject(new Error(`transcription worker exited before spawn (code=${code ?? 'null'})`))
        }
        child.once('spawn', onSpawn)
        child.once('exit', onExit)
      })
      child.on('message', (msg: TxWorkerResponse | TxWorkerPush) => this.dispatch(msg))
      child.on('exit', (code) => {
        const reason = `transcription worker exited (code=${code ?? 'null'})`
        for (const p of this.pending.values()) p.reject(new Error(reason))
        this.pending.clear()
        this.progress.clear()
        this.child = null
        this.spawnPromise = null
      })
      this.child = child
      if (!this.beforeQuitRegistered) {
        this.beforeQuitRegistered = true
        app.once('before-quit', () => void this.shutdown().catch(() => undefined))
      }
      return child
    })()
    try {
      return await this.spawnPromise
    } finally {
      this.spawnPromise = null
    }
  }

  private dispatch(msg: TxWorkerResponse | TxWorkerPush): void {
    const m = (msg as { data?: TxWorkerResponse | TxWorkerPush }).data ?? msg
    if (m && typeof m === 'object' && 'ev' in m) {
      const ev = m as TxWorkerPush
      if (ev.ev === 'progress') this.progress.get(ev.streamId)?.(ev.done, ev.total)
      else if (ev.ev === 'log')
        // eslint-disable-next-line no-console
        console[ev.level === 'error' ? 'error' : 'log'](`[transcriptionWorker] ${ev.message}`)
      return
    }
    if (!m || typeof (m as { id?: unknown }).id !== 'number') return
    const r = m as TxWorkerResponse
    const p = this.pending.get(r.id)
    if (!p) return
    this.pending.delete(r.id)
    if (r.ok) p.resolve(r.result)
    else p.reject(new Error(r.error))
  }

  private async send<T>(op: TxWorkerRequest['op'], payload?: unknown): Promise<T> {
    const child = await this.ensureChild()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      try {
        child.postMessage(payload === undefined ? { id, op } : { id, op, payload })
      } catch (err) {
        this.pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  transcribe(p: WhisperTranscribePayload): Promise<WhisperTranscribeResult> {
    return this.send('whisper.transcribe', p)
  }

  async shutdown(): Promise<void> {
    if (!this.child) return
    try {
      await Promise.race([
        this.send<void>('shutdown'),
        new Promise<void>((r) => setTimeout(r, 2000)),
      ])
    } catch {
      /* ignore */
    }
    try {
      this.child.kill()
    } catch {
      /* ignore */
    }
    this.child = null
  }
}

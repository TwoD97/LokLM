import { utilityProcess, app, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type {
  DiarWorkerRequest,
  DiarWorkerResponse,
  DiarWorkerPush,
  DiarLoadPayload,
  DiarRunPayload,
  DiarTurnDto,
} from './diarizationProtocol'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

/**
 * Main-side wrapper around the diarizationWorker utilityProcess. Spawned lazily
 * on the first diarize request (so the common, diarization-off path pays no
 * memory for sherpa-onnx). One resident load of the seg + embedding models is
 * reused across files; per-file speaker-count changes go through setConfig in
 * the worker.
 */
export class DiarizationWorkerClient {
  private child: UtilityProcess | null = null
  private spawnPromise: Promise<UtilityProcess> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private progress = new Map<string, (done: number, total: number) => void>()
  private loaded: DiarLoadPayload | null = null
  private beforeQuitRegistered = false

  registerProgress(streamId: string, cb: (done: number, total: number) => void): () => void {
    this.progress.set(streamId, cb)
    return () => this.progress.delete(streamId)
  }

  private async ensureChild(): Promise<UtilityProcess> {
    if (this.child) return this.child
    if (this.spawnPromise) return this.spawnPromise
    this.spawnPromise = (async () => {
      const child = utilityProcess.fork(join(__dirname, 'diarizationWorker.js'), [], {
        stdio: 'inherit',
        serviceName: 'loklm-diarization',
      })
      await new Promise<void>((resolve, reject) => {
        const onSpawn = (): void => {
          child.removeListener('exit', onExit)
          resolve()
        }
        const onExit = (code: number | null): void => {
          child.removeListener('spawn', onSpawn)
          reject(new Error(`diarization worker exited before spawn (code=${code ?? 'null'})`))
        }
        child.once('spawn', onSpawn)
        child.once('exit', onExit)
      })
      child.on('message', (msg: DiarWorkerResponse | DiarWorkerPush) => this.dispatch(msg))
      child.on('exit', (code) => {
        const reason = `diarization worker exited (code=${code ?? 'null'})`
        for (const p of this.pending.values()) p.reject(new Error(reason))
        this.pending.clear()
        this.progress.clear()
        this.child = null
        this.spawnPromise = null
        this.loaded = null
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

  private dispatch(msg: DiarWorkerResponse | DiarWorkerPush): void {
    const m = (msg as { data?: DiarWorkerResponse | DiarWorkerPush }).data ?? msg
    if (m && typeof m === 'object' && 'ev' in m) {
      const ev = m as DiarWorkerPush
      if (ev.ev === 'progress') this.progress.get(ev.streamId)?.(ev.done, ev.total)
      else if (ev.ev === 'log')
        // eslint-disable-next-line no-console
        console[ev.level === 'error' ? 'error' : 'log'](`[diarizationWorker] ${ev.message}`)
      return
    }
    if (!m || typeof (m as { id?: unknown }).id !== 'number') return
    const r = m as DiarWorkerResponse
    const p = this.pending.get(r.id)
    if (!p) return
    this.pending.delete(r.id)
    if (r.ok) p.resolve(r.result)
    else p.reject(new Error(r.error))
  }

  private async send<T>(op: DiarWorkerRequest['op'], payload?: unknown): Promise<T> {
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

  async ensureLoaded(p: DiarLoadPayload): Promise<void> {
    if (
      this.loaded &&
      this.loaded.segmentationPath === p.segmentationPath &&
      this.loaded.embeddingPath === p.embeddingPath
    )
      return
    await this.send('diar.load', p)
    this.loaded = p
  }

  diarize(p: DiarRunPayload): Promise<{ turns: DiarTurnDto[] }> {
    return this.send('diar.run', p)
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

import { utilityProcess, app, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type {
  DocWorkerRequest,
  DocWorkerResponse,
  DocWorkerPush,
  ParseAndChunkPayload,
  ParseAndChunkResult,
} from './documentsProtocol'

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  onProgress?: (done: number, total: number) => void
}

/**
 * Main-side wrapper around the documentsWorker utilityProcess. Spawned lazily
 * on first parse, multiplexes request/response by id, and fans OCR progress
 * pushes out to per-document listeners. One instance is shared by the
 * DocumentService for the lifetime of the app.
 *
 * Kept deliberately separate from ModelsWorkerClient: document parsing + OCR
 * are CPU-heavy and must not share an event loop with chat-token streaming.
 */
export class DocumentsWorkerClient {
  private child: UtilityProcess | null = null
  private spawnPromise: Promise<UtilityProcess> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private beforeQuitRegistered = false
  private epoch = 0
  private suspended = false
  private stopped = false
  private resetting: Promise<void> | null = null
  private resetError: Error | null = null

  private assertSession(epoch: number): void {
    if (this.stopped) throw new Error('Documents worker is shutting down.')
    if (this.suspended || epoch !== this.epoch) throw new Error('Document session is closed.')
  }

  private async ensureChild(): Promise<UtilityProcess> {
    this.assertSession(this.epoch)
    if (this.spawnPromise) return this.spawnPromise
    if (this.child) return this.child
    if (!this.beforeQuitRegistered) {
      this.beforeQuitRegistered = true
      app.once('before-quit', () => {
        void this.shutdown().catch(() => undefined)
      })
    }
    this.spawnPromise = (async () => {
      // The worker bundle sits next to the compiled main entry — see the
      // additional rollup input in electron.vite.config.ts. __dirname points at
      // out/main at runtime for ESM main builds.
      const workerPath = join(__dirname, 'documentsWorker.js')
      const child = utilityProcess.fork(workerPath, [], {
        stdio: 'inherit',
        serviceName: 'loklm-documents',
        // tessdata location for the OCR engine. Main resolves it from
        // app.isPackaged; the worker reads LOKLM_TESSDATA_DIR via ocr.ts.
        env: {
          ...process.env,
          LOKLM_TESSDATA_DIR:
            process.env['LOKLM_TESSDATA_DIR'] ??
            (app.isPackaged
              ? join(process.resourcesPath, 'tessdata')
              : join(app.getAppPath(), 'tessdata')),
        },
      })
      // Own the process while Electron is still spawning it. Lock/quit must
      // reap that process too, rather than allowing a late orphaned parser.
      this.child = child
      child.on('message', (msg: DocWorkerResponse | DocWorkerPush) => {
        if (this.child === child) this.dispatch(msg)
      })
      child.on('exit', (code) => {
        if (this.child !== child) return
        const reason = `documents worker exited (code=${code ?? 'null'})`
        for (const p of this.pending.values()) p.reject(new Error(reason))
        this.pending.clear()
        this.child = null
        this.spawnPromise = null
      })
      await new Promise<void>((resolve, reject) => {
        const onSpawn = (): void => {
          child.removeListener('exit', onExit)
          resolve()
        }
        const onExit = (code: number | null): void => {
          child.removeListener('spawn', onSpawn)
          reject(new Error(`documents worker exited before spawn (code=${code ?? 'null'})`))
        }
        child.once('spawn', onSpawn)
        child.once('exit', onExit)
      })
      return child
    })()
    const spawning = this.spawnPromise
    try {
      return await spawning
    } finally {
      if (this.spawnPromise === spawning) this.spawnPromise = null
    }
  }

  private dispatch(msg: DocWorkerResponse | DocWorkerPush): void {
    const m = (msg as unknown as { data?: DocWorkerResponse | DocWorkerPush }).data ?? msg
    if (m && typeof m === 'object' && 'ev' in m) {
      this.handlePush(m)
      return
    }
    if (!m || typeof m !== 'object' || typeof (m as { id?: unknown }).id !== 'number') {
      console.warn('[documentsWorkerClient] dropped malformed worker message', m)
      return
    }
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    if (m.ok) p.resolve(m.result)
    else p.reject(new Error(m.error))
  }

  private handlePush(ev: DocWorkerPush): void {
    if (this.suspended || this.stopped) return
    switch (ev.ev) {
      case 'ocr': {
        this.pending.get(ev.requestId)?.onProgress?.(ev.done, ev.total)
        return
      }
      case 'log':
        console[ev.level === 'error' ? 'error' : ev.level === 'warn' ? 'warn' : 'log'](
          `[documentsWorker] ${ev.message}`,
        )
        return
    }
  }

  private async send<T>(
    op: DocWorkerRequest['op'],
    payload?: unknown,
    onProgress?: (done: number, total: number) => void,
  ): Promise<T> {
    const epoch = this.epoch
    this.assertSession(epoch)
    const child = await this.ensureChild()
    this.assertSession(epoch)
    if (this.child !== child) throw new Error('Documents worker was stopped.')
    const result = await this.postRequest<T>(child, op, payload, onProgress)
    this.assertSession(epoch)
    return result
  }

  private postRequest<T>(
    child: UtilityProcess,
    op: DocWorkerRequest['op'],
    payload?: unknown,
    onProgress?: (done: number, total: number) => void,
  ): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        ...(onProgress ? { onProgress } : {}),
      })
      try {
        child.postMessage(payload === undefined ? { id, op } : { id, op, payload })
      } catch (err) {
        this.pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  parseAndChunk(
    p: ParseAndChunkPayload,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ParseAndChunkResult> {
    // Request IDs, unlike workspace-local document IDs, never collide across
    // simultaneous imports, retries or different workspaces.
    return this.send<ParseAndChunkResult>('documents.parseAndChunk', p, onProgress)
  }

  resetSession(): Promise<void> {
    if (this.resetting) return this.resetting
    if (this.suspended) {
      if (!this.resetError) return Promise.resolve()
      if (this.child || this.spawnPromise) return Promise.reject(this.resetError)
    }
    this.epoch++
    this.suspended = true
    for (const pending of this.pending.values())
      pending.reject(new Error('Document session is closed.'))
    this.pending.clear()
    const resetting = this.stopChild().then(
      () => {
        this.resetError = null
      },
      (error: unknown) => {
        this.resetError = error instanceof Error ? error : new Error(String(error))
        throw this.resetError
      },
    )
    this.resetting = resetting
    void resetting
      .finally(() => {
        if (this.resetting === resetting) this.resetting = null
      })
      .catch(() => undefined)
    return resetting
  }

  resumeSession(): void {
    if (this.resetting || this.resetError || this.stopped)
      throw new Error('Documents worker session cleanup is not complete.')
    this.suspended = false
  }

  shutdown(): Promise<void> {
    this.stopped = true
    return this.resetSession()
  }

  private async stopChild(): Promise<void> {
    const child = this.child
    if (!child) return
    let didExit = false
    const exited = new Promise<void>((resolve) =>
      child.once('exit', () => {
        didExit = true
        resolve()
      }),
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        (async () => {
          try {
            if (this.spawnPromise) await this.spawnPromise
            if (this.child === child) await this.postRequest<void>(child, 'shutdown')
          } catch {
            /* Early process exit still counts as successful cleanup. */
          }
          await exited
        })(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 2000)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (didExit) return
    try {
      child.kill()
    } catch {
      /* Require confirmed exit below. */
    }
    try {
      await Promise.race([
        exited,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Documents worker did not exit.')), 1000)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

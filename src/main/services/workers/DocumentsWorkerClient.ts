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
  // OCR progress listeners keyed by documentId. DocumentService registers one
  // around each parseAndChunk call so it can forward progress onto that doc's
  // indexing:progress IPC stream.
  private ocrListeners = new Map<number, (done: number, total: number) => void>()
  private beforeQuitRegistered = false

  registerOcrProgress(documentId: number, cb: (done: number, total: number) => void): () => void {
    this.ocrListeners.set(documentId, cb)
    return () => this.ocrListeners.delete(documentId)
  }

  private async ensureChild(): Promise<UtilityProcess> {
    if (this.child) return this.child
    if (this.spawnPromise) return this.spawnPromise
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
      child.on('message', (msg: DocWorkerResponse | DocWorkerPush) => this.dispatch(msg))
      child.on('exit', (code) => {
        const reason = `documents worker exited (code=${code ?? 'null'})`
        for (const p of this.pending.values()) p.reject(new Error(reason))
        this.pending.clear()
        this.ocrListeners.clear()
        this.child = null
        this.spawnPromise = null
      })
      this.child = child
      // Kill the worker on app quit so it doesn't outlive main. Register ONCE.
      if (!this.beforeQuitRegistered) {
        this.beforeQuitRegistered = true
        app.once('before-quit', () => {
          void this.shutdown().catch(() => undefined)
        })
      }
      return child
    })()
    try {
      return await this.spawnPromise
    } finally {
      this.spawnPromise = null
    }
  }

  private dispatch(msg: DocWorkerResponse | DocWorkerPush): void {
    const m = (msg as unknown as { data?: DocWorkerResponse | DocWorkerPush }).data ?? msg
    if (m && typeof m === 'object' && 'ev' in m) {
      this.handlePush(m)
      return
    }
    if (!m || typeof m !== 'object' || typeof (m as { id?: unknown }).id !== 'number') {
      // eslint-disable-next-line no-console
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
    switch (ev.ev) {
      case 'ocr': {
        if (ev.documentId != null) this.ocrListeners.get(ev.documentId)?.(ev.done, ev.total)
        return
      }
      case 'log':
        // eslint-disable-next-line no-console
        console[ev.level === 'error' ? 'error' : ev.level === 'warn' ? 'warn' : 'log'](
          `[documentsWorker] ${ev.message}`,
        )
        return
    }
  }

  private async send<T>(op: DocWorkerRequest['op'], payload?: unknown): Promise<T> {
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

  parseAndChunk(p: ParseAndChunkPayload): Promise<ParseAndChunkResult> {
    return this.send<ParseAndChunkResult>('documents.parseAndChunk', p)
  }

  async shutdown(): Promise<void> {
    if (!this.child) return
    try {
      await Promise.race([
        this.send<void>('shutdown'),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ])
    } catch {
      /* ignore — we're killing the worker anyway */
    }
    try {
      this.child.kill()
    } catch {
      /* ignore */
    }
    this.child = null
  }
}

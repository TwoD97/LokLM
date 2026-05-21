import { utilityProcess, app, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type {
  ServiceKind,
  WorkerRequest,
  WorkerResponse,
  WorkerPush,
  LlmLoadPayload,
  LlmAskPayload,
  LlmGenerateRawPayload,
  EmbedderLoadPayload,
  RerankerLoadPayload,
  LlmLoadResult,
  EmbedderLoadResult,
  RerankerLoadResult,
} from './protocol'
import type { ModelStatus, EmbedderStatus, RerankerStatus } from '../../../shared/documents'
import type { SystemResources } from '../embeddings/ResourcePlanner'

type StatusListener = {
  llm: (s: Partial<ModelStatus>) => void
  embedder: (s: Partial<EmbedderStatus>) => void
  reranker: (s: Partial<RerankerStatus>) => void
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

/**
 * Main-side wrapper around the modelsWorker utilityProcess. Spawns the worker
 * lazily on first use, multiplexes request/response by id, fans out status and
 * token push events to subscribers. One instance is shared by LlamaService /
 * EmbeddingService / RerankerService (and lives for the lifetime of the app).
 */
export class ModelsWorkerClient {
  private child: UtilityProcess | null = null
  private spawnPromise: Promise<UtilityProcess> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private statusListeners: StatusListener = {
    llm: () => {},
    embedder: () => {},
    reranker: () => {},
  }
  private tokenListeners = new Map<string, (text: string) => void>()

  setStatusListener<K extends ServiceKind>(kind: K, cb: StatusListener[K]): void {
    this.statusListeners[kind] = cb as StatusListener[K]
  }

  registerStream(streamId: string, onToken: (text: string) => void): () => void {
    this.tokenListeners.set(streamId, onToken)
    return () => this.tokenListeners.delete(streamId)
  }

  private async ensureChild(): Promise<UtilityProcess> {
    if (this.child) return this.child
    if (this.spawnPromise) return this.spawnPromise
    this.spawnPromise = (async () => {
      // The worker bundle sits next to the compiled main entry — see the
      // additional rollup input in electron.vite.config.ts.
      // __dirname is set by electron-vite for ESM main builds and points at
      // out/main at runtime.
      const workerPath = join(__dirname, 'modelsWorker.js')
      const child = utilityProcess.fork(workerPath, [], {
        // Inherit stdio so worker `console.warn` lands in the same terminal as
        // main during dev; in production this just goes nowhere harmless.
        stdio: 'inherit',
        serviceName: 'loklm-models',
      })
      await new Promise<void>((resolve, reject) => {
        const onSpawn = (): void => {
          child.removeListener('exit', onExit)
          resolve()
        }
        const onExit = (code: number | null): void => {
          child.removeListener('spawn', onSpawn)
          reject(new Error(`models worker exited before spawn (code=${code ?? 'null'})`))
        }
        child.once('spawn', onSpawn)
        child.once('exit', onExit)
      })
      child.on('message', (msg: WorkerResponse | WorkerPush) => this.dispatch(msg))
      child.on('exit', (code) => {
        const reason = `models worker exited (code=${code ?? 'null'})`
        for (const p of this.pending.values()) p.reject(new Error(reason))
        this.pending.clear()
        this.child = null
        this.spawnPromise = null
      })
      this.child = child
      // Kill the worker on app quit so it doesn't survive the main process and
      // leak the GPU context. before-quit fires early enough to give the worker
      // a chance to dispose the models cleanly via the shutdown op.
      app.once('before-quit', () => {
        void this.shutdown().catch(() => undefined)
      })
      return child
    })()
    try {
      return await this.spawnPromise
    } finally {
      // Keep spawnPromise around only while the worker is alive — once we have
      // `this.child`, the early-return at the top of this method handles reuse.
      this.spawnPromise = null
    }
  }

  private dispatch(msg: WorkerResponse | WorkerPush): void {
    // utilityProcess in some Electron versions wraps messages in { data: … }.
    const m = (msg as unknown as { data?: WorkerResponse | WorkerPush }).data ?? msg
    if ('ev' in m) {
      this.handlePush(m)
      return
    }
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    if (m.ok) p.resolve(m.result)
    else p.reject(new Error(m.error))
  }

  private handlePush(ev: WorkerPush): void {
    switch (ev.ev) {
      case 'status':
        this.statusListeners[ev.service](ev.status as never)
        return
      case 'token': {
        const cb = this.tokenListeners.get(ev.streamId)
        if (cb) cb(ev.text)
        return
      }
      case 'log':
        // eslint-disable-next-line no-console
        console[ev.level === 'error' ? 'error' : ev.level === 'warn' ? 'warn' : 'log'](
          `[modelsWorker] ${ev.message}`,
        )
        return
    }
  }

  private async send<T>(op: WorkerRequest['op'], payload?: unknown): Promise<T> {
    const child = await this.ensureChild()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      })
      try {
        child.postMessage(payload === undefined ? { id, op } : { id, op, payload })
      } catch (err) {
        this.pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  // ---- llm ---------------------------------------------------------------

  llmLoad(p: LlmLoadPayload): Promise<LlmLoadResult> {
    return this.send<LlmLoadResult>('llm.load', p)
  }
  llmUnload(): Promise<void> {
    return this.send<void>('llm.unload')
  }
  llmSetLanguage(lang: 'de' | 'en', systemPrompt: string): Promise<void> {
    return this.send<void>('llm.setLanguage', { lang, systemPrompt })
  }
  llmAsk(p: LlmAskPayload): Promise<{ raw: string }> {
    return this.send<{ raw: string }>('llm.ask', p)
  }
  llmGenerateRaw(p: LlmGenerateRawPayload): Promise<{ raw: string }> {
    return this.send<{ raw: string }>('llm.generateRaw', p)
  }
  llmAbort(streamId: string): Promise<void> {
    return this.send<void>('llm.abort', { streamId })
  }

  // ---- embedder ----------------------------------------------------------

  embedderLoad(p: EmbedderLoadPayload): Promise<EmbedderLoadResult> {
    return this.send<EmbedderLoadResult>('embedder.load', p)
  }
  embedderUnload(): Promise<void> {
    return this.send<void>('embedder.unload')
  }
  embedderEmbed(texts: string[]): Promise<Array<number[] | null>> {
    return this.send<Array<number[] | null>>('embedder.embed', { texts })
  }

  // ---- reranker ----------------------------------------------------------

  rerankerLoad(p: RerankerLoadPayload): Promise<RerankerLoadResult> {
    return this.send<RerankerLoadResult>('reranker.load', p)
  }
  rerankerUnload(): Promise<void> {
    return this.send<void>('reranker.unload')
  }
  rerankerRank(query: string, documents: string[]): Promise<number[] | null> {
    return this.send<number[] | null>('reranker.rank', { query, documents })
  }

  // ---- misc --------------------------------------------------------------

  refreshResources(): Promise<SystemResources> {
    return this.send<SystemResources>('planner.refresh')
  }

  async shutdown(): Promise<void> {
    if (!this.child) return
    try {
      await Promise.race([
        this.send<void>('shutdown'),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ])
    } catch {
      /* ignore , we're killing the worker anyway */
    }
    try {
      this.child.kill()
    } catch {
      /* ignore */
    }
    this.child = null
  }
}

import { utilityProcess, app, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { GpuWorkCoordinator } from './GpuWorkCoordinator'
import type { IndexingJob, IndexingLease, ModelActivity } from '../../../shared/modelActivity'
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
import type { SystemResources, LlmDevicePlan } from '../embeddings/ResourcePlanner'
import { QualifiedGpuLayerPlanHints, gpuLayerPlanReuseEnabled } from './modelMemory'

type StatusListener = {
  llm: (s: Partial<ModelStatus>) => void
  embedder: (s: Partial<EmbedderStatus>) => void
  reranker: (s: Partial<RerankerStatus>) => void
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  /** The worker op this request carries — surfaced in the crash log so a
   *  native worker exit tells us which native call was in flight (and whether
   *  more than one was, i.e. concurrent inference on the shared session). */
  op: WorkerRequest['op']
}

/**
 * Main-side wrapper around the modelsWorker utilityProcess. Spawns the worker
 * lazily on first use, multiplexes request/response by id, fans out status and
 * token push events to subscribers. One instance is shared by LlamaService /
 * EmbeddingService / RerankerService (and lives for the lifetime of the app).
 */
export class ModelsWorkerClient {
  // Unlike native/KV state, these bounded numeric hints are safe across locks.
  private readonly gpuLayerPlanHints = new QualifiedGpuLayerPlanHints()
  private sessionEpoch = 0
  private sessionSuspended = false
  private sessionResetPromise: Promise<void> | null = null
  private sessionResetError: Error | null = null
  private backgroundStreams = new Set<string>()

  private cancelBackgroundWork(): void {
    for (const streamId of this.backgroundStreams) {
      this.backgroundStreams.delete(streamId)
      void this.llmAbort(streamId).catch(() => undefined)
    }
  }
  private llmLoadListener: ((result: LlmLoadResult) => void) | null = null
  setLlmLoadListener(listener: (result: LlmLoadResult) => void): void {
    this.llmLoadListener = listener
  }
  private activityListeners = new Set<(activity: ModelActivity) => void>()
  private latestResources: Pick<SystemResources, 'hasGpu' | 'totalVramGB'> | null = null
  private gpuWork = new GpuWorkCoordinator(
    () => this.send<void>('gpu.restoreChat'),
    (activity) => {
      for (const listener of this.activityListeners) listener(activity)
    },
    () => {
      const resources = this.latestResources
      // Match the worker's one-model-at-a-time policy using the actual selected
      // device, not its label, free VRAM, or the machine's system RAM.
      return !(
        resources?.hasGpu &&
        Number.isFinite(resources.totalVramGB) &&
        resources.totalVramGB > 0 &&
        resources.totalVramGB <= 6
      )
    },
  )

  activity(): ModelActivity {
    return this.gpuWork.status()
  }
  onActivity(listener: (activity: ModelActivity) => void): () => void {
    this.activityListeners.add(listener)
    return () => {
      this.activityListeners.delete(listener)
    }
  }
  beginIndexing(job: Omit<IndexingJob, 'done' | 'total'>): IndexingLease {
    this.assertSession(this.sessionEpoch)
    this.cancelBackgroundWork()
    return this.gpuWork.acquire(job)
  }
  async restoreChat(signal?: AbortSignal): Promise<void> {
    const epoch = this.sessionEpoch
    this.assertSession(epoch)
    signal?.throwIfAborted()
    await this.gpuWork.waitForChat(signal)
    this.assertSession(epoch)
    signal?.throwIfAborted()
    await this.send<void>('gpu.restoreChat')
    this.assertSession(epoch)
    signal?.throwIfAborted()
  }
  private child: UtilityProcess | null = null
  private spawnPromise: Promise<UtilityProcess> | null = null
  private restartPromise: Promise<void> | null = null
  private shutdownPromise: Promise<void> | null = null
  private generations = new Map<string, { controller: AbortController; dispatched: boolean }>()
  private nextId = 1
  private pending = new Map<number, Pending>()
  private statusListeners: StatusListener = {
    llm: () => {},
    embedder: () => {},
    reranker: () => {},
  }
  // Token listener signature carries `count` so callers can reflect the
  // number of native onTextChunk callbacks coalesced into one batched push
  // (see modelsWorker's bufferToken). Single-chunk pushes pass count=1.
  private tokenListeners = new Map<string, (text: string, count: number) => void>()
  private beforeQuitRegistered = false
  /** Set during shutdown() so the long-lived exit handler can tell an
   *  intentional quit from a crash (only the latter fires the status reset). */
  private shuttingDown = false
  /** Resolved LLM device plan. Its visible-device env vars must be in place
   *  BEFORE the worker's first getLlama (the backend singleton latches the
   *  device on first init), so they're baked into the spawn env here rather than
   *  pushed at load time. Changing the physical device → restart the worker. */
  private devicePlan: LlmDevicePlan | null = null

  setStatusListener<K extends ServiceKind>(kind: K, cb: StatusListener[K]): void {
    this.statusListeners[kind] = cb as StatusListener[K]
  }

  registerStream(streamId: string, onToken: (text: string, count: number) => void): () => void {
    this.tokenListeners.set(streamId, onToken)
    return () => {
      if (this.tokenListeners.get(streamId) === onToken) this.tokenListeners.delete(streamId)
    }
  }

  private async ensureChild(): Promise<UtilityProcess> {
    const epoch = this.sessionEpoch
    this.assertSession(epoch)
    if (this.restartPromise) await this.restartPromise
    this.assertSession(epoch)
    if (this.shuttingDown) throw new Error('Models worker is shutting down.')
    if (this.spawnPromise) return this.spawnPromise
    if (this.child) return this.child
    // Register before spawning: quitting during the first spawn must also
    // stop that process. Keep one listener across any subsequent respawns.
    if (!this.beforeQuitRegistered) {
      this.beforeQuitRegistered = true
      app.once('before-quit', () => {
        void this.shutdown().catch(() => undefined)
      })
    }
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
        // Bake the resolved GPU device into the worker env: LOKLM_PRIMARY_BACKEND
        // seeds the getLlama backend order and CUDA/GGML_VK_VISIBLE_DEVICES pin
        // the physical device — both must exist before the worker's first
        // getLlama call, hence spawn-time rather than load-time.
        env: this.deviceEnv(),
      })
      // Own the process immediately, including while Electron is spawning it,
      // so shutdown/device changes cannot leave a late worker orphaned.
      this.child = child
      child.on('message', (msg: WorkerResponse | WorkerPush) => {
        if (this.child === child) this.dispatch(msg)
      })
      child.on('exit', (code) => {
        if (this.child !== child) return
        const reason = `models worker exited (code=${code ?? 'null'})`
        this.latestResources = null
        this.gpuWork.reset(this.shuttingDown ? undefined : reason, this.shuttingDown)
        // A non-graceful exit is a native crash — log the code + which ops were
        // in flight so support can tell a concurrent-inference fault (2+ ops on
        // the shared session) from a single-call segfault. code 3221225477 is
        // 0xC0000005 (Windows access violation) inside node-llama-cpp.
        if (!this.shuttingDown) {
          const inFlight = [...this.pending.values()].map((p) => p.op)
          console.error(
            `[modelsWorkerClient] ${reason}; in-flight ops: ${inFlight.join(', ') || '(none)'}`,
          )
        }
        for (const p of this.pending.values()) p.reject(new Error(reason))
        this.pending.clear()
        // Token streams that were in flight have no way to drain — drop their
        // listeners so a stale callback isn't held by a long-running renderer.
        this.tokenListeners.clear()
        this.backgroundStreams.clear()
        this.child = null
        this.spawnPromise = null
        // Crash recovery: tell every service the worker is gone so the UI
        // reflects reality (otherwise the chat header still says "Ready" and
        // the next ask attempt produces a stale-looking error). Skipped on a
        // graceful shutdown() , the renderer already knows the app is closing.
        if (!this.shuttingDown) {
          const failedMsg = `Worker crashed (${reason}). The next request will respawn it.`
          this.statusListeners.llm({ state: 'unloaded', loadProgress: null, message: failedMsg })
          this.statusListeners.embedder({
            state: 'unloaded',
            loadProgress: null,
            message: failedMsg,
          })
          this.statusListeners.reranker({
            state: 'unloaded',
            loadProgress: null,
            message: failedMsg,
          })
        }
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
      return child
    })()
    const spawning = this.spawnPromise
    try {
      return await spawning
    } finally {
      // Keep spawnPromise around only while the worker is alive — once we have
      // `this.child`, the early-return at the top of this method handles reuse.
      if (this.spawnPromise === spawning) this.spawnPromise = null
    }
  }

  private dispatch(msg: WorkerResponse | WorkerPush): void {
    // utilityProcess in some Electron versions wraps messages in { data: … }.
    const m = (msg as unknown as { data?: WorkerResponse | WorkerPush }).data ?? msg
    if (m && typeof m === 'object' && 'ev' in m) {
      this.handlePush(m)
      return
    }
    // Reject malformed messages explicitly. A future renderer/worker version
    // could ship a message shape this main doesn't recognise — without the
    // typeof guard, the lookup `pending.get(undefined)` returns null and the
    // matching request hangs forever.
    if (!m || typeof m !== 'object' || typeof (m as { id?: unknown }).id !== 'number') {
      console.warn('[modelsWorkerClient] dropped malformed worker message', m)
      return
    }
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    if (m.ok) {
      if (p.op === 'llm.load') this.recordLayerPlanHint(m.result)
      if (p.op === 'planner.refresh') this.recordResources(m.result)
      else if (p.op === 'llm.load' || p.op === 'embedder.load' || p.op === 'reranker.load')
        this.recordResources((m.result as { resources?: SystemResources } | null)?.resources)
      p.resolve(m.result)
    } else p.reject(new Error(m.error))
  }

  private recordResources(value: unknown): void {
    const resources = value as Partial<SystemResources> | null | undefined
    this.latestResources =
      typeof resources?.hasGpu === 'boolean' && typeof resources.totalVramGB === 'number'
        ? { hasGpu: resources.hasGpu, totalVramGB: resources.totalVramGB }
        : null
  }

  private recordLayerPlanHint(value: unknown): void {
    if (
      this.sessionSuspended ||
      !gpuLayerPlanReuseEnabled(process.env['LOKLM_REUSE_GPU_LAYER_PLAN'])
    )
      return
    this.gpuLayerPlanHints.remember((value as Partial<LlmLoadResult> | null)?.gpuLayerPlanHint)
  }

  private handlePush(ev: WorkerPush): void {
    // Retired workers may still flush tokens/load notifications while draining.
    // None may repopulate a locked service's status or private stream listeners.
    if (this.sessionSuspended) return
    switch (ev.ev) {
      case 'llm.loaded':
        this.recordLayerPlanHint(ev.result)
        this.recordResources(ev.result.resources)
        this.llmLoadListener?.(ev.result)
        return
      case 'activity':
        this.gpuWork.setTransition(ev.activity)
        return
      case 'status':
        this.statusListeners[ev.service](ev.status as never)
        return
      case 'token': {
        const cb = this.tokenListeners.get(ev.streamId)
        if (cb) cb(ev.text, ev.count ?? 1)
        return
      }
      case 'log':
        console[ev.level === 'error' ? 'error' : ev.level === 'warn' ? 'warn' : 'log'](
          `[modelsWorker] ${ev.message}`,
        )
        return
    }
  }

  private async send<T>(
    op: WorkerRequest['op'],
    payload?: unknown,
    generation?: { controller: AbortController; dispatched: boolean },
  ): Promise<T> {
    const epoch = this.sessionEpoch
    this.assertSession(epoch)
    generation?.controller.signal.throwIfAborted()
    // Native work is FIFO in the worker. Abort an optional title before adding
    // user work to that queue, including the first embedding of a chat query.
    if (
      op === 'llm.ask' ||
      (op === 'llm.generateRaw' && !(payload as LlmGenerateRawPayload).background) ||
      op === 'llm.load' ||
      op === 'llm.unload' ||
      op === 'embedder.load' ||
      op === 'embedder.embed' ||
      op === 'reranker.load' ||
      op === 'reranker.rank' ||
      op === 'gpu.restoreChat'
    )
      this.cancelBackgroundWork()
    if (
      op === 'llm.load' ||
      op === 'llm.ask' ||
      op === 'llm.generateRaw' ||
      op === 'reranker.load' ||
      op === 'reranker.rank'
    )
      await this.gpuWork.waitForChat(generation?.controller.signal)
    this.assertSession(epoch)
    const child = await this.ensureChild()
    this.assertSession(epoch)
    generation?.controller.signal.throwIfAborted()
    if (this.shuttingDown || this.child !== child)
      throw new Error('Models worker is shutting down.')
    if (generation) generation.dispatched = true
    return this.postRequest<T>(child, op, payload)
  }

  private postRequest<T>(
    child: UtilityProcess,
    op: WorkerRequest['op'],
    payload?: unknown,
  ): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        op,
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
    const hints = gpuLayerPlanReuseEnabled(process.env['LOKLM_REUSE_GPU_LAYER_PLAN'])
      ? this.gpuLayerPlanHints.snapshot()
      : []
    return this.send<LlmLoadResult>('llm.load', { ...p, gpuLayerPlanHints: hints })
  }
  llmUnload(): Promise<void> {
    return this.send<void>('llm.unload')
  }
  llmSetLanguage(lang: 'de' | 'en', systemPrompt: string): Promise<void> {
    return this.send<void>('llm.setLanguage', { lang, systemPrompt })
  }
  llmAsk(p: LlmAskPayload): Promise<{ raw: string }> {
    return this.sendGeneration('llm.ask', p)
  }
  async llmGenerateRaw(p: LlmGenerateRawPayload): Promise<{ raw: string }> {
    if (!p.background) return this.sendGeneration('llm.generateRaw', p)
    if (this.backgroundStreams.size || this.pending.size || this.activity().phase !== 'idle')
      throw new Error('Background generation skipped: the model is busy.')
    this.backgroundStreams.add(p.streamId)
    try {
      return await this.sendGeneration('llm.generateRaw', p)
    } finally {
      this.backgroundStreams.delete(p.streamId)
    }
  }
  llmAbort(streamId: string): Promise<void> {
    const generation = this.generations.get(streamId)
    if (!generation) return Promise.resolve()
    generation.controller.abort()
    // A waiting request has not reached native code. Cancelling it must not
    // spawn a worker or leave a tombstone for a request that will never arrive.
    return generation.dispatched && this.child
      ? this.postRequest<void>(this.child, 'llm.abort', { streamId })
      : Promise.resolve()
  }

  private async sendGeneration(
    op: 'llm.ask' | 'llm.generateRaw',
    payload: LlmAskPayload | LlmGenerateRawPayload,
  ): Promise<{ raw: string }> {
    if (this.generations.has(payload.streamId))
      throw new Error('A generation with this stream ID is already running.')
    const generation = { controller: new AbortController(), dispatched: false }
    this.generations.set(payload.streamId, generation)
    try {
      const result = await this.send<{ raw: string }>(op, payload, generation)
      generation.controller.signal.throwIfAborted()
      return result
    } finally {
      if (this.generations.get(payload.streamId) === generation)
        this.generations.delete(payload.streamId)
    }
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

  private assertSession(epoch: number): void {
    if (this.sessionSuspended || epoch !== this.sessionEpoch)
      throw new Error('Model session is closed.')
  }

  /** A vault lock must release native KV, private payloads and worker heaps,
   *  not merely reset the public chat-history array. Admission stays closed
   *  until the next session explicitly resumes after this bounded teardown. */
  resetSession(): Promise<void> {
    if (this.sessionResetPromise) return this.sessionResetPromise
    if (this.sessionSuspended) {
      if (!this.sessionResetError) return Promise.resolve()
      // Keep a failed stop observable on repeated lock hooks. Only an actual
      // later exit permits a new teardown attempt to reconcile the state.
      if (this.child || this.spawnPromise) return Promise.reject(this.sessionResetError)
    }
    this.sessionEpoch++
    this.sessionSuspended = true
    const error = new Error('Model session is closed.')
    for (const generation of this.generations.values()) generation.controller.abort(error)
    this.generations.clear()
    this.tokenListeners.clear()
    this.backgroundStreams.clear()
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    this.latestResources = null
    this.gpuWork.reset(undefined, true)
    this.publishUnloaded()
    const resetting = (this.shutdownPromise ?? this.restart()).then(
      () => {
        this.sessionResetError = null
      },
      (error: unknown) => {
        this.sessionResetError = error instanceof Error ? error : new Error(String(error))
        throw this.sessionResetError
      },
    )
    this.sessionResetPromise = resetting
    void resetting
      .finally(() => {
        if (this.sessionResetPromise === resetting) this.sessionResetPromise = null
      })
      .catch(() => undefined)
    return resetting
  }

  resumeSession(): void {
    if (
      this.sessionResetPromise ||
      this.sessionResetError ||
      this.shuttingDown ||
      this.shutdownPromise
    )
      throw new Error('Models worker session cleanup is not complete.')
    if (!this.sessionSuspended) return
    this.sessionSuspended = false
    this.gpuWork.reset()
  }

  private publishUnloaded(): void {
    const patch = { state: 'unloaded' as const, resident: false, loadProgress: null, message: null }
    this.statusListeners.llm(patch)
    this.statusListeners.embedder(patch)
    this.statusListeners.reranker(patch)
  }

  refreshResources(): Promise<SystemResources> {
    return this.send<SystemResources>('planner.refresh')
  }

  /**
   * Set the resolved LLM device plan. The pin lives in the worker's spawn env,
   * so if the PHYSICAL device changed and a worker is already running we restart
   * it — the next request respawns with the new env. Backend-family-or-pin
   * changes (not just the user's label) are what trigger a restart; an
   * equivalent plan is a no-op. Returns true when a restart happened.
   */
  async setDevicePlan(plan: LlmDevicePlan): Promise<boolean> {
    const epoch = this.sessionEpoch
    this.assertSession(epoch)
    await this.gpuWork.waitForChat()
    this.assertSession(epoch)
    const changed = !devicePlansEquivalent(this.devicePlan, plan)
    this.devicePlan = plan
    if (changed) this.latestResources = null
    if (changed && (this.child || this.spawnPromise)) {
      await this.restart()
      return true
    }
    if (this.restartPromise) await this.restartPromise
    return false
  }

  /** Build the worker spawn env from the current device plan (inherits the
   *  parent env, then overlays the backend selector + device pins). */
  private deviceEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env }
    const plan = this.devicePlan
    if (!plan) return env
    env['LOKLM_PRIMARY_BACKEND'] = plan.backend
    if (plan.cudaVisibleDevices != null) {
      env['CUDA_VISIBLE_DEVICES'] = plan.cudaVisibleDevices
      // Stable indexing so CUDA_VISIBLE_DEVICES refers to the PCI order, not the
      // perf-sorted default that can renumber across reboots.
      env['CUDA_DEVICE_ORDER'] = 'PCI_BUS_ID'
    }
    if (plan.ggmlVkVisibleDevices != null) {
      env['GGML_VK_VISIBLE_DEVICES'] = plan.ggmlVkVisibleDevices
    }
    return env
  }

  /** Cleanly stop the worker so the next request respawns it (with a fresh
   *  device env). Unlike shutdown(), the client stays usable afterwards. */
  private async restart(): Promise<void> {
    if (this.restartPromise) return this.restartPromise
    this.restartPromise = (async () => {
      this.shuttingDown = true
      await this.stopChild()
      // A concurrent application shutdown is permanent, unlike a device switch.
      if (this.shutdownPromise) return
      this.shuttingDown = false
      this.gpuWork.reset(undefined, this.sessionSuspended)
      this.publishUnloaded()
    })()
    try {
      await this.restartPromise
    } finally {
      this.restartPromise = null
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shuttingDown = true
    this.gpuWork.reset(undefined, true)
    this.shutdownPromise = this.restartPromise ?? this.stopChild()
    return this.shutdownPromise
  }

  private async stopChild(): Promise<void> {
    const previous = this.child
    if (!previous) return
    const spawning = this.spawnPromise
    let didExit = false
    let onExit: () => void
    const exited = new Promise<void>((resolve) => {
      onExit = () => {
        didExit = true
        resolve()
      }
      previous.once('exit', onExit)
    })
    let terminating = false
    const terminate = (): void => {
      if (didExit || this.child !== previous) return
      try {
        previous.kill()
      } catch {
        /* Only the exit event confirms cleanup, including when kill throws. */
      }
    }
    // Retain ownership of an in-progress spawn even if this bounded stop fails.
    // kill() before Electron assigns a pid returns false; a late spawn must then
    // be terminated, not receive a stale graceful request that can hang again.
    void (async () => {
      try {
        if (spawning) await spawning
        if (this.child !== previous) return
        if (terminating) terminate()
        else await this.postRequest<void>(previous, 'shutdown')
      } catch {
        /* An early exit or broken IPC still proceeds to process cleanup. */
      }
    })()
    const waitForExit = async (milliseconds: number): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          exited,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, milliseconds)
          }),
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
    try {
      await waitForExit(2_000)
      if (didExit) return
      terminating = true
      terminate()
      // Electron 42's Chromium termination fallback itself waits 2 s. Allow
      // that plus exit-event delivery; kill acceptance alone is not success.
      await waitForExit(5_000)
      if (!didExit) throw new Error('Models worker did not exit.')
    } finally {
      previous.removeListener('exit', onExit!)
    }
  }
}

/** Two device plans are equivalent if they pin the same physical device the
 *  same way — only the spawn-env-affecting fields matter (the user's `choice`
 *  label does not, so flipping Auto↔Dedicated that resolve to the same card
 *  doesn't pay a worker restart). */
function devicePlansEquivalent(a: LlmDevicePlan | null, b: LlmDevicePlan | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.backend === b.backend &&
    a.cudaVisibleDevices === b.cudaVisibleDevices &&
    a.ggmlVkVisibleDevices === b.ggmlVkVisibleDevices
  )
}

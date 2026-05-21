// Worker that owns every node-llama-cpp handle (LLM + embedder + reranker).
// Spawned via utilityProcess.fork from main/index.ts so heavy native init
// (CUDA context, mmap, layer offload) never blocks the main event loop and
// Windows' watchdog never gets a chance to pop "Not Responding".
//
// Communication is via process.parentPort: requests come in with a numeric
// id, the worker replies with exactly one response carrying that id. Status
// updates and token chunks are pushed without an id and the main side just
// fans them out to subscribers.
//
// All three services share one Llama backend instance (singleton inside
// node-llama-cpp). A FIFO mutex serialises the heavy `loadModel` calls so a
// concurrent ask never overlaps a load. Inference (embed / rank / ask) is
// async at the native layer and can interleave freely between requests.

import { ResourcePlanner, ggufWeightBytes } from '../embeddings/ResourcePlanner'
import type { KvCacheType, SystemResources } from '../embeddings/ResourcePlanner'
import type {
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

// utilityProcess provides process.parentPort with postMessage / on('message').
declare const process: NodeJS.Process & {
  parentPort: {
    postMessage: (msg: unknown) => void
    on: (ev: 'message', cb: (msg: WorkerRequest) => void) => void
  }
}

const planner = new ResourcePlanner()

// ---- shared state for the three services ----------------------------------

let llamaBackend: unknown = null
let backendGpuLabel: string | null = null

let llmModel: unknown = null
let llmContext: unknown = null
let llmSession: unknown = null
let llmLanguage: 'de' | 'en' = 'de'

let embedderModel: unknown = null
let embedderContext: unknown = null

let rerankerModel: unknown = null
let rerankerContext: unknown = null

// Canonical system prompt is built on the main side from prompt.ts and shipped
// in via llm.load / llm.setLanguage. Stash the latest one so we can re-seed
// the chat session on language changes without going back to main.
let llmSystemPrompt = ''

// Active AbortControllers keyed by streamId so an `llm.abort` request can cancel
// the right in-flight `session.prompt`.
const activeAborts = new Map<string, AbortController>()

// ---- mutex for load operations --------------------------------------------

let loadTail: Promise<void> = Promise.resolve()
async function withLoadLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = loadTail
  let release: () => void = () => {}
  loadTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

// ---- protocol helpers -----------------------------------------------------

function send(msg: WorkerResponse | WorkerPush): void {
  process.parentPort.postMessage(msg)
}

function reply<T>(id: number, result: T): void {
  const r: WorkerResponse<T> = { id, ok: true, result }
  send(r)
}

function fail(id: number, err: unknown): void {
  const r: WorkerResponse = {
    id,
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  }
  send(r)
}

function pushStatus(
  service: 'llm' | 'embedder' | 'reranker',
  status: Record<string, unknown>,
): void {
  send({ ev: 'status', service, status } as WorkerPush)
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  send({ ev: 'log', level, message })
}

// ---- llama backend init (idempotent across all three services) ------------

async function ensureBackend(
  forceCpu: boolean,
  onMessage: (msg: string) => void,
): Promise<unknown> {
  if (llamaBackend) return llamaBackend
  const lib = await import('node-llama-cpp')
  const pinned = (process.env['LLAMA_GPU'] ?? '').toLowerCase()
  type Gpu = 'cuda' | 'vulkan' | 'metal' | 'auto' | false
  const order: Gpu[] = (() => {
    if (pinned === 'cpu' || pinned === 'false') return [false]
    if (pinned === 'cuda' || pinned === 'vulkan' || pinned === 'metal') return [pinned, 'auto']
    if (forceCpu) return [false]
    return ['auto']
  })()
  let lastErr: unknown = null
  for (const gpu of order) {
    try {
      onMessage(`Initialising llama backend (${gpu === false ? 'cpu' : gpu})…`)
      const llama = await lib.getLlama({ gpu })
      llamaBackend = llama
      const obj = llama as { gpu?: string | false }
      backendGpuLabel = obj.gpu === false ? 'cpu' : (obj.gpu ?? null) || null
      // Wire the planner to reuse the same backend instance so its VRAM probe
      // doesn't init a second time.
      ;(planner as unknown as { llamaProbe: unknown }).llamaProbe = llama
      return llama
    } catch (err) {
      lastErr = err
      log('warn', `${gpu} init failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw lastErr ?? new Error('No backend could be initialised')
}

function hasDispose(o: unknown): o is { dispose: () => Promise<void> } {
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof (o as { dispose?: unknown }).dispose === 'function'
  )
}

// ---- LLM ------------------------------------------------------------------

async function llmLoad(payload: LlmLoadPayload): Promise<LlmLoadResult> {
  await llmUnloadInternal()
  llmLanguage = payload.language
  llmSystemPrompt = payload.systemPrompt
  pushStatus('llm', {
    state: 'loading',
    modelPath: payload.modelPath,
    modelName: payload.modelPath.split(/[\\/]/).pop() ?? 'unknown.gguf',
    profile: payload.profileName,
    loadProgress: 0,
    message: 'Initialising llama backend…',
    gpu: null,
  })
  const lib = await import('node-llama-cpp')
  const llama = await ensureBackend(false, (msg) => pushStatus('llm', { message: msg }))
  pushStatus('llm', { gpu: backendGpuLabel, message: 'Loading model weights…' })

  // Probe resources BEFORE the weights allocate so planLlm's freeVram math
  // doesn't double-count weights.
  const resources = await planner.refresh()
  const weightsBytes = payload.weightsBytes || ggufWeightBytes(payload.modelPath)

  const model = await (
    llama as {
      loadModel: (o: {
        modelPath: string
        onLoadProgress?: (p: number) => void
      }) => Promise<unknown>
    }
  ).loadModel({
    modelPath: payload.modelPath,
    onLoadProgress: (p: number) => pushStatus('llm', { loadProgress: p }),
  })

  // KV fallback loop , q4_0 → q8_0 → f16 with a shrinking max context.
  const userChoice =
    payload.envContextOverride != null ? payload.envContextOverride : payload.userContextChoice
  const initialPlan = planner.planLlm({
    profileName: payload.profileName ?? 'full',
    profileDefaultContext: payload.profileDefaultContext,
    weightsBytes,
    resources,
    userContextChoice: userChoice,
  })

  const fallbackOrder: KvCacheType[] = ['q4_0', 'q8_0', 'f16']
  const startIdx = fallbackOrder.indexOf(initialPlan.kvCacheType)
  const minCtxBound = 4096
  let maxCtxBound = Math.min(initialPlan.contextSize, payload.profileDefaultContext)
  let context: { getSequence: () => unknown } | null = null
  let activePlan = initialPlan

  const enumNameFor = (t: KvCacheType): 'Q8_0' | 'Q4_0' | null =>
    t === 'q8_0' ? 'Q8_0' : t === 'q4_0' ? 'Q4_0' : null

  for (let i = Math.max(0, startIdx); i < fallbackOrder.length; i++) {
    const attemptType = fallbackOrder[i]!
    const attemptPlan =
      i === startIdx
        ? initialPlan
        : planner.planLlm({
            profileName: payload.profileName ?? 'full',
            profileDefaultContext: maxCtxBound,
            weightsBytes,
            resources,
            userContextChoice: userChoice,
            forceKvType: attemptType,
          })
    const attemptMax = Math.min(attemptPlan.contextSize, maxCtxBound)
    const opts: Record<string, unknown> = {
      contextSize: { min: minCtxBound, max: attemptMax },
      flashAttention: true,
    }
    const kvEnum = enumNameFor(attemptType)
    if (kvEnum) {
      opts.experimentalKvCacheKeyType = kvEnum
      opts.experimentalKvCacheValueType = kvEnum
    }
    pushStatus('llm', {
      message: `Creating context (≤${attemptMax} tokens — ${attemptPlan.reason})…`,
      loadProgress: 1,
    })
    try {
      context = await (
        model as {
          createContext: (o: Record<string, unknown>) => Promise<{ getSequence: () => unknown }>
        }
      ).createContext(opts)
      activePlan = attemptPlan
      break
    } catch (err) {
      maxCtxBound = Math.max(minCtxBound, Math.floor(attemptMax / 2))
      log(
        'warn',
        `KV ${attemptType} ≤${attemptMax} rejected: ${err instanceof Error ? err.message : String(err)}`,
      )
      if (i === fallbackOrder.length - 1) break
    }
  }
  if (!context) {
    log('warn', 'all bounded attempts failed; falling back to auto context resolution')
    context = await (
      model as {
        createContext: (o: Record<string, unknown>) => Promise<{ getSequence: () => unknown }>
      }
    ).createContext({ contextSize: 'auto', flashAttention: true })
    activePlan = {
      ...initialPlan,
      kvCacheType: 'f16',
      reason: 'auto fallback after rejection chain',
    }
  }

  const session = new (lib as { LlamaChatSession: new (o: unknown) => unknown }).LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: llmSystemPrompt,
  })

  llmModel = model
  llmContext = context
  llmSession = session
  // Post-load resource snapshot so the dashboard sees the remaining free VRAM.
  let postResources = resources
  try {
    postResources = await planner.refresh()
  } catch {
    /* keep pre-load snapshot on probe failure */
  }
  pushStatus('llm', {
    state: 'ready',
    loadProgress: null,
    message: 'Ready.',
    gpu: backendGpuLabel,
  })
  return { plan: activePlan, resources: postResources, gpuLabel: backendGpuLabel }
}

async function llmUnloadInternal(): Promise<void> {
  try {
    if (llmSession && hasDispose(llmSession)) await llmSession.dispose()
    if (llmContext && hasDispose(llmContext)) await llmContext.dispose()
    if (llmModel && hasDispose(llmModel)) await llmModel.dispose()
  } catch {
    /* ignore */
  }
  llmSession = null
  llmContext = null
  llmModel = null
}

async function llmUnload(): Promise<void> {
  await llmUnloadInternal()
  pushStatus('llm', { state: 'unloaded', message: 'Model unloaded.' })
}

async function llmAsk(payload: LlmAskPayload): Promise<{ raw: string }> {
  if (!llmSession) throw new Error('Model is not loaded.')
  const session = llmSession as {
    prompt: (
      text: string,
      options: {
        onTextChunk?: (s: string) => void
        signal?: AbortSignal
        maxTokens?: number
      },
    ) => Promise<string>
    resetChatHistory?: () => void
  }
  try {
    session.resetChatHistory?.()
  } catch {
    /* best-effort */
  }
  const ctrl = new AbortController()
  activeAborts.set(payload.streamId, ctrl)
  try {
    const raw = await session.prompt(payload.prompt, {
      maxTokens: payload.maxTokens,
      signal: ctrl.signal,
      onTextChunk: (chunk: string) => {
        send({ ev: 'token', streamId: payload.streamId, text: chunk })
      },
    })
    return { raw }
  } finally {
    activeAborts.delete(payload.streamId)
  }
}

async function llmGenerateRaw(payload: LlmGenerateRawPayload): Promise<{ raw: string }> {
  if (!llmSession) throw new Error('Model is not loaded.')
  const session = llmSession as {
    prompt: (text: string, options: { signal?: AbortSignal }) => Promise<string>
    getChatHistory?: () => unknown[]
    setChatHistory?: (history: unknown[]) => void
    resetChatHistory?: () => void
  }
  const ctrl = new AbortController()
  activeAborts.set(payload.streamId, ctrl)
  let saved: unknown[] | undefined
  try {
    saved = session.getChatHistory?.()
  } catch {
    saved = undefined
  }
  try {
    session.resetChatHistory?.()
    const raw = await session.prompt(payload.prompt, { signal: ctrl.signal })
    return { raw }
  } finally {
    activeAborts.delete(payload.streamId)
    if (saved && session.setChatHistory) {
      try {
        session.setChatHistory(saved)
      } catch {
        /* drop history on restore failure */
      }
    }
  }
}

function llmSetLanguage(lang: 'de' | 'en', systemPrompt: string): void {
  llmLanguage = lang
  llmSystemPrompt = systemPrompt
  const session = llmSession as {
    getChatHistory?: () => Array<{ type: string; text?: string }>
    setChatHistory?: (h: Array<{ type: string; text?: string }>) => void
  } | null
  if (!session?.getChatHistory || !session.setChatHistory) return
  try {
    const history = session.getChatHistory()
    const next = history.map((h, i) =>
      i === 0 || h.type === 'system' ? { ...h, type: 'system', text: systemPrompt } : h,
    )
    session.setChatHistory(next)
  } catch {
    /* swallow */
  }
}

// ---- Embedder -------------------------------------------------------------

async function embedderLoad(payload: EmbedderLoadPayload): Promise<EmbedderLoadResult> {
  await embedderUnloadInternal()
  pushStatus('embedder', {
    state: 'loading',
    modelPath: payload.modelPath,
    modelName: payload.modelPath.split(/[\\/]/).pop() ?? 'embedder.gguf',
    loadProgress: 0,
    message: 'Initialising embedder backend…',
  })
  const resources = await planner.refresh()
  const plan = planner.planAux({
    weightsBytes: payload.weightsBytes,
    resources,
    userChoice: payload.placement,
    estimatedFreeVramGB: resources.freeVramGB,
  })
  const llama = await ensureBackend(plan.placement === 'cpu', (msg) =>
    pushStatus('embedder', { message: msg }),
  )
  pushStatus('embedder', {
    message: `Loading embedder weights (${plan.placement}: ${plan.reason})…`,
  })
  const model = await (
    llama as {
      loadModel: (o: {
        modelPath: string
        onLoadProgress?: (p: number) => void
      }) => Promise<unknown>
    }
  ).loadModel({
    modelPath: payload.modelPath,
    onLoadProgress: (p: number) => pushStatus('embedder', { loadProgress: p }),
  })
  pushStatus('embedder', { message: 'Creating embedding context…', loadProgress: 1 })
  const context = await (
    model as {
      createEmbeddingContext: (opts?: { contextSize?: number }) => Promise<unknown>
    }
  ).createEmbeddingContext({ contextSize: payload.contextSize })
  embedderModel = model
  embedderContext = context
  pushStatus('embedder', { state: 'ready', loadProgress: null, message: 'Embedder ready.' })
  let post: SystemResources = resources
  try {
    post = await planner.refresh()
  } catch {
    /* keep snapshot */
  }
  return { resources: post, resolvedPlacement: plan.placement, reason: plan.reason }
}

async function embedderUnloadInternal(): Promise<void> {
  try {
    if (embedderContext && hasDispose(embedderContext)) await embedderContext.dispose()
    if (embedderModel && hasDispose(embedderModel)) await embedderModel.dispose()
  } catch {
    /* ignore */
  }
  embedderContext = null
  embedderModel = null
}

async function embedderUnload(): Promise<void> {
  await embedderUnloadInternal()
  pushStatus('embedder', { state: 'unloaded', message: 'Embedder unloaded.' })
}

async function embedderEmbed(texts: string[]): Promise<Array<number[] | null>> {
  if (!embedderContext) throw new Error('Embedder is not loaded.')
  const ctx = embedderContext as {
    getEmbeddingFor: (text: string) => Promise<{ vector: Float32Array | number[] }>
  }
  const out: Array<number[] | null> = []
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]!
    if (t.length === 0) {
      out.push(null)
      continue
    }
    try {
      const r = await ctx.getEmbeddingFor(t)
      out.push(Array.from(r.vector))
    } catch (err) {
      log('warn', `embed passage #${i} failed: ${err instanceof Error ? err.message : String(err)}`)
      out.push(null)
    }
  }
  return out
}

// ---- Reranker -------------------------------------------------------------

async function rerankerLoad(payload: RerankerLoadPayload): Promise<RerankerLoadResult> {
  await rerankerUnloadInternal()
  pushStatus('reranker', {
    state: 'loading',
    modelPath: payload.modelPath,
    modelName: payload.modelPath.split(/[\\/]/).pop() ?? 'reranker.gguf',
    loadProgress: 0,
    message: 'Initialising reranker backend…',
  })
  const resources = await planner.refresh()
  const plan = planner.planAux({
    weightsBytes: payload.weightsBytes,
    resources,
    userChoice: payload.placement,
    estimatedFreeVramGB: resources.freeVramGB,
  })
  const llama = await ensureBackend(plan.placement === 'cpu', (msg) =>
    pushStatus('reranker', { message: msg }),
  )
  pushStatus('reranker', {
    message: `Loading reranker weights (${plan.placement}: ${plan.reason})…`,
  })
  const model = await (
    llama as {
      loadModel: (o: {
        modelPath: string
        onLoadProgress?: (p: number) => void
      }) => Promise<unknown>
    }
  ).loadModel({
    modelPath: payload.modelPath,
    onLoadProgress: (p: number) => pushStatus('reranker', { loadProgress: p }),
  })
  pushStatus('reranker', { message: 'Creating ranking context…', loadProgress: 1 })
  const context = await (
    model as {
      createRankingContext: (opts?: { contextSize?: number }) => Promise<unknown>
    }
  ).createRankingContext({ contextSize: payload.contextSize })
  rerankerModel = model
  rerankerContext = context
  pushStatus('reranker', { state: 'ready', loadProgress: null, message: 'Reranker ready.' })
  let post: SystemResources = resources
  try {
    post = await planner.refresh()
  } catch {
    /* keep snapshot */
  }
  return { resources: post, resolvedPlacement: plan.placement, reason: plan.reason }
}

async function rerankerUnloadInternal(): Promise<void> {
  try {
    if (rerankerContext && hasDispose(rerankerContext)) await rerankerContext.dispose()
    if (rerankerModel && hasDispose(rerankerModel)) await rerankerModel.dispose()
  } catch {
    /* ignore */
  }
  rerankerContext = null
  rerankerModel = null
}

async function rerankerUnload(): Promise<void> {
  await rerankerUnloadInternal()
  pushStatus('reranker', { state: 'unloaded', message: 'Reranker unloaded.' })
}

async function rerankerRank(query: string, documents: string[]): Promise<number[] | null> {
  if (!rerankerContext) throw new Error('Reranker is not loaded.')
  const ctx = rerankerContext as {
    rankAll: (q: string, docs: string[]) => Promise<number[]>
  }
  try {
    const scores = await ctx.rankAll(query, documents)
    return Array.from(scores)
  } catch (err) {
    log('warn', `rerank failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

// ---- request dispatch -----------------------------------------------------

process.parentPort.on('message', (raw: WorkerRequest) => {
  // Some Electron versions wrap utility-process messages in { data: ... }; the
  // protocol shape lives on the message itself. Defensive unwrap so we cope
  // with both.
  const msg = (raw as unknown as { data?: WorkerRequest }).data ?? raw
  void handle(msg).catch((err) => {
    if ('id' in msg) fail(msg.id, err)
    else log('error', err instanceof Error ? err.message : String(err))
  })
})

async function handle(msg: WorkerRequest): Promise<void> {
  switch (msg.op) {
    case 'llm.load':
      reply(msg.id, await withLoadLock(() => llmLoad(msg.payload)))
      return
    case 'llm.unload':
      await llmUnload()
      reply(msg.id, null)
      return
    case 'llm.setLanguage':
      llmSetLanguage(msg.payload.lang, msg.payload.systemPrompt)
      reply(msg.id, null)
      return
    case 'llm.ask':
      reply(msg.id, await llmAsk(msg.payload))
      return
    case 'llm.generateRaw':
      reply(msg.id, await llmGenerateRaw(msg.payload))
      return
    case 'llm.abort': {
      const ctrl = activeAborts.get(msg.payload.streamId)
      if (ctrl) ctrl.abort()
      reply(msg.id, null)
      return
    }
    case 'embedder.load':
      reply(msg.id, await withLoadLock(() => embedderLoad(msg.payload)))
      return
    case 'embedder.unload':
      await embedderUnload()
      reply(msg.id, null)
      return
    case 'embedder.embed':
      reply(msg.id, await embedderEmbed(msg.payload.texts))
      return
    case 'reranker.load':
      reply(msg.id, await withLoadLock(() => rerankerLoad(msg.payload)))
      return
    case 'reranker.unload':
      await rerankerUnload()
      reply(msg.id, null)
      return
    case 'reranker.rank':
      reply(msg.id, await rerankerRank(msg.payload.query, msg.payload.documents))
      return
    case 'planner.refresh':
      reply(msg.id, await planner.refresh())
      return
    case 'shutdown': {
      reply(msg.id, null)
      await llmUnloadInternal()
      await embedderUnloadInternal()
      await rerankerUnloadInternal()
      process.exit(0)
      return
    }
    default: {
      const _exhaustive: never = msg
      fail((msg as { id: number }).id, `Unknown op: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

log('info', 'modelsWorker ready')

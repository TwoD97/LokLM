// Worker that owns every node-llama-cpp handle (LLM + embedder + reranker)
// plus the documents.parseAndChunk pipeline that used to pin the main event
// loop on book-sized PDFs.
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

// pdfjs-dist (loaded lazily by pdf-parse on first parsePdf) constructs a
// module-level `new DOMMatrix()` at import time. Electron's main process
// exposes DOMMatrix as a browser global ; utilityProcess does not, so the
// dynamic import threw `DOMMatrix is not defined` and indexing failed before
// we ever called parser.getText(). Stub the class so the import succeeds ;
// text extraction never touches canvas-rendering paths that would actually
// use the matrix, so an identity-shaped no-op is enough.
if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
  class DOMMatrixPolyfill {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0
    constructor(init?: number[] | string | DOMMatrixPolyfill) {
      if (Array.isArray(init) && init.length >= 6) {
        ;[this.a, this.b, this.c, this.d, this.e, this.f] = init as [
          number,
          number,
          number,
          number,
          number,
          number,
        ]
      }
    }
    multiplySelf(): this {
      return this
    }
    preMultiplySelf(): this {
      return this
    }
    invertSelf(): this {
      return this
    }
    translateSelf(): this {
      return this
    }
    translate(): this {
      return this
    }
    scaleSelf(): this {
      return this
    }
    scale(): this {
      return this
    }
  }
  ;(globalThis as { DOMMatrix?: unknown }).DOMMatrix = DOMMatrixPolyfill
}

import { ResourcePlanner, ggufWeightBytes } from '../embeddings/ResourcePlanner'
import type { KvCacheType, SystemResources } from '../embeddings/ResourcePlanner'
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerPush,
  LlmLoadPayload,
  LlmAskPayload,
  LlmGenerateRawPayload,
  QuizPoolEnsurePayload,
  QuizPoolEnsureResult,
  QuizGeneratePayload,
  EmbedderLoadPayload,
  RerankerLoadPayload,
  LlmLoadResult,
  EmbedderLoadResult,
  RerankerLoadResult,
  ParseAndChunkPayload,
  ParseAndChunkResult,
} from './protocol'
import { parseFile } from '../documents/parser'
import {
  chunkMarkdown,
  chunkPages,
  tagChunksWithSections,
  tagChunkLanguages,
} from '../documents/chunker'

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

// ---- quiz batch-decode pool -----------------------------------------------
// A second, modest-context LlamaContext created from the SAME loaded llmModel
// with N parallel sequences. Quiz generation fires many independent prompts
// that the GPU decodes concurrently (continuous batching) — a 2–9B model
// single-streaming one sequence barely touches a 5090's memory bandwidth.
// The chat `ask` path keeps using the untouched single `llmSession`, so this
// pool is fully isolated from it. JSON-schema grammars are compiled once per
// pool and force every quiz response to parse.
let quizContext: { getSequence: () => unknown; dispose?: () => Promise<void> } | null = null
let quizSessions: Array<{
  prompt: (text: string, opts: Record<string, unknown>) => Promise<string>
  resetChatHistory?: () => void
  dispose?: () => Promise<void>
}> = []
const quizFreeSlots: number[] = []
const quizWaiters: Array<(slot: number) => void> = []
let quizGrammarTheme: unknown = null
let quizGrammarQuestion: unknown = null
let quizPoolContextTokens = 0

// GBNF JSON-schema shapes. Keys are snake_case to match the prompts + the
// parsers in quiz/generation.ts and quiz/themes.ts. Grammar guarantees shape
// only — semantic checks (distinct options, valid chunk ids, weight range)
// still run in the parser.
const QUIZ_THEME_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      weight: { type: 'integer' },
    },
  },
} as const
const QUIZ_QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    stem: { type: 'string' },
    options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
    correct_index: { type: 'integer' },
    explanation: { type: 'string' },
    source_chunk_ids: { type: 'array', items: { type: 'integer' } },
  },
} as const

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

// Tombstones for `llm.abort` requests that landed BEFORE the matching
// `llmAsk` / `llmGenerateRaw` had a chance to register its controller. The
// ask path consumes the tombstone at start and aborts the fresh controller
// immediately , without this, an early Cancel click was silently dropped.
const abortedBeforeStart = new Set<string>()

// Token coalescer , buffers onTextChunk callbacks per streamId and flushes
// every ~8 ms. node-llama-cpp fires onTextChunk sub-millisecond on fast
// hardware; sending one postMessage per chunk used to dominate the worker's
// CPU on a 5090. Flushing at 8 ms keeps perceived UI smoothness (~120 fps
// equivalent) while collapsing N small messages into one structured-clone +
// IPC pipe write. The first chunk per streamId is sent without buffering so
// TTFT measurements stay tight.
const TOKEN_FLUSH_MS = 8
const tokenBuffers = new Map<string, { text: string; count: number }>()
const tokenFlushTimers = new Map<string, NodeJS.Timeout>()
const tokenStreamStarted = new Set<string>()

function bufferToken(streamId: string, text: string): void {
  if (!tokenStreamStarted.has(streamId)) {
    // First chunk of this stream — ship immediately, then start buffering.
    tokenStreamStarted.add(streamId)
    send({ ev: 'token', streamId, text, count: 1 })
    return
  }
  const existing = tokenBuffers.get(streamId)
  if (existing) {
    existing.text += text
    existing.count += 1
  } else {
    tokenBuffers.set(streamId, { text, count: 1 })
  }
  if (!tokenFlushTimers.has(streamId)) {
    const timer = setTimeout(() => flushTokens(streamId), TOKEN_FLUSH_MS)
    tokenFlushTimers.set(streamId, timer)
  }
}

function flushTokens(streamId: string): void {
  const timer = tokenFlushTimers.get(streamId)
  if (timer) {
    clearTimeout(timer)
    tokenFlushTimers.delete(streamId)
  }
  const buf = tokenBuffers.get(streamId)
  tokenBuffers.delete(streamId)
  if (buf && buf.text.length > 0) {
    send({ ev: 'token', streamId, text: buf.text, count: buf.count })
  }
}

function endTokenStream(streamId: string): void {
  flushTokens(streamId)
  tokenStreamStarted.delete(streamId)
}

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

// Serialises native embedding calls. Quiz generation now runs question slots in
// parallel, and each does a stem-dedup embed — a single embedder context can't
// service those concurrently without risking a native race, so we funnel them
// through one FIFO.
let embedTail: Promise<void> = Promise.resolve()
async function withEmbedLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = embedTail
  let release: () => void = () => {}
  embedTail = new Promise<void>((resolve) => {
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
  // doesn't double-count weights. Use the TTL'd refresh so back-to-back
  // service warmups don't each re-probe VRAM (post-load is still forced).
  const resources = await planner.refreshIfStale()
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
  await disposeQuizPool()
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

// node-llama-cpp's default repeat penalty (lastTokens=64, penalty=1.1) is too
// narrow for the long contexts we run — XL profile in particular can spiral
// into verbatim repetition. Widen the window and add a small frequencyPenalty
// so the sampler shaves logits of tokens the model has already leaned on.
// Detector in askWithModel catches the cases penalties don't.
const REPEAT_PENALTY = {
  lastTokens: 256,
  penalty: 1.1,
  frequencyPenalty: 0.15,
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
        repeatPenalty?: typeof REPEAT_PENALTY
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
  // Register BEFORE consuming the tombstone so a concurrent `llm.abort`
  // that arrives during the next microtask still finds the controller.
  activeAborts.set(payload.streamId, ctrl)
  if (abortedBeforeStart.delete(payload.streamId)) ctrl.abort()
  try {
    const raw = await session.prompt(payload.prompt, {
      maxTokens: payload.maxTokens,
      signal: ctrl.signal,
      repeatPenalty: REPEAT_PENALTY,
      onTextChunk: (chunk: string) => bufferToken(payload.streamId, chunk),
    })
    return { raw }
  } finally {
    activeAborts.delete(payload.streamId)
    // Drain any buffered tail before resolving so the renderer's "done"
    // event arrives strictly AFTER the last token chunk. Without this, the
    // final 0-8 ms of tokens could be dropped if dispose ran before flush.
    endTokenStream(payload.streamId)
  }
}

async function llmGenerateRaw(payload: LlmGenerateRawPayload): Promise<{ raw: string }> {
  if (!llmSession) throw new Error('Model is not loaded.')
  const session = llmSession as {
    prompt: (
      text: string,
      options: {
        signal?: AbortSignal
        repeatPenalty?: typeof REPEAT_PENALTY
        maxTokens?: number
        budgets?: { thoughtTokens: number }
      },
    ) => Promise<string>
    getChatHistory?: () => unknown[]
    setChatHistory?: (history: unknown[]) => void
    resetChatHistory?: () => void
  }
  const ctrl = new AbortController()
  activeAborts.set(payload.streamId, ctrl)
  if (abortedBeforeStart.delete(payload.streamId)) ctrl.abort()
  let saved: unknown[] | undefined
  try {
    saved = session.getChatHistory?.()
  } catch {
    saved = undefined
  }
  try {
    session.resetChatHistory?.()
    const promptOpts: {
      signal: AbortSignal
      repeatPenalty: typeof REPEAT_PENALTY
      maxTokens?: number
      budgets?: { thoughtTokens: number }
    } = {
      signal: ctrl.signal,
      repeatPenalty: REPEAT_PENALTY,
    }
    if (payload.maxTokens != null) promptOpts.maxTokens = payload.maxTokens
    if (payload.noThink) promptOpts.budgets = { thoughtTokens: 0 }
    const raw = await session.prompt(payload.prompt, promptOpts)
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

// ---- quiz batch-decode pool -----------------------------------------------

function acquireQuizSlot(): Promise<number> {
  const free = quizFreeSlots.pop()
  if (free !== undefined) return Promise.resolve(free)
  return new Promise<number>((resolve) => quizWaiters.push(resolve))
}

function releaseQuizSlot(slot: number): void {
  const waiter = quizWaiters.shift()
  if (waiter) waiter(slot)
  else quizFreeSlots.push(slot)
}

async function disposeQuizPool(): Promise<void> {
  // Wake any waiters with a sentinel so an in-flight acquire doesn't hang the
  // request forever once the pool is gone.
  while (quizWaiters.length) quizWaiters.shift()?.(-1)
  try {
    for (const s of quizSessions) if (hasDispose(s)) await s.dispose!()
    if (quizContext && hasDispose(quizContext)) await quizContext.dispose!()
  } catch {
    /* best-effort */
  }
  quizSessions = []
  quizFreeSlots.length = 0
  quizContext = null
  quizGrammarTheme = null
  quizGrammarQuestion = null
  quizPoolContextTokens = 0
}

async function ensureQuizPool(payload: QuizPoolEnsurePayload): Promise<QuizPoolEnsureResult> {
  if (!llmModel) throw new Error('Model is not loaded.')
  const ctxTokens = Math.max(2048, Math.floor(payload.contextTokens) || 8192)
  // The pool's payoff (continuous batching) is GPU-only. On CPU a second
  // context would just add KV-cache RAM for no parallelism, so we decline it
  // and let the caller stay on the serial path (which still gets the maxTokens
  // cap). 0 slots = "no pool".
  const onGpu = !!backendGpuLabel && backendGpuLabel !== 'cpu'
  if (!onGpu) {
    await disposeQuizPool()
    return { slots: 0 }
  }
  const want = Math.max(1, Math.min(Math.floor(payload.maxSlots) || 1, 8))

  // Reuse an existing pool that already satisfies the request.
  if (quizContext && quizSessions.length >= want && quizPoolContextTokens >= ctxTokens) {
    return { slots: quizSessions.length }
  }
  await disposeQuizPool()

  const lib = await import('node-llama-cpp')
  const llama = llamaBackend as {
    createGrammarForJsonSchema: (schema: unknown) => Promise<unknown>
  }
  // Compile the two grammars once; they're shape-static so they outlive the
  // whole generation.
  quizGrammarTheme = await llama.createGrammarForJsonSchema(QUIZ_THEME_SCHEMA)
  quizGrammarQuestion = await llama.createGrammarForJsonSchema(QUIZ_QUESTION_SCHEMA)

  const model = llmModel as {
    createContext: (o: Record<string, unknown>) => Promise<{
      getSequence: () => unknown
      dispose?: () => Promise<void>
    }>
  }
  const SessionCtor = (lib as { LlamaChatSession: new (o: unknown) => unknown }).LlamaChatSession

  // Try `want` slots, halving on allocation failure (OOM) down to 1 — mirrors
  // the main context's KV fallback so a tight GPU still gets a working pool.
  for (let slots = want; slots >= 1; slots = Math.floor(slots / 2)) {
    let ctx: { getSequence: () => unknown; dispose?: () => Promise<void> } | null = null
    try {
      ctx = await model.createContext({
        sequences: slots,
        contextSize: { min: Math.min(2048, ctxTokens), max: ctxTokens },
        flashAttention: true,
      })
      const sessions: typeof quizSessions = []
      for (let i = 0; i < slots; i++) {
        sessions.push(new SessionCtor({ contextSequence: ctx.getSequence() }) as never)
      }
      quizContext = ctx
      quizSessions = sessions
      quizFreeSlots.length = 0
      for (let i = 0; i < slots; i++) quizFreeSlots.push(i)
      quizPoolContextTokens = ctxTokens
      log('info', `quiz pool ready: ${slots} slot(s) @ ≤${ctxTokens} tok (gpu)`)
      return { slots }
    } catch (err) {
      if (ctx && hasDispose(ctx)) await ctx.dispose!().catch(() => undefined)
      log(
        'warn',
        `quiz pool ${slots} slot(s) @ ≤${ctxTokens} rejected: ${err instanceof Error ? err.message : String(err)}`,
      )
      if (slots === 1) throw err
    }
  }
  throw new Error('quiz pool init failed')
}

async function quizGenerate(payload: QuizGeneratePayload): Promise<{ raw: string }> {
  if (!quizContext || quizSessions.length === 0) throw new Error('Quiz pool is not initialised.')
  const slot = await acquireQuizSlot()
  if (slot < 0 || !quizSessions[slot]) throw new Error('Quiz pool was released.')
  const session = quizSessions[slot]!
  const ctrl = new AbortController()
  activeAborts.set(payload.streamId, ctrl)
  if (abortedBeforeStart.delete(payload.streamId)) ctrl.abort()
  try {
    try {
      session.resetChatHistory?.()
    } catch {
      /* best-effort — a fresh sequence has nothing to reset */
    }
    const opts: Record<string, unknown> = {
      signal: ctrl.signal,
      repeatPenalty: REPEAT_PENALTY,
      // Hard-disable the reasoning segment. This model thinks by default and
      // `/no_think` in the prompt is unreliable for it; budgeting thought tokens
      // to 0 is node-llama-cpp's segment-aware switch and is what actually keeps
      // the decode short. Without it a quiz question spends most of its tokens
      // thinking, then the maxTokens cap truncates before any JSON appears.
      budgets: { thoughtTokens: 0 },
    }
    if (payload.maxTokens != null) opts.maxTokens = payload.maxTokens
    if (payload.schemaKind === 'theme' && quizGrammarTheme) opts.grammar = quizGrammarTheme
    else if (payload.schemaKind === 'question' && quizGrammarQuestion)
      opts.grammar = quizGrammarQuestion
    // No onTextChunk: quiz shows per-question progress, not per-token, so we
    // skip the streaming IPC entirely.
    const t0 = Date.now()
    const raw = await session.prompt(payload.prompt, opts)
    if (process.env['LOKLM_QUIZ_DEBUG']) {
      log(
        'info',
        `[quiz-gen] slot=${slot} ${Date.now() - t0}ms in=${payload.prompt.length}ch out=${raw.length}ch`,
      )
    }
    return { raw }
  } finally {
    activeAborts.delete(payload.streamId)
    releaseQuizSlot(slot)
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
  const resources = await planner.refreshIfStale()
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
  return withEmbedLock(async () => {
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
        log(
          'warn',
          `embed passage #${i} failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        out.push(null)
      }
    }
    return out
  })
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
  const resources = await planner.refreshIfStale()
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

// ---- documents -----------------------------------------------------------

/** Parse + chunk a document off the main event loop. pdf-parse on a book-sized
 *  PDF and the section-aware chunker were both CPU-bound passes that pinned
 *  IPC for seconds (Windows surfaced "Not Responding" when the user clicked
 *  away mid-index). Same lifecycle as the other ops , one request, one reply,
 *  no native handles to manage. */
async function parseAndChunk(payload: ParseAndChunkPayload): Promise<ParseAndChunkResult> {
  const parsed = await parseFile(payload.sourcePath)
  const opts: Partial<{ maxChars: number; overlap: number }> = {}
  if (payload.chunkSize !== undefined) opts.maxChars = payload.chunkSize
  if (payload.chunkOverlap !== undefined) opts.overlap = payload.chunkOverlap
  let chunks
  if (parsed.kind === 'markdown') {
    chunks = chunkMarkdown(parsed.sections, opts)
  } else if (parsed.kind === 'pdf' && parsed.sections.length > 0) {
    chunks = tagChunksWithSections(chunkPages(parsed.pages, opts), parsed.sections)
  } else {
    chunks = chunkPages(parsed.pages, opts)
  }
  // Run eld AFTER section tagging so language detection sees the final chunk
  // text (heading prefixes included) — the prefix is part of what the LLM
  // will read at retrieval time so it shouldn't bias the detector.
  chunks = await tagChunkLanguages(chunks)
  return { chunks }
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
    case 'llm.quizPoolEnsure':
      reply(msg.id, await ensureQuizPool(msg.payload))
      return
    case 'llm.quizGenerate':
      reply(msg.id, await quizGenerate(msg.payload))
      return
    case 'llm.quizPoolRelease':
      await disposeQuizPool()
      reply(msg.id, null)
      return
    case 'llm.abort': {
      const ctrl = activeAborts.get(msg.payload.streamId)
      if (ctrl) ctrl.abort()
      // If abort raced ahead of llmAsk's controller registration, leave a
      // tombstone so the ask path aborts as soon as it starts.
      else abortedBeforeStart.add(msg.payload.streamId)
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
    case 'documents.parseAndChunk':
      reply(msg.id, await parseAndChunk(msg.payload))
      return
    case 'shutdown': {
      reply(msg.id, null)
      // Let the postMessage above drain through the parent pipe before we
      // start disposing native handles. Dispose-then-exit can take seconds
      // on big GPU contexts and we want the main side to see the ack first.
      await new Promise<void>((r) => setImmediate(r))
      try {
        await llmUnloadInternal()
        await embedderUnloadInternal()
        await rerankerUnloadInternal()
      } finally {
        // Always exit , a hanging dispose used to leave the worker process
        // alive past main's `before-quit` (the orphan-on-Windows scenario
        // the memory note flags).
        process.exit(0)
      }
      return
    }
    default: {
      const _exhaustive: never = msg
      // Guard against a malformed message (e.g. a future-renderer version's
      // op this worker doesn't recognise). Without the typeof check, fail()
      // gets called with id=undefined and the response is silently dropped
      // on the main side.
      const id = (msg as { id?: unknown }).id
      if (typeof id === 'number') {
        fail(id, `Unknown op: ${JSON.stringify(_exhaustive)}`)
      } else {
        log('warn', `dropped malformed request: ${JSON.stringify(_exhaustive)}`)
      }
    }
  }
}

log('info', 'modelsWorker ready')

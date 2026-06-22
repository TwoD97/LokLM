// Worker that owns node-llama-cpp model handles. The app spawns this SAME bundle
// as TWO separate utilityProcesses (main/index.ts): 'loklm-models' for the chat
// LLM and 'loklm-retrieval' for the embedder + reranker. Each process gets its
// OWN Vulkan context, so retrieval GPU work cannot corrupt the chat model's
// context across the process boundary — the cross-context fast-fail (0xC0000409
// on an AMD iGPU Vulkan stack) that a single shared backend caused (ADR-0006).
// Spawned via utilityProcess.fork so heavy native init (Vulkan/CUDA context,
// mmap, layer offload) never blocks the main event loop.
//
// Communication is via process.parentPort: requests come in with a numeric id,
// the worker replies with exactly one response carrying that id. Status updates
// and token chunks are pushed without an id and the main side fans them out.
//
// WITHIN a process, node-llama-cpp only globally serialises the decode *call*
// (and only on Vulkan) — not context load/dispose, sampling or KV-cache edits —
// so any two overlapping native ops on the one backend can fast-fail. Every
// native-backend op is therefore funnelled through one FIFO serializer
// (backendSerializer) and runs one-at-a-time; only control ops (abort /
// setLanguage / shutdown) bypass it. A process only ever receives its own op
// subset (llm.* OR embedder.*/reranker.*), so the single op set is correct for
// both roles — see SERIALIZED_OPS.

import { cpus } from 'node:os'
import { ResourcePlanner, ggufWeightBytes } from '../embeddings/ResourcePlanner'
import type { KvCacheType } from '../embeddings/ResourcePlanner'
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
import { fitsUtilityContext, UTILITY_CONTEXT_MAX_TOKENS } from './llmRouting'
import { createBackendSerializer } from './backendSerializer'

// --- GPU enablement inside the utility process (load-bearing) ----------------
// Before loading a GPU binary on Windows, node-llama-cpp FORCES a compatibility
// check (getShouldTestBinaryBeforeLoading hardcodes it for any Windows GPU
// build) that FORKS a short-lived child to test-load the .node binary. When
// running inside Electron it forks via `process.execPath` — which here is
// electron.exe. Without ELECTRON_RUN_AS_NODE the child launches as a full
// Electron app instead of Node, never signals "ready", and the test is judged
// "failed" — so node-llama-cpp concludes no GPU binary is usable and silently
// falls all the way back to CPU. On a CUDA machine (e.g. RTX 5090) the model
// then loads on CPU even though `inspect gpu` reports CUDA available with full
// VRAM. Setting this here (the worker is already spawned, so parentPort is
// wired and unaffected) makes that test child run as Node, the binary test
// passes, and CUDA/Vulkan latch. Must be set before the FIRST getLlama call —
// the planner's VRAM probe (refreshIfStale) can run getLlama before
// ensureBackend, so module scope is the only safe place.
if (process.env['ELECTRON_RUN_AS_NODE'] == null) {
  process.env['ELECTRON_RUN_AS_NODE'] = '1'
}

// utilityProcess provides process.parentPort with postMessage / on('message').
declare const process: NodeJS.Process & {
  parentPort: {
    postMessage: (msg: unknown) => void
    on: (ev: 'message', cb: (msg: WorkerRequest) => void) => void
  }
}

const planner = new ResourcePlanner()

// VRAM (GB) the chat worker holds back from its KV-cache budget for the SEPARATE
// retrieval worker process (embedder + reranker on the iGPU). They share the
// physical device but each probes VRAM independently, so without this reservation
// the chat model could size its KV to consume all free VRAM and OOM the retrieval
// worker's load. ~bge-m3/jina-code (~0.4 GB) + bge-reranker (~0.4 GB) + contexts.
const RETRIEVAL_VRAM_RESERVE_GB = 1.2

// ---- shared state for the three services ----------------------------------

// Two SEPARATE llama backends so background indexing never shares a GPU device
// context with the interactive chat model — concurrent native ops on ONE shared
// backend fast-fail the process on a fragile driver (AMD iGPU Vulkan, 0xC0000409).
//   - 'primary' runs the chat LLM on its chosen device (GPU when available).
//   - 'aux' is CPU-pinned and owns the embedder + reranker.
// The chat model is therefore the sole GPU tenant; the embedder/reranker make no
// GPU calls and cannot collide with it. (See backendSerializer for the one
// remaining guard, which is internal to the chat backend's two contexts.)
type BackendKey = 'primary' | 'aux'
const backends = new Map<BackendKey, unknown>()
// In-flight creation per key, so two concurrent loads of the same backend
// (e.g. embedder.load + reranker.load both warming the 'aux' backend at startup)
// share ONE getLlama instead of racing to create two and orphaning one.
const backendPromises = new Map<BackendKey, Promise<unknown>>()
let primaryGpuLabel: string | null = null

let llmModel: unknown = null
let llmContext: unknown = null
let llmSession: unknown = null
// Small dedicated context for raw utility generations (contextualize, expand-
// queries, titles, small quiz calls). Keeps them OFF the main chat sequence so
// its KV state — the stable [system][pinned][history] prompt prefix — survives
// between asks and per-turn chat prefill stays cheap. Null when creation
// failed (tight VRAM/RAM); raw gens then share the main session as before.
let llmUtilityContext: { getSequence: () => unknown; contextSize?: number } | null = null
let llmUtilitySession: unknown = null
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

// ---- serialiser for all native-backend ops --------------------------------
// One FIFO queue shared by load / unload / embed / rank / ask / generateRaw /
// planner.refresh so no two native llama.cpp operations ever touch the shared
// backend at the same instant. Control ops (abort / setLanguage / shutdown)
// bypass it — see backendSerializer's SERIALIZED_OPS.
const runSerialized = createBackendSerializer()

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

// ---- llama backend init (one instance per key, lazily) --------------------

async function ensureBackend(
  key: BackendKey,
  forceCpu: boolean,
  onMessage: (msg: string) => void,
): Promise<unknown> {
  const existing = backends.get(key)
  if (existing) return existing
  const inFlight = backendPromises.get(key)
  if (inFlight) return inFlight
  const creation = createBackend(key, forceCpu, onMessage)
  backendPromises.set(key, creation)
  try {
    return await creation
  } finally {
    // Clear on settle: on success the early-returns above reuse `backends`; on
    // failure a later load can retry the init.
    backendPromises.delete(key)
  }
}

async function createBackend(
  key: BackendKey,
  forceCpu: boolean,
  onMessage: (msg: string) => void,
): Promise<unknown> {
  const lib = await import('node-llama-cpp')
  const pinned = (process.env['LLAMA_GPU'] ?? '').toLowerCase()
  type Gpu = 'cuda' | 'vulkan' | 'metal' | 'auto' | false
  const order: Gpu[] = (() => {
    // The aux backend (embedder + reranker) is ALWAYS CPU — it must never share
    // a GPU device context with the chat (primary) backend. LLAMA_GPU / forceCpu
    // only steer the primary device choice.
    if (key === 'aux') return [false]
    if (pinned === 'cpu' || pinned === 'false') return [false]
    if (pinned === 'cuda' || pinned === 'vulkan' || pinned === 'metal') return [pinned, 'auto']
    if (forceCpu) return [false]
    return ['auto']
  })()
  let lastErr: unknown = null
  // primary: all but one core (node-llama-cpp's default underuses physical cores
  // on Windows; one core stays free for the OS / Electron main loop). aux: capped
  // lower so background CPU embedding/reranking doesn't starve a CPU-resident
  // chat model — and so the two backends don't oversubscribe every core.
  const cpuCount = cpus().length
  const maxThreads =
    key === 'aux' ? Math.max(1, Math.floor(cpuCount / 2)) : Math.max(1, cpuCount - 1)
  for (const gpu of order) {
    try {
      onMessage(`Initialising ${key} llama backend (${gpu === false ? 'cpu' : gpu})…`)
      const llama = await lib.getLlama({ gpu, maxThreads })
      backends.set(key, llama)
      const obj = llama as { gpu?: string | false }
      const label = obj.gpu === false ? 'cpu' : (obj.gpu ?? null) || null
      if (key === 'primary') {
        primaryGpuLabel = label
        // Wire the planner's VRAM probe to the GPU (primary) backend so it
        // reuses this instance instead of spawning its own probe backend.
        ;(planner as unknown as { llamaProbe: unknown }).llamaProbe = llama
      }
      return llama
    } catch (err) {
      lastErr = err
      log('warn', `${key} ${gpu} init failed: ${err instanceof Error ? err.message : String(err)}`)
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
  // 'cpu' forces the CPU backend; 'gpu'/'auto' let getLlama auto-detect (GPU
  // first, CPU fallback). The shared-backend singleton means whichever service
  // inits first wins — see LlmLoadPayload.placement.
  const llama = await ensureBackend('primary', payload.placement === 'cpu', (msg) =>
    pushStatus('llm', { message: msg }),
  )
  pushStatus('llm', { gpu: primaryGpuLabel, message: 'Loading model weights…' })

  // Probe resources BEFORE the weights allocate so planLlm's freeVram math
  // doesn't double-count weights. Use the TTL'd refresh so back-to-back
  // service warmups don't each re-probe VRAM (post-load is still forced).
  const resources = await planner.refreshIfStale()
  const weightsBytes = payload.weightsBytes || ggufWeightBytes(payload.modelPath)
  // When the user pinned CPU, plan KV against RAM rather than VRAM the backend
  // won't use — otherwise planLlm budgets context for VRAM that's never
  // allocated. Clone so the planner's cached snapshot isn't mutated.
  const planResources =
    payload.placement === 'cpu'
      ? { ...resources, hasGpu: false, freeVramGB: 0, totalVramGB: 0 }
      : { ...resources, freeVramGB: Math.max(0, resources.freeVramGB - RETRIEVAL_VRAM_RESERVE_GB) }

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
    resources: planResources,
    userContextChoice: userChoice,
  })

  const fallbackOrder: KvCacheType[] = ['q4_0', 'q8_0', 'f16']
  const startIdx = fallbackOrder.indexOf(initialPlan.kvCacheType)
  const minCtxBound = 4096
  let maxCtxBound = Math.min(initialPlan.contextSize, payload.profileDefaultContext)
  let context: { getSequence: () => unknown } | null = null
  let activePlan = initialPlan
  // KV element type of the attempt that succeeded — reused for the utility
  // context so both contexts share the same quantization trade-off.
  let successKvEnum: 'Q8_0' | 'Q4_0' | null = null

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
            resources: planResources,
            userContextChoice: userChoice,
            forceKvType: attemptType,
          })
    const attemptMax = Math.min(attemptPlan.contextSize, maxCtxBound)
    const opts: Record<string, unknown> = {
      contextSize: { min: minCtxBound, max: attemptMax },
      flashAttention: true,
      // Bumps prefill throughput by halving the per-batch dispatch overhead.
      // node-llama-cpp default is 512 ; for a ~1k-token theme-extraction prompt
      // ( typical quiz pipeline ) that's two batches per prefill , each with
      // setup cost. 1024 fits the whole prompt in one batch on the hot path.
      // KV-cache memory grows linearly with batchSize but the extra ~ a few MB
      // is well inside the headroom planLlm already reserves.
      batchSize: 1024,
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
      successKvEnum = kvEnum
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

  // Small second context for raw utility generations so they don't erase the
  // main sequence's KV state (the stable [system][pinned][history] prompt
  // prefix that makes per-turn chat prefill cheap). Best-effort: on tight
  // VRAM/RAM the createContext throws and raw gens share the main session,
  // which is exactly the pre-utility-context behaviour.
  let utilityContext: { getSequence: () => unknown; contextSize?: number } | null = null
  let utilitySession: unknown = null
  try {
    const utilOpts: Record<string, unknown> = {
      contextSize: { min: 1024, max: Math.min(UTILITY_CONTEXT_MAX_TOKENS, activePlan.contextSize) },
      flashAttention: true,
      batchSize: 512,
    }
    if (successKvEnum) {
      utilOpts.experimentalKvCacheKeyType = successKvEnum
      utilOpts.experimentalKvCacheValueType = successKvEnum
    }
    utilityContext = await (
      model as {
        createContext: (
          o: Record<string, unknown>,
        ) => Promise<{ getSequence: () => unknown; contextSize?: number }>
      }
    ).createContext(utilOpts)
    utilitySession = new (
      lib as { LlamaChatSession: new (o: unknown) => unknown }
    ).LlamaChatSession({
      contextSequence: utilityContext.getSequence(),
      systemPrompt: llmSystemPrompt,
    })
  } catch (err) {
    log(
      'warn',
      `utility context creation failed — raw generations will share the main context: ${err instanceof Error ? err.message : String(err)}`,
    )
    utilityContext = null
    utilitySession = null
  }

  llmModel = model
  llmContext = context
  llmSession = session
  llmUtilityContext = utilityContext
  llmUtilitySession = utilitySession
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
    gpu: primaryGpuLabel,
  })
  const onGpu = primaryGpuLabel != null && primaryGpuLabel !== 'cpu'
  const resolvedPlacement: 'cpu' | 'gpu' = onGpu ? 'gpu' : 'cpu'
  const placementReason =
    payload.placement === 'cpu'
      ? 'cpu: forced by setting'
      : onGpu
        ? `gpu: ${primaryGpuLabel} backend`
        : payload.placement === 'gpu'
          ? 'cpu: no GPU backend available — fell back'
          : 'cpu: no GPU backend detected'
  return {
    plan: activePlan,
    resources: postResources,
    gpuLabel: primaryGpuLabel,
    resolvedPlacement,
    placementReason,
  }
}

async function llmUnloadInternal(): Promise<void> {
  try {
    if (llmUtilitySession && hasDispose(llmUtilitySession)) await llmUtilitySession.dispose()
    if (llmUtilityContext && hasDispose(llmUtilityContext)) await llmUtilityContext.dispose()
    if (llmSession && hasDispose(llmSession)) await llmSession.dispose()
    if (llmContext && hasDispose(llmContext)) await llmContext.dispose()
    if (llmModel && hasDispose(llmModel)) await llmModel.dispose()
  } catch {
    /* ignore */
  }
  llmUtilitySession = null
  llmUtilityContext = null
  llmSession = null
  llmContext = null
  llmModel = null
}

async function llmUnload(): Promise<void> {
  await llmUnloadInternal()
  // Clear the device label so a stale 'cuda'/'cpu' doesn't leak into the status
  // bar after the model is gone (e.g. when the user flips to remote Ollama).
  pushStatus('llm', { state: 'unloaded', message: 'Model unloaded.', gpu: null })
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

// Grammar objects are expensive to build (GBNF compile) , the quiz pipeline
// reuses the same two schemas across hundreds of calls. Cache by the schema's
// JSON string so we compile each distinct schema once per worker lifetime.
const grammarCache = new Map<string, unknown>()

/** Build (and cache) a node-llama-cpp grammar for a JSON schema. Returns null
 *  when the backend doesn't expose createGrammarForJsonSchema or the build
 *  throws — the caller then generates without a grammar. */
async function grammarForSchema(schema: object): Promise<unknown> {
  // Grammar building belongs to the chat (primary) backend — it's only used by
  // LLM generation. The aux CPU backend never builds grammars.
  const backend = backends.get('primary') as {
    createGrammarForJsonSchema?: (s: object) => Promise<unknown>
  } | null
  if (!backend || typeof backend.createGrammarForJsonSchema !== 'function') return null
  const key = JSON.stringify(schema)
  const cached = grammarCache.get(key)
  if (cached) return cached
  try {
    const grammar = await backend.createGrammarForJsonSchema(schema)
    grammarCache.set(key, grammar)
    return grammar
  } catch (err) {
    log(
      'warn',
      `grammar build failed, generating without it: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
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
        budgets?: { thoughtTokens: number }
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
    const promptOpts: Parameters<typeof session.prompt>[1] = {
      maxTokens: payload.maxTokens,
      signal: ctrl.signal,
      repeatPenalty: REPEAT_PENALTY,
      onTextChunk: (chunk: string) => bufferToken(payload.streamId, chunk),
    }
    // Same segment-aware switch llmGenerateRaw uses for the quiz path: the
    // /no_think tag in the system prompt is unreliable for this GGUF, while
    // a zero thought-token budget actually suppresses the think segment.
    if (payload.noThink) promptOpts.budgets = { thoughtTokens: 0 }
    const raw = await session.prompt(payload.prompt, promptOpts)
    return { raw }
  } finally {
    activeAborts.delete(payload.streamId)
    // Drain any buffered tail before resolving so the renderer's "done"
    // event arrives strictly AFTER the last token chunk. Without this, the
    // final 0-8 ms of tokens could be dropped if dispose ran before flush.
    endTokenStream(payload.streamId)
  }
}

/** True when the raw generation should run on the dedicated utility context.
 *  Tokenizes the prompt with the loaded model (exact count); falls back to the
 *  chars/3.5 estimate if the binding throws. */
function routeToUtility(payload: LlmGenerateRawPayload): boolean {
  if (!llmUtilitySession || !llmUtilityContext) return false
  const ctxSize = llmUtilityContext.contextSize
  if (typeof ctxSize !== 'number' || ctxSize <= 0) return false
  let promptTokens: number
  try {
    const model = llmModel as { tokenize?: (t: string) => unknown[] } | null
    promptTokens = model?.tokenize
      ? model.tokenize(payload.prompt).length
      : Math.ceil(payload.prompt.length / 3.5)
  } catch {
    promptTokens = Math.ceil(payload.prompt.length / 3.5)
  }
  return fitsUtilityContext(promptTokens, payload.maxTokens, ctxSize)
}

async function llmGenerateRaw(payload: LlmGenerateRawPayload): Promise<{ raw: string }> {
  if (!llmSession) throw new Error('Model is not loaded.')
  // Small generations go to the utility context so the main chat sequence
  // keeps its KV prefix; oversized ones (large quiz prompts pack toward the
  // main window) fall back to the main session with history save/restore.
  const useUtility = routeToUtility(payload)
  const session = (useUtility ? llmUtilitySession : llmSession) as {
    prompt: (
      text: string,
      options: {
        signal?: AbortSignal
        repeatPenalty?: typeof REPEAT_PENALTY
        maxTokens?: number
        grammar?: unknown
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
  // History save/restore only matters on the main session — the utility
  // session has no chat state worth preserving (it's reset per call), and
  // skipping the restore avoids wiping the main session's lastEvaluation.
  let saved: unknown[] | undefined
  if (!useUtility) {
    try {
      saved = session.getChatHistory?.()
    } catch {
      saved = undefined
    }
  }
  try {
    session.resetChatHistory?.()
    const promptOpts: {
      signal: AbortSignal
      repeatPenalty: typeof REPEAT_PENALTY
      maxTokens?: number
      grammar?: unknown
      budgets?: { thoughtTokens: number }
    } = {
      signal: ctrl.signal,
      repeatPenalty: REPEAT_PENALTY,
    }
    if (payload.maxTokens != null) promptOpts.maxTokens = payload.maxTokens
    // Disable the reasoning segment when asked. This model thinks by default and
    // `/no_think` is unreliable for its GGUF; budgeting thought tokens to 0 is
    // node-llama-cpp's segment-aware switch and is most of the per-call speedup
    // on the quiz path.
    if (payload.noThink) promptOpts.budgets = { thoughtTokens: 0 }
    // Grammar guarantees JSON *syntax* only; the main side still runs semantic
    // validation + JSON-retry. A grammar build failure must never crash the
    // worker — grammarForSchema returns null and we generate unconstrained.
    if (payload.jsonSchema) {
      const grammar = await grammarForSchema(payload.jsonSchema)
      if (grammar) promptOpts.grammar = grammar
    }
    const raw = await session.prompt(payload.prompt, promptOpts)
    return { raw }
  } finally {
    activeAborts.delete(payload.streamId)
    if (!useUtility && saved && session.setChatHistory) {
      try {
        session.setChatHistory(saved)
      } catch {
        /* drop history on restore failure */
      }
    }
  }
}

function patchSessionSystemPrompt(target: unknown, systemPrompt: string): void {
  const session = target as {
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

function llmSetLanguage(lang: 'de' | 'en', systemPrompt: string): void {
  llmLanguage = lang
  llmSystemPrompt = systemPrompt
  patchSessionSystemPrompt(llmSession, systemPrompt)
  patchSessionSystemPrompt(llmUtilitySession, systemPrompt)
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
  // The embedder runs on THIS process's own llama backend. When this worker is
  // spawned as the dedicated RETRIEVAL process (separate from chat), that backend
  // is an isolated Vulkan context, so embedder/reranker GPU work can't corrupt
  // the chat model's context across the process boundary. RAM-only snapshot
  // here: probing VRAM before the backend exists would spin up a stray probe.
  const resources = planner.snapshot()
  const llama = await ensureBackend('primary', false, (msg) =>
    pushStatus('embedder', { message: msg }),
  )
  pushStatus('embedder', {
    message: `Loading embedder weights (${primaryGpuLabel ?? 'gpu'})…`,
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
  const onGpu = primaryGpuLabel != null && primaryGpuLabel !== 'cpu'
  return {
    resources,
    resolvedPlacement: onGpu ? 'gpu' : 'cpu',
    reason: onGpu ? `gpu: ${primaryGpuLabel} backend` : 'cpu: no GPU backend available',
  }
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
  // Reranker shares the embedder's backend in THIS process (the retrieval
  // process's own isolated Vulkan context). RAM-only snapshot (see embedder).
  const resources = planner.snapshot()
  const llama = await ensureBackend('primary', false, (msg) =>
    pushStatus('reranker', { message: msg }),
  )
  pushStatus('reranker', {
    message: `Loading reranker weights (${primaryGpuLabel ?? 'gpu'})…`,
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
  const onGpu = primaryGpuLabel != null && primaryGpuLabel !== 'cpu'
  return {
    resources,
    resolvedPlacement: onGpu ? 'gpu' : 'cpu',
    reason: onGpu ? `gpu: ${primaryGpuLabel} backend` : 'cpu: no GPU backend available',
  }
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
  // Funnel through the FIFO serializer keyed on the op. Native-backend ops run
  // one-at-a-time; control ops (abort / setLanguage / shutdown) and any
  // unknown/malformed op bypass and reach handle() immediately.
  void runSerialized(msg.op, () => handle(msg)).catch((err) => {
    if ('id' in msg) fail(msg.id, err)
    else log('error', err instanceof Error ? err.message : String(err))
  })
})

async function handle(msg: WorkerRequest): Promise<void> {
  switch (msg.op) {
    case 'llm.load':
      reply(msg.id, await llmLoad(msg.payload))
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
      // If abort raced ahead of llmAsk's controller registration, leave a
      // tombstone so the ask path aborts as soon as it starts.
      else abortedBeforeStart.add(msg.payload.streamId)
      reply(msg.id, null)
      return
    }
    case 'embedder.load':
      reply(msg.id, await embedderLoad(msg.payload))
      return
    case 'embedder.unload':
      await embedderUnload()
      reply(msg.id, null)
      return
    case 'embedder.embed':
      reply(msg.id, await embedderEmbed(msg.payload.texts))
      return
    case 'reranker.load':
      reply(msg.id, await rerankerLoad(msg.payload))
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

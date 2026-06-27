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
// node-llama-cpp). node-llama-cpp only globally serialises the decode *call*,
// and only on Vulkan (LlamaContext's `decodeSyncWorkaround.vulkanLock`) —
// context loads/disposes, sampling and KV-cache edits across the embedder /
// reranker / chat contexts can otherwise overlap and fast-fail the whole
// process on a fragile driver (seen as 0xC0000409 on an AMD iGPU Vulkan stack
// when background embedding raced a chat ask / reranker load). So EVERY native-
// backend op is funnelled through one FIFO serializer (backendSerializer) and
// runs one-at-a-time; only control ops (abort / setLanguage / shutdown) bypass
// it — see SERIALIZED_OPS.

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

// ---- shared state for the three services ----------------------------------

// ONE shared llama backend ('primary') owns the chat LLM, the embedder AND the
// reranker — all on the same GPU device. On a small AMD iGPU, TWO Vulkan devices
// (a second getLlama) fast-fail the driver, so a single shared device is the
// only stable GPU layout; the 17 GB unified memory fits all three easily. Safety
// rests on two guards, NOT on isolation:
//   1. backendSerializer funnels every native op through one FIFO so no two
//      overlap on the device (the cross-op 0xC0000409 class).
//   2. embed inputs are token-truncated to the context (embedderContextSize) so
//      jina-code never gets the over-context passage that NATIVE-crashes it on
//      Vulkan (llama.cpp #20098/#20515) — the trigger that defeated every
//      earlier GPU attempt.
// 'aux' (CPU) is retained as a fallback key but unused on a working GPU.
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
// Token budget of the live embedding context. Inputs are HARD-truncated to this
// (minus a margin) before getEmbeddingFor: an over-context passage NATIVE-CRASHES
// the jina-code embedder on AMD Vulkan (0xC0000409, llama.cpp #20098/#20515) —
// it bypasses JS try/catch and kills the worker. The main side caps input at
// 6000 CHARS, which for dense code can exceed 2048 TOKENS, so the cap alone is
// not enough; this is the authoritative, tokenizer-accurate guard.
let embedderContextSize = 2048

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
    // LLAMA_GPU=cpu/false is the hard "true CPU" escape — kept so CPU-timing evals
    // can still measure the pure-CPU floor. Wins over every path below.
    if (pinned === 'cpu' || pinned === 'false') return [false]
    if (pinned === 'cuda' || pinned === 'vulkan' || pinned === 'metal') return [pinned, 'auto']
    // App device plan: ModelsWorkerClient sets LOKLM_PRIMARY_BACKEND (+ the
    // CUDA_VISIBLE_DEVICES / GGML_VK_VISIBLE_DEVICES pin) in this worker's spawn
    // env from the resolved GPU device. 'cuda' for an NVIDIA dedicated card,
    // 'vulkan' for an AMD/Intel card (dedicated or integrated) pinned by index.
    const planBackend = (process.env['LOKLM_PRIMARY_BACKEND'] ?? '').toLowerCase()
    if (planBackend === 'cpu') return [false]
    if (planBackend === 'cuda') return ['cuda', 'auto']
    if (planBackend === 'vulkan') return ['vulkan']
    // No plan (legacy/auto). `forceCpu` is the old low-power tier hint: prefer a
    // single Vulkan device (the iGPU on integrated-only boxes) over true CPU —
    // still ONE device, so the shared-backend + serializer safety holds.
    if (forceCpu) return ['vulkan', false]
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
  // The backend family + physical device pin come from the worker's spawn env
  // (LOKLM_PRIMARY_BACKEND + CUDA/GGML visible-device vars), set by
  // ModelsWorkerClient from payload.device. createBackend reads those; the
  // shared-backend singleton means whichever service inits first wins, which is
  // why the device is fixed at spawn (and the worker is restarted on a change).
  const llama = await ensureBackend('primary', false, (msg) => pushStatus('llm', { message: msg }))
  pushStatus('llm', { gpu: primaryGpuLabel, message: 'Loading model weights…' })

  // Probe resources BEFORE the weights allocate so planLlm's freeVram math
  // doesn't double-count weights. Use the TTL'd refresh so back-to-back
  // service warmups don't each re-probe VRAM (post-load is still forced).
  const resources = await planner.refreshIfStale()
  const weightsBytes = payload.weightsBytes || ggufWeightBytes(payload.modelPath)
  // 'cpu' placement can now still latch the iGPU (Vulkan) — see createBackend — so
  // key the KV plan off the device the backend ACTUALLY latched, not the request:
  // plan KV against RAM only when it really fell back to true CPU, otherwise
  // planLlm budgets context for VRAM that's never allocated. Clone so the
  // planner's cached snapshot isn't mutated.
  const latchedCpu = primaryGpuLabel === 'cpu' || primaryGpuLabel == null
  const planResources = latchedCpu
    ? { ...resources, hasGpu: false, freeVramGB: 0, totalVramGB: 0 }
    : resources

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
  const onGpu = primaryGpuLabel != null && primaryGpuLabel !== 'cpu'
  const resolvedPlacement: 'cpu' | 'gpu' = onGpu ? 'gpu' : 'cpu'

  // Resolve the real device name from the post-pin device list and verify the
  // pin landed (the requested device's name appears). getGpuDeviceNames returns
  // the backend's filtered device set — with a correct GGML_VK_VISIBLE_DEVICES /
  // CUDA_VISIBLE_DEVICES pin that's the single chosen device.
  const expectedName = payload.device.expectedName
  let deviceNames: string[] = []
  if (onGpu) {
    try {
      deviceNames =
        (await (llama as { getGpuDeviceNames?: () => Promise<string[]> }).getGpuDeviceNames?.()) ??
        []
    } catch {
      /* non-fatal — fall back to the expected name */
    }
  }
  const nameMatches = (a: string, b: string): boolean => {
    const na = a.toLowerCase()
    const nb = b.toLowerCase()
    return na.includes(nb) || nb.includes(na)
  }
  const gpuName = onGpu ? (deviceNames[0] ?? expectedName) : null
  const pinnedDeviceVerified =
    !onGpu || expectedName == null ? true : deviceNames.some((n) => nameMatches(n, expectedName))
  // Only claim the requested class when the pin was confirmed — if a different
  // device loaded we don't actually know its class from the runtime name list.
  const gpuKind = onGpu && pinnedDeviceVerified ? payload.device.expectedKind : null

  pushStatus('llm', {
    state: 'ready',
    loadProgress: null,
    message: 'Ready.',
    gpu: primaryGpuLabel,
    gpuName,
    gpuKind,
  })

  const placementReason = onGpu
    ? pinnedDeviceVerified
      ? `gpu: ${gpuName ?? primaryGpuLabel} (${gpuKind ?? 'gpu'}, ${primaryGpuLabel})`
      : `gpu: requested ${expectedName ?? 'device'} not confirmed — running on ${gpuName ?? primaryGpuLabel} (${primaryGpuLabel})`
    : 'cpu: no GPU backend available — fell back'
  return {
    plan: activePlan,
    resources: postResources,
    gpuLabel: primaryGpuLabel,
    resolvedPlacement,
    placementReason,
    gpuName,
    gpuKind,
    pinnedDeviceVerified,
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
  // The embedder shares the chat model's GPU backend ('primary'). RAM-only
  // snapshot, NOT refreshIfStale(): the LLM load owns the live VRAM probe.
  const resources = planner.snapshot()
  const llama = await ensureBackend('primary', false, (msg) =>
    pushStatus('embedder', { message: msg }),
  )
  pushStatus('embedder', {
    message: 'Loading embedder weights…',
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
  embedderContextSize = payload.contextSize
  pushStatus('embedder', { state: 'ready', loadProgress: null, message: 'Embedder ready.' })
  const onGpu = primaryGpuLabel != null && primaryGpuLabel !== 'cpu'
  return {
    resources,
    resolvedPlacement: onGpu ? 'gpu' : 'cpu',
    reason: onGpu
      ? `shared ${primaryGpuLabel} backend (input token-clamped to ${payload.contextSize})`
      : 'shared CPU backend',
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
  const tok = embedderModel as {
    tokenize?: (text: string) => number[]
    detokenize?: (tokens: number[]) => string
  }
  // Headroom for the BOS/EOS the embedding context wraps around the input.
  const maxTokens = Math.max(8, embedderContextSize - 8)
  const out: Array<number[] | null> = []
  for (let i = 0; i < texts.length; i++) {
    let t = texts[i]!
    if (t.length === 0) {
      out.push(null)
      continue
    }
    // HARD token-clamp BEFORE the native call. An over-context passage
    // native-crashes jina-code on AMD Vulkan (0xC0000409) and bypasses the
    // try/catch below — see embedderContextSize. Truncation loses the tail of an
    // oversized chunk, which is strictly better than killing the whole worker.
    try {
      if (typeof tok.tokenize === 'function' && typeof tok.detokenize === 'function') {
        const ids = tok.tokenize(t)
        if (ids.length > maxTokens) t = tok.detokenize(ids.slice(0, maxTokens))
      } else {
        // No tokenizer access: conservative ~2 chars/token char cap so we never
        // hand the native layer a clearly over-context string.
        if (t.length > maxTokens * 2) t = t.slice(0, maxTokens * 2)
      }
    } catch {
      const charCap = maxTokens * 2
      if (t.length > charCap) t = t.slice(0, charCap)
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
  // Reranker shares the chat model's GPU backend ('primary'). This is the heavy
  // hitter on the query hot path (~25x faster on the iGPU than CPU), and as an
  // XLM-RoBERTa encoder it errors gracefully on over-context input rather than
  // native-crashing like the jina decoder. RAM-only snapshot (see embedder).
  const resources = planner.snapshot()
  const llama = await ensureBackend('primary', false, (msg) =>
    pushStatus('reranker', { message: msg }),
  )
  pushStatus('reranker', {
    message: 'Loading reranker weights…',
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
    reason: onGpu ? `shared ${primaryGpuLabel} backend` : 'shared CPU backend',
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

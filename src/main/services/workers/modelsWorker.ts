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

import { realpathSync, statSync } from 'node:fs'
import { availableParallelism, cpus } from 'node:os'
import { ResourcePlanner, ggufWeightBytes } from '../embeddings/ResourcePlanner'
import type { SystemResources, ServicePlan } from '../embeddings/ResourcePlanner'
import {
  allocateChat,
  chatContextTarget,
  resolveVramPadding,
  resolveInferenceThreads,
  GpuLayerPlanCache,
  gpuLayerPlanKey,
  gpuLayerPlanReuseEnabled,
  seedGpuLayerPlanHints,
  MIN_CHAT_CONTEXT,
  type ChatModelOptions,
  type ChatModel,
} from './modelMemory'
import { assertPreparedPromptFits, prepareChatPromptBudget } from './contextBudget'
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
import {
  fitsUtilityContext,
  UTILITY_CONTEXT_MAX_TOKENS,
  UTILITY_GEN_DEFAULT_RESERVE,
} from './llmRouting'
import { createBackendSerializer } from './backendSerializer'
import { ModelResidency } from './ModelResidency'
import { assessRerankerPolicy, describeRerankerDecision } from '../../../shared/modelCapabilities'
import {
  IDLE_MODEL_TRANSITION,
  type ModelTask,
  type ModelTransition,
} from '../../../shared/modelActivity'

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
// Small scalar hints, never native model or context handles.
const gpuLayerPlans = new GpuLayerPlanCache()

// ---- shared state for the three services ----------------------------------

// All models use the primary GPU backend. On small cards, inactive models
// release their allocations and are reloaded for their next task.
// Native operations retain two guards:
//   1. backendSerializer funnels every native op through one FIFO so no two
//      overlap on the device (the cross-op 0xC0000409 class).
//   2. embed inputs are token-truncated to the context (embedderContextSize) so
//      jina-code never gets the over-context passage that NATIVE-crashes it on
//      Vulkan (llama.cpp #20098/#20515) — the trigger that defeated every
//      earlier GPU attempt.
type BackendKey = 'primary' | 'aux'
let llmBackendKey: BackendKey = 'primary'
const backends = new Map<BackendKey, unknown>()
// In-flight creation per key, so two concurrent loads of the same backend
// (e.g. embedder.load + reranker.load both warming the 'aux' backend at startup)
// share ONE getLlama instead of racing to create two and orphaning one.
const backendPromises = new Map<BackendKey, Promise<unknown>>()
let primaryGpuLabel: string | null = null

// Vulkan submission-size cap for the EMBEDDER and the LLM PREFILL. Root cause of
// the iGPU failures (llama.cpp #21724 + #20515): ggml's Vulkan backend batches
// ~100 graph nodes per vkQueueSubmit, and on a slow integrated GPU one large
// submission can exceed the OS GPU-job timeout (~2 s) → the driver either resets
// the device (`vk::Queue::submit: ErrorDeviceLost`, seen on the embedder during
// folder sync) or `session.prompt` hangs and never returns (seen on the LLM
// prefill — the intermittent blank-answer turn where `[qa] prefill` logs but no
// generation log ever follows). Both only fire in the packaged app, where the
// iGPU is SHARED with Electron's UI compositor that slows each submission past
// the timeout; the worker alone is rock-solid (tests/bench/vulkan-lite-embed.ts:
// 300 embeds, never crashes). Capping the batch shrinks each eval/prefill
// submission so it finishes under the timeout even while the compositor competes
// — quality-neutral, throughput-neutral on the embedder (3.70 vs 3.76 emb/s),
// and only slightly slower (more, smaller batches) on LLM prefill, traded for it
// completing RELIABLY instead of hanging. The reranker is a short per-chat burst
// that never crashed, so it keeps its full batch for speed. Everything stays on
// the GPU (no CPU fallback) and the UI accelerated (no disableHardwareAcceleration).
// Like LLM_PREFILL_SAFE_BATCH, this cap is GATED: it only applies to Vulkan/CPU
// backends. CUDA/Metal embedders get batch = full context (see embedderLoad) —
// a dedicated GPU never trips the watchdog, and 128-token slices there just
// waste the card on per-submission overhead (~7k tok/s plateau regardless of GPU).
const VULKAN_SAFE_BATCH = 128
// LLM PREFILL batch on a slow Vulkan/iGPU. Larger than the embedder's (the 2B
// LLM at 128 made a 3 K-token prefill ~1.5 min). 254, not 256: the heavier 4B
// tripped the watchdog at 256 — `vk::Queue::submit: ErrorDeviceLost` on the
// co-resident embedder/reranker, then an M-RoPE decode failure ("X = 255")
// because the lost device left the KV cache at the 256-token batch boundary. 254
// keeps the submission under the ~2 s GPU-job timeout AND off that boundary,
// while still being far faster than the embedder's 128. Tunable: drop to 128 if a
// prefill hang ever returns. Only applied on slow integrated GPUs — see GATING
// below; dedicated GPUs (CUDA/Metal) keep the full 1024 batch.
const LLM_PREFILL_SAFE_BATCH = 254
// A fast, dedicated/unified GPU finishes a large submission far under the ~2 s
// watchdog, so the iGPU submission cap is unnecessary there — it would only slow
// prefill. CUDA (NVIDIA) and Metal (Apple) are always dedicated/unified; Vulkan
// is the ambiguous one (could be an iGPU OR a discrete AMD/Intel card), so it
// gets the safe cap. This is why the crash is iGPU-only: a dGPU never times out.
const isFastDedicatedGpu = (label: string | null): boolean => label === 'cuda' || label === 'metal'
// Embedding-context pool size on fast dedicated GPUs. node-llama-cpp's
// LlamaEmbeddingContext holds a SINGLE sequence and serializes getEmbeddingFor
// behind a per-instance lock, so concurrent calls on one context do NOT batch —
// cross-passage parallelism requires a pool of contexts, one in-flight passage
// each. Pool creation is best-effort (each context costs its own KV/compute
// buffers); on Vulkan/CPU the pool stays at 1, which preserves the exact
// sequential behaviour the fragile iGPU path was validated with.
const EMBEDDER_FAST_GPU_CONTEXTS = 3

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

let embedderModel: unknown = null
// Pool of embedding contexts — length 1 on Vulkan/CPU, up to
// EMBEDDER_FAST_GPU_CONTEXTS on CUDA/Metal (see embedderLoad).
let embedderContexts: unknown[] = []
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
  if (
    typeof status.loadProgress === 'number' &&
    transition.phase === 'switching' &&
    transition.target === service
  )
    setTransition({ ...transition, progress: status.loadProgress })
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
    if (key === 'aux') throw new Error('CPU-only inference is disabled.')
    if (pinned === 'cpu' || pinned === 'false')
      throw new Error('CPU-only inference is disabled. Select a GPU.')
    if (pinned === 'cuda' || pinned === 'vulkan' || pinned === 'metal') return [pinned, 'auto']
    // App device plan: ModelsWorkerClient sets LOKLM_PRIMARY_BACKEND (+ the
    // CUDA_VISIBLE_DEVICES / GGML_VK_VISIBLE_DEVICES pin) in this worker's spawn
    // env from the resolved GPU device. 'cuda' for an NVIDIA dedicated card,
    // 'vulkan' for an AMD/Intel card (dedicated or integrated) pinned by index.
    const planBackend = (process.env['LOKLM_PRIMARY_BACKEND'] ?? '').toLowerCase()
    if (planBackend === 'cpu') throw new Error('A working GPU is required.')
    if (planBackend === 'cuda') return ['cuda', 'auto']
    if (planBackend === 'vulkan') return ['vulkan']
    // No plan (legacy/auto). `forceCpu` is the old low-power tier hint: prefer a
    // single Vulkan device (the iGPU on integrated-only boxes) over true CPU —
    // still ONE device, so the shared-backend + serializer safety holds.
    if (forceCpu) return ['vulkan']
    return ['auto']
  })()
  let lastErr: unknown = null
  // Bound inference to available scheduling capacity. The native math-core
  // count becomes available after backend creation; this does not pin a UI core.
  const cpuCount = cpus().length
  const availableCpuCount = availableParallelism()
  const threadOverride = process.env['LOKLM_INFERENCE_THREADS']
  const initialThreads = resolveInferenceThreads(availableCpuCount, threadOverride)
  if (initialThreads.invalidOverride)
    log(
      'warn',
      `LOKLM_INFERENCE_THREADS must be an integer from 1 to ${Math.max(1, availableCpuCount - 1)}; using default threads.`,
    )
  const paddingOverride = process.env['LOKLM_VRAM_PADDING_MIB']
  for (const gpu of order) {
    try {
      onMessage(`Initialising ${key} llama backend (${gpu === false ? 'cpu' : gpu})…`)
      let padding = resolveVramPadding(0, paddingOverride)
      const llama = await lib.getLlama({
        gpu,
        maxThreads: initialThreads.maxThreads,
        // Keep a real allocation margin on small cards as well as large ones.
        vramPadding: (total) => {
          padding = resolveVramPadding(total, paddingOverride)
          return padding.paddingBytes
        },
      })
      if (llama.gpu === false)
        throw new Error('A working GPU is required. Check your graphics driver.')
      const threads = resolveInferenceThreads(availableCpuCount, threadOverride, llama.cpuMathCores)
      llama.maxThreads = threads.maxThreads
      log(
        'info',
        `${key} ${llama.gpu} inference threads: maxThreads=${llama.maxThreads}, cpuMathCores=${llama.cpuMathCores}, logicalCores=${cpuCount}, availableParallelism=${availableCpuCount} ` +
          (threads.overrideThreads == null
            ? '(hardware-aware default)'
            : '(LOKLM_INFERENCE_THREADS calibration override)'),
      )
      if (padding.invalidOverride) {
        log(
          'warn',
          'LOKLM_VRAM_PADDING_MIB must be an integer from 512 to 1229; using default padding.',
        )
      }
      log(
        'info',
        `${key} ${llama.gpu} VRAM padding: ${(llama.vramPaddingSize / 1024 ** 2).toFixed(1)} MiB ` +
          (padding.overrideMiB == null
            ? '(default)'
            : '(LOKLM_VRAM_PADDING_MIB calibration override)'),
      )
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

function hasDispose(o: unknown): o is { dispose: () => void | Promise<void> } {
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof (o as { dispose?: unknown }).dispose === 'function'
  )
}

async function traceGpuMemory(llama: unknown, phase: string): Promise<void> {
  if (process.env['LOKLM_RETRIEVAL_TRACE'] !== '1') return
  try {
    const backend = llama as { getVramState(): Promise<unknown>; vramPaddingSize: number }
    log(
      'info',
      `memory snapshot ${phase}: ${JSON.stringify({
        at: new Date().toISOString(),
        vram: await backend.getVramState(),
        paddingBytes: backend.vramPaddingSize,
      })}`,
    )
  } catch {
    /* Optional diagnostics must not prevent model loading. */
  }
}

// ---- LLM ------------------------------------------------------------------

async function llmLoad(payload: LlmLoadPayload): Promise<LlmLoadResult> {
  try {
    return await performLlmLoad(payload)
  } catch (error) {
    // A failed context allocation must release the weights before a retry.
    await llmUnloadInternal()
    throw error
  }
}

async function performLlmLoad(payload: LlmLoadPayload): Promise<LlmLoadResult> {
  await llmUnloadInternal()
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
  // doesn't double-count weights. Refresh after each service allocation so
  // startup planning includes any models already resident.
  const resources = await planner.refresh()
  await traceGpuMemory(llama, 'before-chat-weights')
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

  // Reserve a useful context and adjust GPU offload if the native allocator rejects it.
  const userChoice =
    payload.envContextOverride != null ? payload.envContextOverride : payload.userContextChoice
  const initialPlan = planner.planLlm({
    profileName: payload.profileName ?? 'full',
    profileDefaultContext: chatContextTarget(
      payload.profileDefaultContext,
      userChoice,
      planResources,
      weightsBytes,
    ),
    weightsBytes,
    resources: planResources,
    userContextChoice: userChoice,
  })

  const batchSize = isFastDedicatedGpu(primaryGpuLabel) ? 1024 : LLM_PREFILL_SAFE_BATCH
  let layerPlanReuse: { cache: GpuLayerPlanCache; key: string } | undefined
  if (gpuLayerPlanReuseEnabled(process.env['LOKLM_REUSE_GPU_LAYER_PLAN'])) {
    try {
      const modelPath = realpathSync(payload.modelPath)
      const revision = statSync(modelPath, { bigint: true })
      const backend = llama as { vramPaddingSize: number; maxThreads: number }
      const key = gpuLayerPlanKey({
        modelRevision: JSON.stringify([
          modelPath,
          ...[revision.dev, revision.ino, revision.size, revision.mtimeNs, revision.ctimeNs].map(
            String,
          ),
        ]),
        backendIdentity: JSON.stringify([
          primaryGpuLabel,
          payload.device,
          process.env['CUDA_VISIBLE_DEVICES'] ?? '',
          process.env['GGML_VK_VISIBLE_DEVICES'] ?? '',
          backend.maxThreads,
        ]),
        contextSize: initialPlan.contextSize,
        batchSize,
        paddingBytes: backend.vramPaddingSize,
      })
      if (key) layerPlanReuse = { cache: gpuLayerPlans, key }
      else log('warn', 'GPU layer plan cache bypassed: incomplete allocation identity')
    } catch (error) {
      log('warn', `GPU layer plan cache bypassed: ${String(error)}`)
    }
  }
  const allocation = await allocateChat({
    loadModel: (opts: ChatModelOptions) =>
      (llama as { loadModel: (opts: ChatModelOptions) => Promise<ChatModel> }).loadModel(opts),
    modelPath: payload.modelPath,
    plan: initialPlan,
    batchSize,
    layerPlanReuse,
    onLoadProgress: (p) => pushStatus('llm', { loadProgress: p }),
    log: (message) => log('info', message),
  })
  const { model, context, plan: activePlan, kvEnum: successKvEnum } = allocation
  await traceGpuMemory(llama, 'after-chat-context')
  llmModel = model
  llmContext = context
  const modelOnGpu = model.gpuLayers > 0 && !latchedCpu
  const modelGpuLabel = modelOnGpu ? primaryGpuLabel : 'cpu'

  const session = new (lib as { LlamaChatSession: new (o: unknown) => unknown }).LlamaChatSession({
    contextSequence: context.getSequence(),
    // Release sequence checkpoints before their native context is destroyed.
    autoDisposeSequence: true,
    systemPrompt: llmSystemPrompt,
  })

  llmSession = session

  // Small second context for raw utility generations so they don't erase the
  // main sequence's KV state (the stable [system][pinned][history] prompt
  // prefix that makes per-turn chat prefill cheap). Best-effort: on tight
  // VRAM/RAM the createContext throws and raw gens share the main session,
  // which is exactly the pre-utility-context behaviour.
  let utilityContext: { getSequence: () => unknown; contextSize?: number } | null = null
  let utilitySession: unknown = null
  if (!modelOnGpu || resources.totalVramGB > 6)
    try {
      const utilOpts: Record<string, unknown> = {
        contextSize: {
          min: 1024,
          max: Math.min(UTILITY_CONTEXT_MAX_TOKENS, activePlan.contextSize),
        },
        flashAttention: true,
        batchSize: isFastDedicatedGpu(primaryGpuLabel) ? 512 : LLM_PREFILL_SAFE_BATCH,
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
        autoDisposeSequence: true,
        systemPrompt: llmSystemPrompt,
      })
    } catch (err) {
      log(
        'warn',
        `utility context creation failed — raw generations will share the main context: ${err instanceof Error ? err.message : String(err)}`,
      )
      if (hasDispose(utilityContext))
        await Promise.resolve(utilityContext.dispose()).catch(() => undefined)
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
  const onGpu = modelOnGpu
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
    gpu: modelGpuLabel,
    gpuName,
    gpuKind,
  })

  const placementReason = onGpu
    ? pinnedDeviceVerified
      ? `gpu: ${gpuName ?? primaryGpuLabel} (${gpuKind ?? 'gpu'}, ${primaryGpuLabel})`
      : `gpu: requested ${expectedName ?? 'device'} not confirmed — running on ${gpuName ?? primaryGpuLabel} (${primaryGpuLabel})`
    : 'GPU unavailable'
  return {
    ...(layerPlanReuse
      ? {
          gpuLayerPlanHint: {
            key: layerPlanReuse.key,
            layers: model.gpuLayers,
            requestedContext: Math.max(MIN_CHAT_CONTEXT, initialPlan.contextSize),
            achievedContext: activePlan.contextSize,
          },
        }
      : {}),
    plan: activePlan,
    modelCapacity: {
      gpuLayers: model.gpuLayers,
      totalModelLayers: model.fileInsights?.totalLayers ?? null,
      fullyOnGpu:
        model.fileInsights?.totalLayers != null
          ? model.gpuLayers >= model.fileInsights.totalLayers
          : null,
      contextSize: context.contextSize,
      totalVramGB: postResources.totalVramGB > 0 ? postResources.totalVramGB : null,
    },
    resources: postResources,
    gpuLabel: modelGpuLabel,
    resolvedPlacement,
    placementReason,
    gpuName,
    gpuKind,
    pinnedDeviceVerified,
  }
}

async function llmUnloadInternal(): Promise<void> {
  for (const [name, resource] of [
    ['utility session', llmUtilitySession],
    ['utility context', llmUtilityContext],
    ['chat session', llmSession],
    ['chat context', llmContext],
    ['model weights', llmModel],
  ] as const) {
    try {
      if (hasDispose(resource)) {
        log('info', `Releasing ${name}`)
        await resource.dispose()
      }
    } catch {
      // Continue releasing the other allocations if one handle fails to dispose.
    }
  }
  llmUtilitySession = null
  llmUtilityContext = null
  llmSession = null
  llmContext = null
  llmModel = null
  llmBackendKey = 'primary'
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
  // Native grammar handles must belong to the model's GPU backend.
  const backend = backends.get(llmBackendKey) as {
    createGrammarForJsonSchema?: (s: object) => Promise<unknown>
  } | null
  if (!backend || typeof backend.createGrammarForJsonSchema !== 'function') return null
  const key = `${llmBackendKey}:${JSON.stringify(schema)}`
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
    sequence?: {
      tokenMeter: {
        getState(): { usedInputTokens: number; usedOutputTokens: number }
        diff(previous: { usedInputTokens: number; usedOutputTokens: number }): {
          usedInputTokens: number
          usedOutputTokens: number
        }
      }
    }
  }
  try {
    session.resetChatHistory?.()
  } catch {
    /* best-effort */
  }
  // resetChatHistory restores the LOAD-time system prompt — any prompt pushed
  // later via llm.setLanguage (language switch, codebase mode) would be
  // silently discarded here. Re-apply the current one after every reset.
  if (llmSystemPrompt) patchSessionSystemPrompt(llmSession, llmSystemPrompt)
  const ctrl = new AbortController()
  // Register BEFORE consuming the tombstone so a concurrent `llm.abort`
  // that arrives during the next microtask still finds the controller.
  activeAborts.set(payload.streamId, ctrl)
  if (abortedBeforeStart.delete(payload.streamId)) ctrl.abort()
  const tracing = process.env['LOKLM_RETRIEVAL_TRACE'] === '1'
  const meter = tracing ? session.sequence?.tokenMeter : undefined
  const tokenStart = meter?.getState()
  const askStarted = Date.now()
  let firstVisibleTextMs: number | null = null
  try {
    const maxTokens = prepareChatPromptBudget({
      session: llmSession as Parameters<typeof assertPreparedPromptFits>[0]['session'],
      plannedContextTokens: payload.plannedContextTokens,
      actualContextTokens: (llmContext as { contextSize?: number } | null)?.contextSize ?? 0,
      prompt: payload.prompt,
      maxTokens: payload.maxTokens,
      signal: ctrl.signal,
    })
    const promptOpts: Parameters<typeof session.prompt>[1] = {
      maxTokens,
      signal: ctrl.signal,
      repeatPenalty: REPEAT_PENALTY,
      onTextChunk: (chunk: string) => {
        if (firstVisibleTextMs == null && chunk.trim()) firstVisibleTextMs = Date.now() - askStarted
        bufferToken(payload.streamId, chunk)
      },
    }
    // Same segment-aware switch llmGenerateRaw uses for the quiz path: the
    // /no_think tag in the system prompt is unreliable for this GGUF, while
    // a zero thought-token budget actually suppresses the think segment.
    if (payload.noThink) promptOpts.budgets = { thoughtTokens: 0 }
    log(
      'info',
      `llm.ask start: promptChars=${payload.prompt.length} maxTokens=${maxTokens} noThink=${String(!!payload.noThink)}`,
    )
    const raw = await session.prompt(payload.prompt, promptOpts)
    log('info', `llm.ask done: chars=${raw.length}`)
    return { raw }
  } catch (err) {
    // Surfaces an LLM-side failure (e.g. ErrorDeviceLost / llama_decode failed)
    // with its prompt size, so a watchdog trip is distinguishable from the
    // retrieval-side embed/rerank device-loss and from a silent prefill hang.
    log(
      'warn',
      `llm.ask FAILED (promptChars=${payload.prompt.length}): ${err instanceof Error ? err.message : String(err)}`,
    )
    throw err
  } finally {
    if (tracing)
      log(
        'info',
        `llm.ask metrics: ${JSON.stringify({
          elapsedMs: Date.now() - askStarted,
          firstVisibleTextMs,
          ...(meter && tokenStart ? meter.diff(tokenStart) : {}),
        })}`,
      )
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
    promptWithMeta: (
      text: string,
      options: {
        signal?: AbortSignal
        repeatPenalty?: typeof REPEAT_PENALTY
        maxTokens?: number
        grammar?: unknown
        budgets?: { thoughtTokens: number }
      },
    ) => Promise<{ responseText: string; stopReason: string }>
    getChatHistory?: () => unknown[]
    setChatHistory?: (history: unknown[]) => void
    resetChatHistory?: () => void
  }
  const ctrl = new AbortController()
  const startedAt = Date.now()
  const label = payload.background ? 'title' : 'utility'
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
    // Utility tasks must not inherit the RAG-only chat instructions (e.g. a
    // translator should translate a question instead of answering it).
    const systemPrompt = payload.systemPrompt ?? llmSystemPrompt
    if (systemPrompt) patchSessionSystemPrompt(session, systemPrompt)
    const promptOpts: {
      signal: AbortSignal
      repeatPenalty: typeof REPEAT_PENALTY
      maxTokens?: number
      grammar?: unknown
      budgets?: { thoughtTokens: number }
      temperature?: number
    } = {
      signal: ctrl.signal,
      repeatPenalty: REPEAT_PENALTY,
      // Utility calls must always terminate, even if a caller omits a budget.
      maxTokens: payload.maxTokens ?? UTILITY_GEN_DEFAULT_RESERVE,
    }
    if (payload.temperature != null) promptOpts.temperature = payload.temperature
    // Utilities return their result directly unless reasoning was requested.
    // The segment budget enforces this even when the GGUF ignores /no_think.
    if (payload.noThink !== false) promptOpts.budgets = { thoughtTokens: 0 }
    // Grammar guarantees JSON *syntax* only; the main side still runs semantic
    // validation + JSON-retry. A grammar build failure must never crash the
    // worker — grammarForSchema returns null and we generate unconstrained.
    if (payload.jsonSchema) {
      const grammar = await grammarForSchema(payload.jsonSchema)
      if (grammar) promptOpts.grammar = grammar
    }
    assertPreparedPromptFits({
      session: session as unknown as Parameters<typeof assertPreparedPromptFits>[0]['session'],
      plannedContextTokens: payload.plannedContextTokens,
      actualContextTokens:
        ((useUtility ? llmUtilityContext : llmContext) as { contextSize?: number } | null)
          ?.contextSize ?? 0,
      prompt: payload.prompt,
      maxTokens: promptOpts.maxTokens!,
      signal: ctrl.signal,
    })
    log(
      'info',
      `llm.generateRaw start: task=${label} maxTokens=${promptOpts.maxTokens} noThink=${payload.noThink !== false}`,
    )
    const result = await session.promptWithMeta(payload.prompt, promptOpts)
    if (payload.requireComplete && result.stopReason === 'maxTokens') {
      throw new Error('Translation reached the model output limit. Please retry with shorter text.')
    }
    return { raw: result.responseText }
  } finally {
    log(
      'info',
      `llm.generateRaw finished: task=${label} elapsedMs=${Date.now() - startedAt} cancelled=${ctrl.signal.aborted}`,
    )
    activeAborts.delete(payload.streamId)
    if (!useUtility && saved && session.setChatHistory) {
      try {
        session.setChatHistory(saved)
      } catch {
        session.resetChatHistory?.()
        patchSessionSystemPrompt(session, llmSystemPrompt)
      }
    } else if (!useUtility) {
      session.resetChatHistory?.()
      patchSessionSystemPrompt(session, llmSystemPrompt)
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

function llmSetLanguage(systemPrompt: string): void {
  llmSystemPrompt = systemPrompt
  patchSessionSystemPrompt(llmSession, systemPrompt)
  patchSessionSystemPrompt(llmUtilitySession, systemPrompt)
}

// ---- Embedder -------------------------------------------------------------

interface AuxiliaryModel {
  gpuLayers: number
  dispose(): Promise<void>
  createEmbeddingContext(options: { contextSize: number; batchSize: number }): Promise<unknown>
  createRankingContext(options: { contextSize: number; batchSize: number }): Promise<unknown>
}

async function loadAuxiliary(
  service: 'embedder' | 'reranker',
  payload: EmbedderLoadPayload | RerankerLoadPayload,
): Promise<{
  model: AuxiliaryModel
  contexts: unknown[]
  resources: SystemResources
  placement: ServicePlan
}> {
  pushStatus(service, {
    state: 'loading',
    modelPath: payload.modelPath,
    modelName: payload.modelPath.split(/[\\/]/).pop() ?? `${service}.gguf`,
    loadProgress: 0,
    message: `Initialising ${service} backend...`,
  })
  const primary = await ensureBackend('primary', false, (message) =>
    pushStatus(service, { message }),
  )
  const resources = await planner.refresh()
  let model: AuxiliaryModel | null = null
  const contexts: unknown[] = []
  try {
    model = await (
      primary as { loadModel: (options: Record<string, unknown>) => Promise<AuxiliaryModel> }
    ).loadModel({
      modelPath: payload.modelPath,
      gpuLayers: 'max',
      onLoadProgress: (progress: number) => pushStatus(service, { loadProgress: progress }),
    })
    if (model.gpuLayers < 1)
      throw new Error(
        'Not enough GPU memory for this model. Close other GPU applications or choose a smaller model.',
      )
    const onGpu = model.gpuLayers > 0 && resources.hasGpu
    const fastGpu = onGpu && isFastDedicatedGpu(primaryGpuLabel)
    const contextOptions = {
      contextSize: payload.contextSize,
      batchSize: fastGpu || !onGpu ? payload.contextSize : VULKAN_SAFE_BATCH,
    }
    contexts.push(
      service === 'embedder'
        ? await model.createEmbeddingContext(contextOptions)
        : await model.createRankingContext(contextOptions),
    )
    if (service === 'embedder' && fastGpu) {
      for (let i = 1; i < EMBEDDER_FAST_GPU_CONTEXTS; i++) {
        try {
          contexts.push(await model.createEmbeddingContext(contextOptions))
        } catch {
          break
        }
      }
    }
    const resolved: ServicePlan = { placement: 'gpu', reason: 'GPU assigned to the active task' }
    log(
      'info',
      `${service} ready: ${resolved.placement}, ${model.gpuLayers} GPU layers (${resolved.reason})`,
    )
    return { model, contexts, resources: { ...(await planner.refresh()) }, placement: resolved }
  } catch (error) {
    for (const resource of [...contexts, model]) {
      if (hasDispose(resource)) await Promise.resolve(resource.dispose()).catch(() => undefined)
    }
    pushStatus(service, { state: 'failed', loadProgress: null, message: String(error) })
    throw error
  }
}

async function embedderLoad(payload: EmbedderLoadPayload): Promise<EmbedderLoadResult> {
  await embedderUnloadInternal()
  const loaded = await loadAuxiliary('embedder', payload)
  embedderModel = loaded.model
  embedderContexts = loaded.contexts
  embedderContextSize = payload.contextSize
  pushStatus('embedder', { state: 'ready', loadProgress: null, message: 'Embedder ready.' })
  return {
    resources: loaded.resources,
    resolvedPlacement: loaded.placement.placement,
    reason: loaded.placement.reason,
  }
}

async function embedderUnloadInternal(): Promise<void> {
  for (const ctx of embedderContexts) {
    try {
      if (hasDispose(ctx)) await ctx.dispose()
    } catch {
      /* ignore */
    }
  }
  try {
    if (embedderModel && hasDispose(embedderModel)) await embedderModel.dispose()
  } catch {
    /* ignore */
  }
  embedderContexts = []
  embedderModel = null
}

async function embedderUnload(): Promise<void> {
  await embedderUnloadInternal()
  pushStatus('embedder', { state: 'unloaded', message: 'Embedder unloaded.' })
}

async function embedderEmbed(texts: string[]): Promise<Array<number[] | null>> {
  if (embedderContexts.length === 0) throw new Error('Embedder is not loaded.')
  const contexts = embedderContexts as Array<{
    getEmbeddingFor: (text: string) => Promise<{ vector: Float32Array | number[] }>
  }>
  const tok = embedderModel as {
    tokenize?: (text: string) => number[]
    detokenize?: (tokens: number[]) => string
  }
  // Headroom for the BOS/EOS the embedding context wraps around the input.
  const maxTokens = Math.max(8, embedderContextSize - 8)
  // HARD token-clamp BEFORE the native call. An over-context passage
  // native-crashes jina-code on AMD Vulkan (0xC0000409) and bypasses the
  // per-passage try/catch — see embedderContextSize. Truncation loses the tail
  // of an oversized chunk, which is strictly better than killing the whole worker.
  const clamp = (raw: string): string => {
    let t = raw
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
    return t
  }
  // One worker per pooled context. Each worker owns its context exclusively (a
  // single context serializes internally), so passages embed concurrently
  // across the pool; results land at their original index. With a pool of 1
  // (Vulkan/CPU) this is exactly the previous strictly-sequential loop.
  const out: Array<number[] | null> = new Array(texts.length).fill(null)
  let next = 0
  await Promise.all(
    contexts.map(async (ctx) => {
      for (let i = next++; i < texts.length; i = next++) {
        const raw = texts[i]!
        if (raw.length === 0) continue
        try {
          const r = await ctx.getEmbeddingFor(clamp(raw))
          out[i] = Array.from(r.vector)
        } catch (err) {
          log(
            'warn',
            `embed passage #${i} failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }),
  )
  return out
}

// ---- Reranker -------------------------------------------------------------

async function rerankerLoad(payload: RerankerLoadPayload): Promise<RerankerLoadResult> {
  await rerankerUnloadInternal()
  const loaded = await loadAuxiliary('reranker', payload)
  rerankerModel = loaded.model
  rerankerContext = loaded.contexts[0]
  pushStatus('reranker', { state: 'ready', loadProgress: null, message: 'Reranker ready.' })
  return {
    resources: loaded.resources,
    resolvedPlacement: loaded.placement.placement,
    reason: loaded.placement.reason,
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

const configs: {
  llm?: LlmLoadPayload
  embedder?: EmbedderLoadPayload
  reranker?: RerankerLoadPayload
} = {}
const loadResults = new Map<ModelTask, LlmLoadResult | EmbedderLoadResult | RerankerLoadResult>()
let transition: ModelTransition = IDLE_MODEL_TRANSITION
function setTransition(next: ModelTransition): void {
  transition = next
  send({ ev: 'activity', activity: next })
}
function isResident(task: ModelTask): boolean {
  return task === 'llm'
    ? llmModel != null
    : task === 'embedder'
      ? embedderModel != null
      : rerankerModel != null
}
const residency = new ModelResidency({
  loaded: isResident,
  resources: async () => {
    await ensureBackend('primary', false, () => {})
    return planner.refresh()
  },
  activity: setTransition,
  unload: async (task) => {
    if (task === 'llm') await llmUnloadInternal()
    else if (task === 'embedder') await embedderUnloadInternal()
    else await rerankerUnloadInternal()
    // Available on demand even while parked. Native inference reloads it.
    pushStatus(task, { state: 'ready', resident: false, message: 'Available on demand.' })
  },
})
async function ensureResident(task: ModelTask, force = false): Promise<unknown> {
  const config = configs[task]
  if (!config) throw new Error(`${task} model is not configured.`)
  if (task === 'reranker') {
    // Defence in depth for direct worker callers and parked configurations.
    // Check BEFORE ModelResidency can evict chat to prepare an unwanted model.
    await ensureBackend('primary', false, () => {})
    const decision = assessRerankerPolicy({
      enabled: true,
      mode: (config as RerankerLoadPayload).policy ?? 'auto',
      source: 'bundled',
      resources: await planner.refresh(),
    })
    if (!decision.allowed) {
      await rerankerUnloadInternal()
      delete configs.reranker
      const message = describeRerankerDecision(decision)
      pushStatus('reranker', { state: 'unloaded', resident: false, loadProgress: null, message })
      throw new Error(message)
    }
  }
  if (!force && isResident(task)) return loadResults.get(task)
  log('info', `Preparing ${task} on GPU`)
  try {
    const result = await residency.load(task, config.weightsBytes, async () => {
      if (task === 'llm') return llmLoad(config as LlmLoadPayload)
      if (task === 'embedder') return embedderLoad(config as EmbedderLoadPayload)
      return rerankerLoad(config as RerankerLoadPayload)
    })
    loadResults.set(task, result)
    if (task === 'llm') send({ ev: 'llm.loaded', result: result as LlmLoadResult })
    pushStatus(task, { resident: true })
    return result
  } catch (error) {
    pushStatus(task, {
      state: 'failed',
      resident: false,
      loadProgress: null,
      message: String(error),
    })
    throw error
  }
}

// ---- request dispatch -----------------------------------------------------

let workerClosing = false

process.parentPort.on('message', (raw: WorkerRequest) => {
  // Some Electron versions wrap utility-process messages in { data: ... }; the
  // protocol shape lives on the message itself. Defensive unwrap so we cope
  // with both.
  const msg = (raw as unknown as { data?: WorkerRequest }).data ?? raw
  // Funnel through the FIFO serializer keyed on the op. Native-backend ops run
  // one-at-a-time; control ops (abort / setLanguage / shutdown) and any
  // unknown/malformed op bypass and reach handle() immediately.
  const queuedAt = Date.now()
  void runSerialized(msg.op, () => {
    if (workerClosing && msg.op !== 'shutdown' && msg.op !== 'llm.abort')
      throw new Error('Models worker is shutting down.')
    const waitedMs = Date.now() - queuedAt
    if (waitedMs > 1000) log('info', `${msg.op} starting after ${waitedMs} ms in the worker queue`)
    return handle(msg)
  })
    .catch((err) => {
      if ('id' in msg) fail(msg.id, err)
      else log('error', err instanceof Error ? err.message : String(err))
    })
    .finally(() => {
      if (msg.op === 'llm.ask' || msg.op === 'llm.generateRaw')
        abortedBeforeStart.delete(msg.payload.streamId)
    })
})

function rejectCancelledGeneration(streamId: string): void {
  if (workerClosing) throw new Error('Models worker is shutting down.')
  if (!abortedBeforeStart.delete(streamId)) return
  throw new Error('Generation cancelled before starting.')
}

async function handle(msg: WorkerRequest): Promise<void> {
  switch (msg.op) {
    case 'llm.load':
      if (gpuLayerPlanReuseEnabled(process.env['LOKLM_REUSE_GPU_LAYER_PLAN'])) {
        const seeded = seedGpuLayerPlanHints(gpuLayerPlans, msg.payload.gpuLayerPlanHints)
        if (seeded > 0)
          log(
            'info',
            `Restored ${seeded} qualified GPU allocation hint(s); native checks still required`,
          )
      }
      configs.llm = msg.payload
      reply(msg.id, await ensureResident('llm', true))
      return
    case 'llm.unload':
      delete configs.llm
      await llmUnload()
      reply(msg.id, null)
      return
    case 'llm.setLanguage':
      if (configs.llm)
        configs.llm = {
          ...configs.llm,
          language: msg.payload.lang,
          systemPrompt: msg.payload.systemPrompt,
        }
      llmSetLanguage(msg.payload.systemPrompt)
      reply(msg.id, null)
      return
    case 'llm.ask':
      rejectCancelledGeneration(msg.payload.streamId)
      await ensureResident('llm')
      rejectCancelledGeneration(msg.payload.streamId)
      reply(msg.id, await llmAsk(msg.payload))
      return
    case 'llm.generateRaw':
      rejectCancelledGeneration(msg.payload.streamId)
      if (msg.payload.background && !isResident('llm'))
        throw new Error('Background generation skipped: chat is parked.')
      await ensureResident('llm')
      rejectCancelledGeneration(msg.payload.streamId)
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
      configs.embedder = msg.payload
      reply(msg.id, await ensureResident('embedder', true))
      return
    case 'embedder.unload':
      delete configs.embedder
      await embedderUnload()
      reply(msg.id, null)
      return
    case 'embedder.embed':
      await ensureResident('embedder')
      reply(msg.id, await embedderEmbed(msg.payload.texts))
      return
    case 'reranker.load':
      configs.reranker = msg.payload
      reply(msg.id, await ensureResident('reranker', true))
      return
    case 'reranker.unload':
      delete configs.reranker
      await rerankerUnload()
      reply(msg.id, null)
      return
    case 'reranker.rank':
      await ensureResident('reranker')
      reply(msg.id, await rerankerRank(msg.payload.query, msg.payload.documents))
      return
    case 'gpu.restoreChat':
      if (configs.llm) await ensureResident('llm')
      reply(msg.id, null)
      return
    case 'planner.refresh':
      // Probe the actual selected GPU/backend, not a second default instance.
      await ensureBackend('primary', false, () => {})
      reply(msg.id, await planner.refresh())
      return
    case 'shutdown': {
      reply(msg.id, null)
      if (workerClosing) return
      workerClosing = true
      for (const controller of activeAborts.values()) controller.abort()
      // Let the postMessage above drain through the parent pipe before we
      // start disposing native handles. Dispose-then-exit can take seconds
      // on big GPU contexts and we want the main side to see the ack first.
      await new Promise<void>((r) => setImmediate(r))
      try {
        // Interrupt generation immediately, then wait for the owner of native
        // buffers to leave the FIFO before freeing them. Queued work is rejected
        // by the admission check above. Main enforces a bounded process timeout.
        await runSerialized('llm.unload', async () => {
          await llmUnloadInternal()
          await embedderUnloadInternal()
          await rerankerUnloadInternal()
        })
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

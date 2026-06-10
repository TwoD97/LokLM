import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { AuthService } from './services/auth/AuthService'
import { inactivityMsFromMinutes } from './services/auth/inactivity'
import { WorkspaceService } from './services/documents/WorkspaceService'
import { DocumentService } from './services/documents/DocumentService'
import { FolderSyncService } from './services/documents/FolderSyncService'
import { ImportError } from './services/documents/types'
import { isSupported as isSupportedDocPath } from './services/documents/parser'
import { EmbeddingService } from './services/embeddings/EmbeddingService'
import { EmbeddingBackfillService } from './services/embeddings/EmbeddingBackfillService'
import { RerankerService } from './services/retrieval/RerankerService'
import { RetrievalService } from './services/retrieval/RetrievalService'
import { LlamaService } from './services/llm/LlamaService'
import { shouldUnloadOnConversationSwitch } from './services/llm/conversationSwitch'
import { QAService } from './services/qa/QAService'
import { QuizService } from './services/quiz/QuizService'
import { SummarizationService, SummarizationError } from './services/summarize/SummarizationService'
import { scoreAnswers } from './services/quiz/scoring'
import { ModelDownloader, type DownloadEvent } from './services/models/ModelDownloader'
import { TranscriptionWorkerClient } from './services/workers/TranscriptionWorkerClient'
import { DiarizationWorkerClient } from './services/workers/DiarizationWorkerClient'
import { TranscriptionService } from './services/transcription/TranscriptionService'
import { WHISPER_MODELS } from './services/transcription/modelCatalog'
import { resolveWhisperModel } from './services/transcription/paths'
import type {
  TranscriptionOptions,
  TranscriptionEvent,
  WhisperModelStatus,
} from '../shared/transcription'
import {
  checkAll as checkModelsAvailability,
  sweepLegacyUserDataModels,
} from './services/models/availability'
import { ProviderRegistry } from './services/providers/Registry'
import { BundledLlmProvider } from './services/providers/bundled/BundledLlmProvider'
import { BundledEmbedderProvider } from './services/providers/bundled/BundledEmbedderProvider'
import { BundledRerankerProvider } from './services/providers/bundled/BundledRerankerProvider'
import { OllamaClient } from './services/providers/ollama/OllamaClient'
import { OllamaLlmProvider } from './services/providers/ollama/OllamaLlmProvider'
import { OllamaEmbedderProvider } from './services/providers/ollama/OllamaEmbedderProvider'
import { OllamaRerankerProvider } from './services/providers/ollama/OllamaRerankerProvider'
import { SettingsService } from './services/settings/SettingsService'
import { DEFAULT_SETTINGS, type UserSettings } from '../shared/settings'
import { isLoopbackBaseUrl } from '../shared/networkHelpers'
import { splitSentinels } from '../shared/docType'
import { extractCitationMarkers } from '../shared/citationMarkers'
import { ResourcePlanner } from './services/embeddings/ResourcePlanner'
import { ModelsWorkerClient } from './services/workers/ModelsWorkerClient'
import { DocumentsWorkerClient } from './services/workers/DocumentsWorkerClient'
import { readTierMarker } from './services/tier/TierMarker'
import { initLogger, getLogDir } from './services/logging/logger'

const __dirname = dirname(fileURLToPath(import.meta.url))

function brandAsset(file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(__dirname, '../..', 'resources', file)
}

let authService: AuthService | null = null
let didFinalPersist = false

// In-flight quiz generation streams, keyed by streamId. Module-scoped (not
// local to registerIpc) so the lock handler can abort them: a quiz generation
// runs for minutes on CPU, and (auto-)locking mid-run would otherwise leave it
// pegging the worker and writing to the database we're about to tear down.
const activeQuizStreams = new Map<string, AbortController>()

function getAuth(): AuthService {
  if (!authService) {
    authService = new AuthService(app.getPath('userData'))
    authService.setOnLock(() => {
      // Inactivity auto-lock fires here too — abort any in-flight quiz
      // generation first so it stops pegging the worker and won't write to the
      // database we're about to zero (the row is reconciled to 'failed' by the
      // resetStuckDecks sweep on next unlock). Then kill any pending warmup so a
      // backfill kicked off seconds before the lock doesn't try to use it.
      for (const ctrl of activeQuizStreams.values()) ctrl.abort()
      cancelPostLoginWarmup()
      resetSessionServices()
      broadcastAuthState()
    })
    // Pause the inactivity auto-lock while a model download is in flight —
    // multi-GB GGUFs take longer than the 15 min idle window and the user
    // sitting at the download view would otherwise get locked mid-transfer.
    authService.setInactivityGuard(() => getModelDownloader().hasAnyActive())
  }
  return authService
}

function resetSessionServices(): void {
  // The backfill + retrieval services capture a Database reference at
  // construction; after lock/logout that reference is stale, so drop both
  // singletons and let the next caller rebuild against the live Database.
  //
  // workspaceService + documentService stay cached because they hold AuthService
  // only and re-resolve the Database lazily on each call. embeddingService +
  // rerankerService are deliberately kept too — the GGUFs take seconds to
  // reload, so warming them across a lock cycle is the right UX.
  //
  // ProviderRegistry + SettingsService are also reset — the registry depends
  // on AuthService-bound state indirectly through the SettingsService, and
  // SettingsService captures a Database reference at construction.
  backfillService = null
  retrievalService = null
  qaService = null
  quizService = null
  summarizationService = null
  providerRegistry = null
  settingsService = null
  // Watchers hold OS handles on the user's folders ; they must not survive a
  // lock or logout (a different account on the same machine would otherwise
  // inherit the previous user's sync targets).
  if (folderSyncService) folderSyncService.stopAll()
}

async function scheduleBackfillForAllWorkspaces(): Promise<void> {
  // Best-effort fire-and-forget per workspace. If the embedder GGUF is
  // missing or fails to load, the backfill service silently records 'failed'
  // for each workspace and the user can retry from the settings panel later.
  // Catches inside so a single rejection doesn't break the for-loop.
  const wss = await getAuth().requireDatabase().workspaces().list()
  const svc = getBackfillService()
  for (const ws of wss) {
    void svc.run(ws.id).catch(() => undefined)
  }
}

async function startSyncWatchersForAllWorkspaces(): Promise<void> {
  // Attach fs.watch on every workspace that has sync_folders set. Watchers
  // are cheap (a single inotify/ReadDirectoryChangesW handle per folder) so
  // starting them all at login keeps "automatic file update" honest without
  // waiting for the user to first navigate into each workspace.
  const wss = await getAuth().requireDatabase().workspaces().list()
  const svc = getFolderSyncService()
  for (const ws of wss) svc.start(ws.id)
}

let workspaceService: WorkspaceService | null = null
let documentService: DocumentService | null = null
let folderSyncService: FolderSyncService | null = null
let embeddingService: EmbeddingService | null = null
let backfillService: EmbeddingBackfillService | null = null
let rerankerService: RerankerService | null = null
let retrievalService: RetrievalService | null = null
let llamaService: LlamaService | null = null
let qaService: QAService | null = null
let quizService: QuizService | null = null
let summarizationService: SummarizationService | null = null
let modelDownloader: ModelDownloader | null = null
let providerRegistry: ProviderRegistry | null = null
let settingsService: SettingsService | null = null

// Shared infrastructure for the three model services. The planner stays on
// main for its cheap pure helpers ; the worker owns its own planner instance
// for the live VRAM probe (which used to block main during getLlama init).
// Load serialisation moved into the worker too , a FIFO mutex there guards
// the heavy loadModel calls across LLM / embedder / reranker.
const sharedPlanner = new ResourcePlanner()
const modelsWorker = new ModelsWorkerClient()
// Document parsing + OCR + chunking run in their own utilityProcess, isolated
// from model inference so a heavy/scanned PDF import never stutters chat-token
// streaming or blocks main.
const documentsWorker = new DocumentsWorkerClient()
// Audio transcription (whisper via @kutalia/whisper-node-addon) and speaker
// diarization (sherpa-onnx-node) each run in their OWN dedicated utilityProcess,
// isolated from model inference + document parsing. The diarization worker is
// spawned lazily on first use.
const transcriptionWorker = new TranscriptionWorkerClient()
const diarizationWorker = new DiarizationWorkerClient()
const transcriptionService = new TranscriptionService(transcriptionWorker, diarizationWorker)
// Post-login warmup runs on a small delay so the renderer can mount the main
// UI before model loads start consuming the main thread and VRAM. The handle
// is kept so a lock/logout can cancel a pending warmup that did not yet fire.
let postLoginWarmupTimer: NodeJS.Timeout | null = null
function cancelPostLoginWarmup(): void {
  if (postLoginWarmupTimer) {
    clearTimeout(postLoginWarmupTimer)
    postLoginWarmupTimer = null
  }
}
function schedulePostLoginWarmup(): void {
  cancelPostLoginWarmup()
  // 1.5s is enough for the renderer to swap from the lock screen to the main
  // view on a typical machine ; the load lock serialises the actual work that
  // follows so even if backfill + autoLoad both fire immediately they queue.
  postLoginWarmupTimer = setTimeout(() => {
    postLoginWarmupTimer = null
    // Backfill is safe under either source — it goes through the registry, so
    // when the embedder is on Ollama it embeds via HTTP without touching the
    // bundled GGUF. Always run it; pending chunks need vectors either way.
    void scheduleBackfillForAllWorkspaces().catch(() => undefined)
    // Folder-sync watchers attach in parallel ; per-workspace fs.watch is
    // independent of the embedder so it can run as soon as the DB is up.
    void startSyncWatchersForAllWorkspaces().catch(() => undefined)
    // Skip bundled-LLM warmup when the user is on external Ollama — loading
    // a multi-GB GGUF only to leave it sitting unused is the exact resource
    // waste the source switch is meant to avoid. (Reranker is intentionally
    // not warmed: lazy-load on first retrieval is fine, and an unconditional
    // ensureReady would load bundled even when the user's on external.)
    const reg = providerRegistry
    if (!reg || reg.getLlmSource() !== 'ollama') {
      void getLlamaService()
        .autoLoad()
        .catch(() => undefined)
    }
  }, 1500)
  if (typeof postLoginWarmupTimer.unref === 'function') postLoginWarmupTimer.unref()
}

function getModelDownloader(): ModelDownloader {
  modelDownloader ??= new ModelDownloader()
  return modelDownloader
}

function getWorkspaceService(): WorkspaceService {
  workspaceService ??= new WorkspaceService(getAuth())
  return workspaceService
}

function getEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService({ planner: sharedPlanner, client: modelsWorker })
    // Like LLM: ProviderRegistry is the source of truth for which backend is
    // active. Overlay it via composeEmbedderStatus so the TitleBar dot can flip
    // to the 'ollama' (purple) visual when the user is on the external backend.
    embeddingService.subscribe((status) => broadcastEmbedderStatus(status))
  }
  return embeddingService
}

function composeEmbedderStatus(
  raw: import('../shared/documents').EmbedderStatus,
): import('../shared/documents').EmbedderStatus {
  const source = providerRegistry?.getEmbedderSource() ?? 'bundled'
  // When the user is on external Ollama the bundled embedder is unloaded —
  // its raw state would be 'unloaded'/'idle' and the TitleBar dot would go
  // grey. The active provider is Ollama, so report that as 'ready' so the
  // dot shows the purple external indicator instead. (Mirrors LLM behavior.)
  if (source === 'ollama') {
    return { ...raw, source, state: 'ready', loadProgress: null }
  }
  return { ...raw, source }
}

function broadcastEmbedderStatus(raw: import('../shared/documents').EmbedderStatus): void {
  const status = composeEmbedderStatus(raw)
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('embedder:status', status)
    } catch {
      /* ignore */
    }
  }
}

function getBackfillService(): EmbeddingBackfillService {
  if (!backfillService) {
    backfillService = new EmbeddingBackfillService(
      getAuth().requireDatabase(),
      getProviderRegistry(),
    )
  }
  return backfillService
}

function getProviderRegistry(): ProviderRegistry {
  if (!providerRegistry) {
    // The bundled providers wrap the concrete LlamaService / EmbeddingService /
    // RerankerService singletons (kept warm across lock cycles). Ollama
    // providers stay null at boot — applySettings replaces them when the user
    // points at a remote backend via the settings UI.
    const llm = getLlamaService()
    const embedder = getEmbeddingService()
    const reranker = getRerankerService()
    providerRegistry = new ProviderRegistry({
      llm: { bundled: new BundledLlmProvider(llm), ollama: null },
      embedder: { bundled: new BundledEmbedderProvider(embedder), ollama: null },
      reranker: { bundled: new BundledRerankerProvider(reranker), ollama: null },
      onFallback: (ev) => {
        for (const win of BrowserWindow.getAllWindows()) {
          try {
            win.webContents.send('provider:fallback', ev)
          } catch {
            /* renderer torn down — drop the event */
          }
        }
        // An LLM fallback flips the chat-header pill from 'ollama' to
        // 'bundled' with fallback.active = true. The next clean broadcast
        // from LlamaService (state transition, reload, etc.) naturally
        // clears the fallback flag.
        if (ev.kind === 'llm') {
          broadcastLlmStatus(getLlamaService().getStatus(), { active: true, reason: ev.reason })
        }
      },
    })
  }
  return providerRegistry
}

// The 'lite' install tier ships without the reranker on by default — it's the
// heaviest optional retrieval stage and lite targets low-RAM machines. Every
// other tier (and dev/test, where readTierMarker() returns null) keeps the
// universal default of reranker-on.
function tierBaseDefaults(): UserSettings {
  if (readTierMarker()?.tier !== 'lite') return DEFAULT_SETTINGS
  return {
    ...DEFAULT_SETTINGS,
    advanced: {
      ...DEFAULT_SETTINGS.advanced,
      reranker: { ...DEFAULT_SETTINGS.advanced.reranker, enabled: false },
    },
  }
}

function getSettingsService(): SettingsService {
  if (!settingsService) {
    settingsService = new SettingsService(
      getAuth().requireDatabase(),
      () => getAuth().persistSnapshotIfUnlocked(),
      tierBaseDefaults(),
    )
  }
  return settingsService
}

// Reads hydrated UserSettings and applies them to the live ProviderRegistry +
// bundled services. Called after settings:update and once at login/register
// after hydration. NOTE: embedder source is NOT changed here — flipping the
// embedder requires a probe-then-commit flow via embedder:trySwitchSource so
// the re-index gate stays consistent (see Task 15 + Task 17).
async function applySettings(s: UserSettings): Promise<void> {
  const reg = getProviderRegistry()

  // Session baseline for the LLM answer language. There's no query here , so
  // 'auto' falls back to the UI language ; QAService.answer sets the real
  // per-turn language ( detecting it in Auto mode ) before each ask.
  const answerBaseline =
    s.basic.answerLanguage === 'auto' ? s.basic.language : s.basic.answerLanguage

  // Push basic settings to bundled LLM:
  getLlamaService().setSelectedProfile(s.basic.llmProfile)
  void getLlamaService().setLanguage(answerBaseline)
  // (LLM context-size choice is a per-load setting — applied at next loadModel.)
  getLlamaService().setSelectedContext(s.advanced.llm.contextChoice)

  // Push placement choices:
  getEmbeddingService().setPlacement(s.advanced.embedder.placement)
  getRerankerService().setPlacement(s.advanced.reranker.placement)

  // AP-9 §3.8 "Sperre": apply the auto-lock timeout. 0 ("nie") maps to an
  // infinite timeout so the inactivity timer never trips (see inactivity.ts).
  // Runs on every settings:update AND right after login/register, so a changed
  // value takes effect immediately and the persisted value is restored on unlock.
  getAuth().setInactivityMs(inactivityMsFromMinutes(s.security.autoLockMinutes))

  // Rebuild Ollama providers from the current config (best-effort — no probe here).
  // Loopback gate (defense in depth ; the UI already blocks this path , but a
  // stale renderer or third-party IPC client must not be able to bypass it).
  // Non-loopback baseUrl without allowRemoteOllama => treat as "no ollama
  // configured" , the registry stays bundled-only.
  const o = s.advanced.ollama
  const remoteOk = isLoopbackBaseUrl(o.baseUrl) || o.allowRemoteOllama
  const haveOllama =
    remoteOk && Boolean(o.baseUrl && o.llmModel && o.embedderModel && o.rerankerModel)
  if (haveOllama) {
    const client = new OllamaClient({
      baseUrl: o.baseUrl,
      bearerToken: o.bearerToken,
      timeoutMs: o.requestTimeoutMs,
    })
    // Mirror the bundled-LLM language onto the Ollama provider so the system
    // prompt matches the user's basic.language choice. Without this, the
    // Ollama provider falls back to its constructor default ('de') and an
    // English-speaking user with Ollama active gets German system prompts.
    const llm = new OllamaLlmProvider(client, o.llmModel!)
    void llm.setLanguage(answerBaseline)
    reg.replaceOllama({
      llm,
      embedder: new OllamaEmbedderProvider(client, o.embedderModel!, null),
      reranker: new OllamaRerankerProvider(client, o.rerankerModel!),
    })
  } else {
    reg.replaceOllama({ llm: null, embedder: null, reranker: null })
  }

  // Switch sources only if Ollama providers are actually built; otherwise stay bundled.
  const nextLlmSource: 'bundled' | 'ollama' =
    haveOllama && s.advanced.llm.source === 'ollama' ? 'ollama' : 'bundled'
  const nextRerankerSource: 'bundled' | 'ollama' =
    haveOllama && s.advanced.reranker.source === 'ollama' ? 'ollama' : 'bundled'
  // Embedder used to be excluded here so a UI flip could only happen via the
  // probe-and-commit `embedder:trySwitchSource` handler (dim-mismatch guard).
  // That left a hole at login: the persisted source was already dim-verified
  // by a prior trySwitchSource, but applySettings never re-applied it, so the
  // registry stayed 'bundled' and the backfill warmed the bundled GGUF even
  // when the user had picked Ollama. Apply the persisted source here too —
  // trySwitchSource still owns runtime flips, this just rehydrates state.
  const nextEmbedderSource: 'bundled' | 'ollama' =
    haveOllama && s.advanced.embedder.source === 'ollama' ? 'ollama' : 'bundled'
  reg.setLlmSource(nextLlmSource)
  reg.setRerankerSource(nextRerankerSource)
  reg.setEmbedderSource(nextEmbedderSource)

  // Free the bundled engines whose source just flipped to external. The user
  // explicitly chose Ollama; keeping the GGUFs in memory would waste several
  // GB of RAM/VRAM. (Bundled is lazy-loaded on demand if the user flips back.)
  // Errors are swallowed — the worker's status push reflects whatever state
  // the unload actually reached.
  if (nextLlmSource === 'ollama') {
    void getLlamaService()
      .unload()
      .catch(() => undefined)
  }
  // Free the bundled reranker when it flipped to external OR when the user
  // turned the rerank stage off entirely. Either way the bundled GGUF is dead
  // weight ; unloading also drops isReady() to false so RetrievalService skips
  // the rerank pass and falls back to the fused order.
  if (nextRerankerSource === 'ollama' || !s.advanced.reranker.enabled) {
    void getRerankerService()
      .unload()
      .catch(() => undefined)
  }
  if (nextEmbedderSource === 'ollama') {
    void getEmbeddingService()
      .unload()
      .catch(() => undefined)
  }

  // The LLM source may have just changed — re-broadcast so the chat-header
  // pill reflects the new 'source' immediately, without waiting for the next
  // state transition inside LlamaService. Same overlay refresh for the
  // embedder + reranker dots in the TitleBar.
  broadcastLlmStatus(getLlamaService().getStatus())
  broadcastRerankerStatus(getRerankerService().getStatus())
  broadcastEmbedderStatus(getEmbeddingService().getStatus())
}

function getLlamaService(): LlamaService {
  if (!llamaService) {
    llamaService = new LlamaService({ planner: sharedPlanner, client: modelsWorker })
    // broadcastLlmStatus overlays ProviderRegistry's live source + fallback flag
    // onto the raw status emitted by LlamaService; sending status straight to
    // 'llm:status' would lose that overlay and lie about the active backend.
    llamaService.subscribe((status) => broadcastLlmStatus(status))
  }
  return llamaService
}

/**
 * Overlay the live provider source + an optional fallback flag onto the raw
 * status emitted by LlamaService. LlamaService always reports `source:
 * 'bundled'` in its own initializer because it has no view of the registry;
 * the registry is the source of truth for which engine is currently active.
 */
function composeLlmStatus(
  bundledStatus: import('./services/llm/LlamaService').ModelStatus,
  fallback?: { active: boolean; reason: string },
): import('./services/llm/LlamaService').ModelStatus {
  const source = providerRegistry?.getLlmSource() ?? 'bundled'
  // When Ollama is the live source, the bundled LLM is unloaded (see
  // applySettings) so its raw state is 'unloaded'/'idle' — that would render
  // the TitleBar dot grey. Force 'ready' so the dot reflects the active
  // external backend. A fallback flip is the one case we preserve the bundled
  // status untouched — the chat header pill reads fallback.active to surface
  // that the request actually ran against bundled despite source='ollama'.
  if (source === 'ollama' && !fallback) {
    return {
      ...bundledStatus,
      source,
      state: 'ready',
      loadProgress: null,
      fallback: { active: false, reason: null },
    }
  }
  return {
    ...bundledStatus,
    source,
    fallback: fallback
      ? { active: true, reason: fallback.reason }
      : { active: false, reason: null },
  }
}

function broadcastLlmStatus(
  bundledStatus: import('./services/llm/LlamaService').ModelStatus,
  fallback?: { active: boolean; reason: string },
): void {
  const status = composeLlmStatus(bundledStatus, fallback)
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('llm:status', status)
    } catch {
      /* ignore */
    }
  }
}

function getQAService(): QAService {
  if (!qaService) {
    qaService = new QAService(
      getAuth().requireDatabase(),
      getRetrievalService(),
      getProviderRegistry(),
    )
  }
  return qaService
}

function getQuizService(): QuizService {
  if (!quizService) {
    quizService = new QuizService(
      getAuth().requireDatabase(),
      getRetrievalService(),
      getProviderRegistry(),
    )
  }
  return quizService
}

function getSummarizationService(): SummarizationService {
  if (!summarizationService) {
    summarizationService = new SummarizationService(
      getAuth().requireDatabase(),
      getProviderRegistry(),
    )
  }
  return summarizationService
}

function getRerankerService(): RerankerService {
  if (!rerankerService) {
    rerankerService = new RerankerService({ planner: sharedPlanner, client: modelsWorker })
    rerankerService.subscribe((status) => broadcastRerankerStatus(status))
  }
  return rerankerService
}

function composeRerankerStatus(
  raw: import('../shared/documents').RerankerStatus,
): import('../shared/documents').RerankerStatus {
  const source = providerRegistry?.getRerankerSource() ?? 'bundled'
  // Same overlay as composeEmbedderStatus — bundled reranker is unloaded on
  // external switch, so report 'ready' so the dot reflects the live Ollama
  // backend rather than the dormant bundled service.
  if (source === 'ollama') {
    return { ...raw, source, state: 'ready', loadProgress: null }
  }
  return { ...raw, source }
}

function broadcastRerankerStatus(raw: import('../shared/documents').RerankerStatus): void {
  const status = composeRerankerStatus(raw)
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('reranker:status', status)
    } catch {
      /* ignore */
    }
  }
}

function getRetrievalService(): RetrievalService {
  if (!retrievalService) {
    retrievalService = new RetrievalService(getAuth().requireDatabase(), getProviderRegistry())
  }
  return retrievalService
}

function getDocumentService(): DocumentService {
  documentService ??= new DocumentService(
    getAuth(),
    getProviderRegistry(),
    documentsWorker,
    // AP-9 §3.8: chunk size/overlap come from the indexing settings for every
    // ingest path (import, reindex, refresh, folder-sync).
    () => getSettingsService().get().retrieval,
  )
  return documentService
}

function getFolderSyncService(): FolderSyncService {
  if (!folderSyncService) {
    folderSyncService = new FolderSyncService(getAuth(), getDocumentService())
    // Sync progress fans out to all open windows — the LibraryView listens for
    // 'sync:progress' to flip the inline indicator regardless of which window
    // triggered the run.
    folderSyncService.setSenderFactory(() => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win || win.isDestroyed()) return undefined
      return {
        send: (channel: string, payload: unknown): void => {
          for (const w of BrowserWindow.getAllWindows()) {
            try {
              w.webContents.send(channel, payload)
            } catch {
              /* ignore */
            }
          }
        },
      }
    })
  }
  return folderSyncService
}

function broadcastAuthState(): void {
  if (!authService) return
  void authService.status().then((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('auth:state', state)
    }
  })
}

function registerIpc(): void {
  ipcMain.handle('auth:status', async () => getAuth().status())

  ipcMain.handle(
    'auth:register',
    async (_e, input: { displayName: string; password: string; recoveryLang: 'de' | 'en' }) => {
      const result = await getAuth().register(input)
      broadcastAuthState()
      // Settings hydrate before any model warming so applySettings (Task 16)
      // gets a chance to swap providers / placement before autoLoad fires.
      // Warmup itself is deferred by ~1.5s so the renderer can mount the main
      // UI before model loads start consuming the main thread + VRAM.
      const settings = getSettingsService()
      await settings.hydrate()
      await applySettings(settings.get())
      // Clear any docs stuck 'indexing'/'pending' from a prior crashed session
      // BEFORE warmup starts the sync watchers (which enqueue fresh imports).
      await getDocumentService()
        .sweepOrphanedIndexing()
        .catch(() => undefined)
      // Same orphan problem for quiz decks: a deck left 'generating' by a
      // locked/closed/navigated-away session would spin forever. Flip stuck
      // decks to 'failed' so the user sees them and can retry.
      await getAuth()
        .requireDatabase()
        .quizzes()
        .resetStuckDecks()
        .catch(() => undefined)
      schedulePostLoginWarmup()
      return result
    },
  )

  ipcMain.handle('auth:login', async (e, input: { password: string }) => {
    const result = await getAuth().login(input.password, {
      // Stream stage events to the renderer so the LoginView can swap the
      // "Entsperre …" label for the actual phase ("Schlüssel ableiten…",
      // "Tresor entschlüsseln…", "Bibliothek laden…"). Per-sender send so
      // a second window doesn't see another user's login progress.
      onProgress: (stage) => {
        if (e.sender.isDestroyed()) return
        try {
          e.sender.send('auth:login-progress', { stage })
        } catch {
          /* renderer torn down mid-flight , next stage emission will be a no-op too */
        }
      },
    })
    if (result.ok) {
      broadcastAuthState()
      // Settings hydrate before any model warming so applySettings (Task 16)
      // gets a chance to swap providers / placement before autoLoad fires.
      // Warmup itself is deferred by ~1.5s so the renderer can mount the main
      // UI before model loads start consuming the main thread + VRAM.
      const settings = getSettingsService()
      await settings.hydrate()
      await applySettings(settings.get())
      // Clear any docs stuck 'indexing'/'pending' from a prior crashed session
      // BEFORE warmup starts the sync watchers (which enqueue fresh imports).
      await getDocumentService()
        .sweepOrphanedIndexing()
        .catch(() => undefined)
      // Same orphan problem for quiz decks: a deck left 'generating' by a
      // locked/closed/navigated-away session would spin forever. Flip stuck
      // decks to 'failed' so the user sees them and can retry.
      await getAuth()
        .requireDatabase()
        .quizzes()
        .resetStuckDecks()
        .catch(() => undefined)
      schedulePostLoginWarmup()
    }
    return result
  })

  ipcMain.handle('auth:logout', async () => {
    cancelPostLoginWarmup()
    await getAuth().logout()
    resetSessionServices()
    broadcastAuthState()
  })

  ipcMain.handle('auth:lock', async () => {
    cancelPostLoginWarmup()
    await getAuth().lock()
    resetSessionServices()
    broadcastAuthState()
  })

  ipcMain.handle('auth:reset', async (_e, input: { passphrase: string; newPassword: string }) => {
    const result = await getAuth().reset(input)
    if (result.ok) broadcastAuthState()
    return result
  })

  // Confirmation gate for destructive / exfiltrating actions. Re-runs argon2id
  // against the live vault header without touching session state. Honors the
  // same brute-force lockout as login.
  ipcMain.handle('auth:verifyPassword', async (_e, input: { password: string }) =>
    getAuth().verifyPassword(input.password),
  )

  // AP-9 Account §3.8: change the vault password (re-key the DEK). Requires the
  // current password; recovery codes keep working. No auth-state broadcast —
  // the session stays unlocked, the renderer just flashes success.
  ipcMain.handle(
    'auth:changePassword',
    async (_e, input: { currentPassword: string; newPassword: string }) =>
      getAuth().changePassword(input.currentPassword, input.newPassword),
  )

  // frameless-window controls , React titlebar calls these.
  ipcMain.handle('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })
  ipcMain.handle('window:toggleMaximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.handle('window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
  ipcMain.handle(
    'window:isMaximized',
    (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false,
  )

  // Reveal the log directory in the OS file manager. Used by the About tab so
  // users can grab main.log for support without knowing the per-OS path.
  ipcMain.handle('logs:openFolder', async () => {
    await shell.openPath(getLogDir())
  })

  // workspaces
  ipcMain.handle('workspaces:list', async () => getWorkspaceService().list())
  ipcMain.handle('workspaces:create', async (_e, name: string) =>
    getWorkspaceService().create(name),
  )
  ipcMain.handle('workspaces:rename', async (_e, id: number, name: string) =>
    getWorkspaceService().rename(id, name),
  )
  ipcMain.handle('workspaces:delete', async (_e, id: number) => {
    // Stop watching first — otherwise the cascade delete fires the watcher,
    // which would queue a sync against a workspace that no longer exists.
    getFolderSyncService().stop(id)
    await getWorkspaceService().delete(id)
  })

  // Folder sync — per-workspace watched directories.
  ipcMain.handle('workspaces:listSyncFolders', async (_e, workspaceId: number) =>
    getFolderSyncService().getFolders(workspaceId),
  )
  ipcMain.handle('workspaces:addSyncFolder', async (e, workspaceId: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
    }
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return null
    const folder = picked.filePaths[0]!
    const folders = await getFolderSyncService().addFolder(workspaceId, folder)
    // Kick off an immediate sync so the folder's existing contents land in
    // the library without a manual "Sync now" click.
    void getFolderSyncService()
      .sync(workspaceId)
      .catch(() => undefined)
    return folders
  })
  ipcMain.handle(
    'workspaces:removeSyncFolder',
    async (_e, workspaceId: number, folderPath: string) =>
      getFolderSyncService().removeFolder(workspaceId, folderPath),
  )
  ipcMain.handle('workspaces:syncNow', async (_e, workspaceId: number) =>
    getFolderSyncService().sync(workspaceId),
  )

  // documents
  ipcMain.handle('documents:list', async (_e, workspaceId: number) => {
    return getAuth().requireDatabase().documents().listDocumentsByWorkspace(workspaceId)
  })
  ipcMain.handle('documents:pickFiles', async (e) => {
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Dokumente',
          extensions: [
            'pdf',
            'md',
            'markdown',
            'txt',
            'rst',
            'json',
            'yaml',
            'yml',
            'toml',
            'png',
            'jpg',
            'jpeg',
            'webp',
            'tif',
            'tiff',
            'bmp',
            'gif',
          ],
        },
        { name: 'Alle Dateien', extensions: ['*'] },
      ],
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('documents:import', async (e, workspaceId: number, sourcePath: string) => {
    try {
      return await getDocumentService().importFile({
        workspaceId,
        sourcePath,
        sender: e.sender,
      })
    } catch (err) {
      if (err instanceof ImportError) {
        // surface code so renderer can localize
        throw new Error(`${err.code}: ${err.message}`)
      }
      throw err
    }
  })
  ipcMain.handle('documents:delete', async (_e, id: number) => {
    await getAuth().requireDatabase().documents().deleteDocument(id)
  })

  // Export = reveal the original file in the OS file manager. The bytes stay
  // on the user's disk ; the encrypted vault never holds a copy, so there's
  // nothing to "save as" from us. shell.showItemInFolder is a no-op when the
  // path is gone, so we stat first and return a structured "missing" result
  // for the renderer to surface.
  ipcMain.handle('documents:revealSource', async (_e, id: number) => {
    const doc = await getAuth().requireDatabase().documents().getDocument(id)
    if (!doc) throw new Error(`Document ${id} not found`)
    const { existsSync } = await import('node:fs')
    if (!existsSync(doc.sourcePath)) {
      return { ok: false as const, kind: 'missing' as const, sourcePath: doc.sourcePath }
    }
    shell.showItemInFolder(doc.sourcePath)
    return { ok: true as const, sourcePath: doc.sourcePath }
  })

  // Export = save a copy of the source file to a path the user picks. Distinct
  // from reveal/openExternal in that the gated PasswordRetypeGate runs first
  // in the renderer ; this handler only fires once verifyPassword succeeded,
  // so the user has reconfirmed they intend to write plaintext outside the
  // vault. Mirrors documents:revealSource's "stat first" guard so a missing
  // source returns a structured result instead of a crash.
  ipcMain.handle('documents:exportDocument', async (e, id: number) => {
    const doc = await getAuth().requireDatabase().documents().getDocument(id)
    if (!doc) throw new Error(`Document ${id} not found`)
    const { existsSync } = await import('node:fs')
    if (!existsSync(doc.sourcePath)) {
      return { ok: false as const, kind: 'missing' as const, message: 'Quelldatei fehlt.' }
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const { basename, extname } = await import('node:path')
    const defaultName = basename(doc.sourcePath)
    const ext = extname(doc.sourcePath).replace(/^\./, '').toLowerCase() || 'bin'
    const options: Electron.SaveDialogOptions = {
      title: 'Dokument exportieren',
      defaultPath: defaultName,
      filters: [
        { name: 'Originalformat', extensions: [ext] },
        { name: 'Alle Dateien', extensions: ['*'] },
      ],
    }
    const picked = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) {
      return { ok: false as const, kind: 'cancelled' as const, message: 'abgebrochen' }
    }
    try {
      const { copyFile } = await import('node:fs/promises')
      await copyFile(doc.sourcePath, picked.filePath)
      return { ok: true as const, destPath: picked.filePath }
    } catch (err) {
      return {
        ok: false as const,
        kind: 'write_failed' as const,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  })

  // Open externally with the OS-default app (PDF viewer, editor, etc.). Same
  // missing-file guard as reveal , plus a defense-in-depth extension check so
  // a stored sourcePath pointing at a .lnk / .url / .scpt (e.g. via a stale
  // pre-symlink-fix sync) can't get shell-executed. isSupportedDocPath only
  // accepts the doc extensions we know how to parse.
  ipcMain.handle('documents:openExternal', async (_e, id: number) => {
    const doc = await getAuth().requireDatabase().documents().getDocument(id)
    if (!doc) throw new Error(`Document ${id} not found`)
    if (!isSupportedDocPath(doc.sourcePath)) {
      return {
        ok: false as const,
        kind: 'missing' as const,
        message: 'Unsupported file type for the OS opener.',
      }
    }
    const err = await shell.openPath(doc.sourcePath)
    if (err) return { ok: false as const, kind: 'missing' as const, message: err }
    return { ok: true as const }
  })

  // Replace = pick a new file on disk + reindex against it. The doc row keeps
  // its id (so chats / quizzes referencing it stay valid), only sourcePath +
  // title + metadata flip.
  ipcMain.handle('documents:replaceSource', async (e, id: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        {
          name: 'Dokumente',
          extensions: [
            'pdf',
            'md',
            'markdown',
            'txt',
            'rst',
            'json',
            'yaml',
            'yml',
            'toml',
            'png',
            'jpg',
            'jpeg',
            'webp',
            'tif',
            'tiff',
            'bmp',
            'gif',
          ],
        },
        { name: 'Alle Dateien', extensions: ['*'] },
      ],
    }
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return null
    try {
      return await getDocumentService().replaceSource(id, picked.filePaths[0]!, e.sender)
    } catch (err) {
      if (err instanceof ImportError) throw new Error(`${err.code}: ${err.message}`)
      throw err
    }
  })

  // Refresh = re-stat + hash the existing path ; reindex only if bytes changed.
  // Returns the outcome so the UI can show "Aktuell" / "Aktualisiert" / "Quelle fehlt".
  ipcMain.handle('documents:refresh', async (e, id: number) => {
    try {
      const outcome = await getDocumentService().refreshDocument(id, e.sender)
      return { ok: true as const, outcome }
    } catch (err) {
      if (err instanceof ImportError) {
        return { ok: false as const, kind: err.code, message: err.message }
      }
      throw err
    }
  })
  ipcMain.handle('documents:listMissing', async (_e, workspaceId: number) => {
    return getAuth().requireDatabase().documents().listMissingUnacknowledged(workspaceId)
  })
  ipcMain.handle('documents:keepMissing', async (_e, id: number) => {
    await getAuth().requireDatabase().documents().dismissMissing(id)
  })
  ipcMain.handle('documents:reindex', async (e, id: number) => {
    try {
      return await getDocumentService().reindex(id, e.sender)
    } catch (err) {
      if (err instanceof ImportError) throw new Error(`${err.code}: ${err.message}`)
      throw err
    }
  })
  // Cancel still-queued imports/reindexes for a workspace (mis-dropped folder).
  // In-flight jobs finish; queued placeholder rows are deleted. Returns count.
  ipcMain.handle('documents:cancelIndexing', async (_e, workspaceId: number) => {
    return getDocumentService().cancelWorkspaceIndexing(workspaceId)
  })
  // Lazily compute (or return cached) whole-document summary. Coded errors so
  // the renderer can localize 'no_content' / 'model_not_ready' distinctly.
  ipcMain.handle('documents:summarize', async (_e, documentId: number) => {
    try {
      return await getSummarizationService().summarize(documentId)
    } catch (err) {
      if (err instanceof SummarizationError) throw new Error(`${err.code}: ${err.message}`)
      throw err
    }
  })

  // Returns every chunk of a document, ordered by ordinal. The SourceViewer
  // modal uses this to render the whole document and scroll the cited chunk
  // into view. Snake_case from the repo is flipped to camelCase here so the
  // renderer doesn't have to know about DB column names.
  ipcMain.handle('documents:listChunksForDocument', async (_e, documentId: number) => {
    const rows = await getAuth().requireDatabase().documents().listChunksForDocument(documentId)
    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      ordinal: row.ordinal,
      text: row.text,
      tokenCount: row.token_count,
      pageFrom: row.page_from,
      pageTo: row.page_to,
      headingPath: row.heading_path,
      language: row.language,
    }))
  })

  ipcMain.handle('documents:getSourceForChunk', async (_e, chunkId: number) => {
    const ctx = await getAuth().requireDatabase().documents().getCitedChunkSource(chunkId)
    if (!ctx) return null
    return {
      documentId: ctx.document.id,
      title: ctx.document.title,
      mimeType: ctx.document.mimeType,
      sourcePath: ctx.document.sourcePath,
      headingPath: ctx.headingPath,
      chunkPageFrom: ctx.pageFrom,
      chunkPageTo: ctx.pageTo,
    }
  })

  // AP-6 library search. Lexical (BM25 + ts_headline) search with type/date/size
  // filters and a sort switch — one hit per document. snake_case from the repo is
  // mapped to camelCase here, and the ts_headline ⟦…⟧ sentinels are split into
  // {text,highlighted} segments so the renderer maps them to <mark> elements
  // without ever touching innerHTML (document text is untrusted).
  ipcMain.handle(
    'documents:searchLibrary',
    async (
      _e,
      workspaceId: number,
      query: string,
      opts: import('../shared/documents').LibrarySearchOptions = {},
    ): Promise<import('../shared/documents').LibrarySearchHit[]> => {
      const rows = await getAuth()
        .requireDatabase()
        .documents()
        .searchLibrary(workspaceId, query, opts)
      return rows.map((row) => ({
        chunkId: row.chunk_id,
        documentId: row.document_id,
        documentTitle: row.document_title,
        docType: row.doc_type as import('../shared/documents').LibraryDocType,
        pageFrom: row.page_from,
        pageTo: row.page_to,
        headingPath: row.heading_path,
        score: row.score,
        addedAt: row.added_at ?? null,
        byteSize: row.byte_size ?? null,
        language: row.language,
        segments: splitSentinels(row.headline),
      }))
    },
  )

  // Returns raw bytes for a PDF document so the renderer can display the page
  // via pdfjs. We gate this on mime-type/extension so it can't be used to
  // exfiltrate arbitrary files; the caller must know a valid document id.
  ipcMain.handle('documents:readDocumentBytes', async (_e, documentId: number) => {
    const doc = await getAuth().requireDatabase().documents().getDocument(documentId)
    if (!doc) return null
    const isPdf = doc.mimeType === 'application/pdf' || /\.pdf$/i.test(doc.sourcePath)
    if (!isPdf) return null
    const { readFile } = await import('node:fs/promises')
    const buf = await readFile(doc.sourcePath)
    return new Uint8Array(buf)
  })

  // conversations
  ipcMain.handle('conversations:list', async (_e, workspaceId: number) =>
    getAuth().requireDatabase().conversations().list(workspaceId),
  )
  ipcMain.handle(
    'conversations:create',
    async (_e, workspaceId: number, title?: string, activeDocumentIds?: number[]) =>
      getAuth()
        .requireDatabase()
        .conversations()
        .create(workspaceId, title ?? null, activeDocumentIds),
  )
  ipcMain.handle('conversations:delete', async (_e, id: number) => {
    await getAuth().requireDatabase().conversations().delete(id)
  })
  ipcMain.handle(
    'conversations:setActiveDocumentIds',
    async (_e, conversationId: number, ids: number[]) => {
      await getAuth().requireDatabase().conversations().setActiveDocumentIds(conversationId, ids)
    },
  )
  ipcMain.handle('conversations:getWithMessages', async (_e, id: number) =>
    getAuth().requireDatabase().conversations().getWithMessages(id),
  )

  // Generate a chat title from the first user/assistant exchange. Idempotent
  // by design — the renderer fires this once on the first round-trip; if the
  // conversation already has a non-null title we leave it alone so a future
  // manual rename is preserved. Returns the title that ended up on the row
  // (existing or freshly generated, or null if the model couldn't produce
  // anything usable).
  ipcMain.handle('conversations:generateTitle', async (_e, id: number): Promise<string | null> => {
    const repo = getAuth().requireDatabase().conversations()
    const data = await repo.getWithMessages(id)
    if (data.conversation.title != null && data.conversation.title.trim().length > 0) {
      return data.conversation.title
    }
    const firstUser = data.messages.find((m) => m.role === 'user')
    const firstAssistant = data.messages.find((m) => m.role === 'assistant')
    if (!firstUser || !firstAssistant) return null
    const title = await getLlamaService().generateTitle(firstUser.content, firstAssistant.content)
    if (!title) return null
    await repo.setTitle(id, title)
    return title
  })

  // models — manifest-driven download + availability
  ipcMain.handle('models:status', async () => checkModelsAvailability())
  ipcMain.handle('models:download', async (_e, id: string) => {
    await getModelDownloader().download(id)
  })
  ipcMain.handle('models:cancel', async (_e, id: string) => {
    getModelDownloader().cancel(id)
  })
  // Probe free space on the download volume before kicking off a multi-GB
  // queue. Failing 6 GB into a 7 GB download because the user's disk is full
  // is a brutal first-run experience , this lets the renderer surface a
  // clear "X GB available, Y GB needed" warning up-front. statfs is in
  // Node's fs/promises (stable since 18.15); on probe failure we return
  // unknown:true so the renderer can fall back to the existing flow.
  ipcMain.handle('models:checkSpace', async (_e, requiredBytes: number) => {
    try {
      const { statfs } = await import('node:fs/promises')
      const status = await checkModelsAvailability()
      const st = await statfs(status.downloadDir)
      // `bavail` is the count available to non-superusers; multiply by blocksize.
      const availableBytes = Number(st.bavail) * Number(st.bsize)
      return {
        unknown: false as const,
        ok: availableBytes >= requiredBytes,
        availableBytes,
        requiredBytes,
      }
    } catch (err) {
      return {
        unknown: true as const,
        message: err instanceof Error ? err.message : String(err),
        requiredBytes,
      }
    }
  })
  // Subscribe to download progress events. Returns the channel name the
  // renderer should listen on; the preload bridge attaches a listener and
  // exposes an unsubscribe function.
  ipcMain.handle('models:subscribeProgress', async (e): Promise<string> => {
    const channel = `models:progress:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const off = getModelDownloader().onProgress((ev: DownloadEvent) => {
      try {
        if (!e.sender.isDestroyed()) e.sender.send(channel, ev)
      } catch {
        /* renderer torn down — drop the event */
      }
    })
    // Clean up the listener when the renderer goes away.
    e.sender.once('destroyed', off)
    return channel
  })

  // transcription — whisper + diarization in dedicated utilityProcesses. The
  // renderer decodes/resamples audio to 16 kHz mono and streams the PCM to a
  // temp file via stageChunk; run() drives transcribe → (diarize → align) and
  // forwards events on transcription:event:<streamId>.
  ipcMain.handle('transcription:stageBegin', () => transcriptionService.stager.begin())
  ipcMain.handle('transcription:stageChunk', async (_e, audioId: string, bytes: Uint8Array) => {
    await transcriptionService.stager.chunk(audioId, bytes)
  })
  ipcMain.handle('transcription:stageCommit', async (_e, audioId: string, durationSec: number) => {
    await transcriptionService.stager.commit(audioId, durationSec)
    return { audioId, durationSec }
  })
  ipcMain.handle(
    'transcription:run',
    async (e, streamId: string, audioId: string, opts: TranscriptionOptions) => {
      await transcriptionService.run(streamId, audioId, opts, (ev: TranscriptionEvent) => {
        try {
          if (!e.sender.isDestroyed()) e.sender.send(`transcription:event:${streamId}`, ev)
        } catch {
          /* renderer torn down — drop the event */
        }
      })
    },
  )
  ipcMain.handle('transcription:cancel', (_e, streamId: string) => {
    transcriptionService.cancel(streamId)
  })
  ipcMain.handle('transcription:modelStatus', (): WhisperModelStatus[] =>
    (Object.keys(WHISPER_MODELS) as Array<keyof typeof WHISPER_MODELS>).map((id) => ({
      id,
      present: resolveWhisperModel(id) != null,
      bytes: WHISPER_MODELS[id].bytes,
      downloading: false,
    })),
  )
  ipcMain.handle(
    'transcription:saveToWorkspace',
    async (e, workspaceId: number, text: string, ext: 'txt' | 'md') => {
      const path = transcriptionService.writeTranscriptFile(text, ext)
      return getDocumentService().importFile({ workspaceId, sourcePath: path, sender: e.sender })
    },
  )

  // embedder
  ipcMain.handle('embedder:status', async () =>
    composeEmbedderStatus(getEmbeddingService().getStatus()),
  )
  ipcMain.handle('embedder:info', async () => getEmbeddingService().info())
  ipcMain.handle('embedder:reload', async () => {
    await getEmbeddingService().unload()
    await getEmbeddingService().ensureReady()
    return getEmbeddingService().info()
  })
  ipcMain.handle('embedder:setPlacement', async (_e, choice: 'auto' | 'cpu' | 'gpu') => {
    getEmbeddingService().setPlacement(choice)
  })

  // backfill
  ipcMain.handle('embedder:backfillStatus', async (_e, workspaceId: number) =>
    getBackfillService().status(workspaceId),
  )
  ipcMain.handle('embedder:runBackfill', async (_e, workspaceId: number) => {
    await getBackfillService().run(workspaceId)
  })

  // retrieval (programmatic API; eval harness consumes this in 2C)
  ipcMain.handle(
    'search:hybrid',
    async (
      _e,
      workspaceId: number,
      query: string,
      topK: number,
      opts: import('../shared/documents').RetrievalOptions = {},
    ) => getRetrievalService().search(workspaceId, query, topK, opts),
  )

  // reranker
  ipcMain.handle('reranker:status', async () =>
    composeRerankerStatus(getRerankerService().getStatus()),
  )
  ipcMain.handle('reranker:info', async () => getRerankerService().info())
  ipcMain.handle('reranker:reload', async () => {
    await getRerankerService().unload()
    await getRerankerService().ensureReady()
    return getRerankerService().info()
  })
  // Pre-warm the reranker so the first chat:stream doesn't pay the GGUF load.
  // ChatView fires this on mount ; idempotent (ensureReady dedupes) so repeated
  // calls (workspace switches, re-mounts) are cheap.
  ipcMain.handle('reranker:warmup', async () => {
    // Reranker turned off in settings (default for the lite tier) : skip the
    // load entirely. Retrieval falls back to the fused order, and the TitleBar
    // hides the dot, so warming the GGUF would just waste RAM/VRAM.
    if (!getSettingsService().get().advanced.reranker.enabled) return
    void getRerankerService()
      .ensureReady()
      .catch(() => undefined)
  })
  ipcMain.handle('reranker:setPlacement', async (_e, choice: 'auto' | 'cpu' | 'gpu') => {
    getRerankerService().setPlacement(choice)
  })

  // llm
  ipcMain.handle('llm:status', async () => composeLlmStatus(getLlamaService().getStatus()))
  ipcMain.handle('llm:info', async () => getLlamaService().systemInfo())
  ipcMain.handle('llm:reload', async () => {
    await getLlamaService().unload()
    await getLlamaService().autoLoad()
    return getLlamaService().systemInfo()
  })
  ipcMain.handle(
    'llm:setProfile',
    async (_e, choice: import('../shared/documents').LlmProfileChoice) => {
      getLlamaService().setSelectedProfile(choice)
    },
  )

  // settings
  ipcMain.handle('settings:get', async () => {
    // useT() — and through it useSettings — runs on the pre-unlock login /
    // loading screens too , so settings:get is legitimately called while the
    // vault is locked. The real settings live in the encrypted DB we can't
    // read yet , so hand back defaults rather than throwing LockedError. The
    // old throw only spammed the main log and poisoned the renderer's settings
    // hook (every Settings tab stuck on "loading" after a slow-unlock race ,
    // e.g. on a reinstall). The renderer re-reads the real settings on unlock.
    if (!getAuth().isUnlocked()) return DEFAULT_SETTINGS
    return getSettingsService().get()
  })
  ipcMain.handle('settings:update', async (_e, patch: unknown) => {
    await getSettingsService().update(patch as never)
    await applySettings(getSettingsService().get())
    return getSettingsService().get()
  })
  ipcMain.handle('settings:getAvatar', async () => {
    const bytes = await getSettingsService().getAvatar()
    return bytes ? Array.from(bytes) : null
  })
  ipcMain.handle('settings:setAvatar', async (_e, bytes: number[] | null) => {
    await getSettingsService().setAvatar(bytes ? Uint8Array.from(bytes) : null)
  })
  ipcMain.handle('settings:setDisplayName', async (_e, name: string) => {
    await getAuth().setDisplayName(name)
    broadcastAuthState()
  })

  // ollama probe — UI uses this to validate the user's baseUrl/token before
  // committing the full settings:update. Returns the version + model list on
  // success so the dropdowns can populate. Loopback gate enforced here too ;
  // probing leaks the configured bearer token to a non-loopback host the
  // moment the request fires , so refuse the call until allowRemoteOllama
  // has been confirmed via the PasswordRetypeGate.
  ipcMain.handle(
    'ollama:probe',
    async (_e, cfg: { baseUrl: string; bearerToken: string | null; timeoutMs: number }) => {
      if (!isLoopbackBaseUrl(cfg.baseUrl)) {
        const allowed = getSettingsService().get().advanced.ollama.allowRemoteOllama
        if (!allowed) {
          return {
            ok: false as const,
            kind: 'remote-gate' as const,
            message: 'Externer Host nicht freigegeben.',
          }
        }
      }
      const c = new OllamaClient(cfg)
      try {
        const version = await c.version()
        const models = await c.listModels()
        return { ok: true as const, version, models }
      } catch (err) {
        const e = err as { kind?: string; message?: string }
        return {
          ok: false as const,
          kind: e.kind ?? 'unknown',
          message: e.message ?? 'unknown',
        }
      }
    },
  )

  // Embedder source switch — probe-before-commit. The candidate provider is
  // probed with a one-token embed; only on success do we flip the registry +
  // persist the new source. The renderer is responsible for kicking off any
  // re-index flow after the embedderIdentity changes.
  ipcMain.handle('embedder:trySwitchSource', async (_e, source: 'bundled' | 'ollama') => {
    const reg = getProviderRegistry()
    const target = reg.candidateEmbedder(source)
    if (!target) return { ok: false as const, kind: 'not-configured' as const }
    try {
      await target.embed(['probe'])
    } catch (err) {
      const e = err as { kind?: string; message?: string }
      return {
        ok: false as const,
        kind: (e.kind as string | undefined) ?? 'unknown',
        message: e.message ?? 'unknown',
      }
    }
    // Guard against dim drift before we commit: chunks.embedding is vector(1024).
    // A probe-successful Ollama model with a different output dim (e.g. 768)
    // would pass the HTTP roundtrip here, then silently fail downstream in
    // setChunkEmbedding *after* the backfill purge already wiped vectors. Bail
    // out now and surface a clear error to the UI via the ReindexGateModal.
    const probedDim = target.dimension()
    if (probedDim !== 1024) {
      return {
        ok: false as const,
        kind: 'dim-mismatch' as const,
        message: `Active embedding column expects 1024-dim vectors, got ${probedDim}. Re-indexing would corrupt the library.`,
      }
    }
    reg.setEmbedderSource(source)
    await getSettingsService().update({ advanced: { embedder: { source } } })
    // Free the bundled embedder when the user just chose external — same
    // reasoning as applySettings (no point keeping the GGUF resident).
    if (source === 'ollama') {
      void getEmbeddingService()
        .unload()
        .catch(() => undefined)
    }
    // Refresh the TitleBar dot — source just flipped, raw status didn't.
    broadcastEmbedderStatus(getEmbeddingService().getStatus())
    return { ok: true as const, identity: target.identity() }
  })

  // chat streaming — one stream per (sender, streamId); caller assigns id
  const activeStreams = new Map<string, AbortController>()
  ipcMain.handle(
    'chat:stream',
    async (
      e,
      streamId: string,
      workspaceId: number,
      query: string,
      opts: import('../shared/documents').AnswerOptions = {},
    ) => {
      // Answer language: honour the user's answerLanguage setting. 'de'/'en'
      // force that language ; 'auto' (the default) leaves opts.language unset so
      // QAService.answer detects it per-turn from the query (eld , mapped to the
      // two supported answer languages). The MVP used to force the language
      // unconditionally — Auto is now an explicit opt-in, so detection no longer
      // silently overrides a manual DE/EN choice. ( The UI language lives in
      // basic.language and is unaffected by this. )
      const answerLang = getSettingsService().get().basic.answerLanguage
      if (answerLang === 'de' || answerLang === 'en') opts.language = answerLang

      // AP-9 §3.8 "Treffer-K": drive chat retrieval depth from the user's
      // setting. The renderer never pins opts.topK, so this always applies for
      // chat; the configured value overrides the per-query adaptiveTopK
      // heuristic (which remains the fallback for quiz / eval callers).
      if (opts.topK == null) opts.topK = getSettingsService().get().retrieval.topK

      const conversations =
        opts.conversationId != null ? getAuth().requireDatabase().conversations() : null

      // Persist the user message up-front so chat history is intact even if
      // the stream errors or the renderer disconnects mid-flight.
      if (conversations && opts.conversationId != null) {
        await conversations.appendMessage(opts.conversationId, 'user', query)
      }

      // Register the abort controller only after the pre-flight work above
      // (settings read, DB access, user-message persist) succeeds. Registering
      // earlier would leak this entry in activeStreams whenever that work threw,
      // since the try/finally that deletes it only starts below.
      const ctrl = new AbortController()
      activeStreams.set(streamId, ctrl)

      const tokenBuffer: string[] = []
      const citations: Array<{ doc_id: number; chunk_id: number; score: number }> = []
      let refused = false
      let refusalMessage: string | null = null
      // Timing for stream metrics. streamStart marks when we begin pulling
      // from QAService.answer (after the user message is persisted),
      // firstTokenTime is set on the first 'token' event delivered to the UI.
      const streamStart = performance.now()
      let firstTokenTime: number | null = null
      let tokenCount = 0

      try {
        const stream = getQAService().answer(workspaceId, query, opts, ctrl.signal)
        for await (const ev of stream) {
          if (ctrl.signal.aborted) break
          try {
            e.sender.send(`chat:stream-event:${streamId}`, ev)
          } catch {
            ctrl.abort()
            break
          }
          if (ev.type === 'token') {
            tokenBuffer.push(ev.text)
            if (firstTokenTime == null) firstTokenTime = performance.now()
            // Each token event may coalesce several native tokens (the 8 ms
            // batcher). Count the underlying tokens, not the events, so the
            // persisted tokens/sec matches the live metric ChatView shows.
            tokenCount += ev.count ?? 1
          } else if (ev.type === 'citation')
            citations.push({ doc_id: ev.doc_id, chunk_id: ev.chunk_id, score: ev.score })
          else if (ev.type === 'refusal') {
            refused = true
            refusalMessage = ev.message
          }
        }

        // Persist the assistant turn. Even on cancel (user clicked stop, or
        // the renderer disconnected mid-stream) we still write whatever tokens
        // we got — losing the partial answer is worse than persisting a
        // truncated one. Refusal short-circuits to a fixed message.
        if (conversations && opts.conversationId != null) {
          if (refused && refusalMessage != null) {
            await conversations.appendMessage(opts.conversationId, 'assistant', refusalMessage)
          } else if (tokenBuffer.length > 0) {
            const interrupted = ctrl.signal.aborted
            const body = tokenBuffer.join('')
            const assistantContent = interrupted
              ? `${body}\n\n_[Antwort wurde unterbrochen]_`
              : body
            const ttftMs = firstTokenTime != null ? Math.round(firstTokenTime - streamStart) : null
            const elapsedSinceFirst =
              firstTokenTime != null ? (performance.now() - firstTokenTime) / 1000 : 0
            const tokensPerSec = elapsedSinceFirst > 0 ? tokenCount / elapsedSinceFirst : null
            const asst = await conversations.appendMessage(
              opts.conversationId,
              'assistant',
              assistantContent,
              { ttftMs, tokensPerSec, tokenCount },
            )
            // Reconcile citations: persist ONLY the fed chunks the model
            // actually cited in its answer, not every chunk we fed it. Without
            // this the DB recorded all fedHits as "citations" regardless of
            // whether the answer referenced them, so the persisted set never
            // matched the chips the renderer derives from [doc:X, chunk:Y]
            // markers — and a hallucinated marker had nothing to validate
            // against. citations[] is already restricted to fedHits, so the
            // intersection with the answer's markers is the faithful set.
            const citedKeys = new Set(
              extractCitationMarkers(body).map((m) => `${m.documentId}-${m.chunkId}`),
            )
            const groundedCitations = citations.filter((c) =>
              citedKeys.has(`${c.doc_id}-${c.chunk_id}`),
            )
            if (groundedCitations.length > 0) {
              await conversations.persistCitations(asst.id, groundedCitations)
            }
          }
        }
      } finally {
        activeStreams.delete(streamId)
      }
    },
  )
  ipcMain.handle('chat:cancel', async (_e, streamId: string) => {
    activeStreams.get(streamId)?.abort()
  })

  // AP-9 §3.8 "Konv.-Wechsel": the renderer calls this when the user switches to
  // a different conversation. When the setting is 'unload' we free the LLM
  // eagerly (rather than waiting for LlamaService's idle timer); 'keep' is a
  // no-op. shouldUnloadOnConversationSwitch skips the unload while any chat
  // stream is live (activeStreams) so an in-flight answer is never killed.
  ipcMain.handle('chat:conversationSwitched', async () => {
    const mode = getSettingsService().get().runtime.conversationSwitch
    if (shouldUnloadOnConversationSwitch(mode, activeStreams.size > 0)) {
      await getLlamaService()
        .unload()
        .catch(() => undefined)
    }
  })

  // quiz — see docs/superpowers/specs/2026-05-21-quiz-feature-design.md
  ipcMain.handle('quiz:list-decks', async (_e, workspaceId: number) =>
    getAuth().requireDatabase().quizzes().listDecks(workspaceId),
  )

  ipcMain.handle('quiz:get-deck', async (_e, deckId: number) => {
    const data = await getAuth().requireDatabase().quizzes().getDeckWithQuestions(deckId)
    if (!data) throw new Error(`Deck ${deckId} not found`)
    return data
  })

  ipcMain.handle(
    'quiz:create-deck',
    async (_e, input: import('../shared/quiz').CreateQuizInput) => {
      // QuizService.createDeckRow validates name/count/docs and resolves
      // language from 'auto' before insert.
      return getQuizService().createDeckRow(input)
    },
  )

  ipcMain.handle('quiz:delete-deck', async (_e, deckId: number) => {
    await getAuth().requireDatabase().quizzes().deleteDeck(deckId)
  })

  ipcMain.handle('quiz:regenerate-deck', async (_e, deckId: number) => {
    const quizzes = getAuth().requireDatabase().quizzes()
    await quizzes.clearQuestions(deckId)
    await quizzes.setDeckStatus(deckId, 'generating', null)
  })

  ipcMain.handle('quiz:generate', async (e, streamId: string, deckId: number) => {
    const ctrl = new AbortController()
    activeQuizStreams.set(streamId, ctrl)
    try {
      const stream = getQuizService().generate(deckId, ctrl.signal)
      for await (const ev of stream) {
        if (ctrl.signal.aborted) break
        try {
          e.sender.send(`quiz:generate-event:${streamId}`, ev)
        } catch {
          ctrl.abort()
          break
        }
      }
    } catch (err) {
      // A throw BEFORE the generator reaches its own try-block (service
      // construction, getDeck, model init) bypasses QuizService.generate's
      // internal failure handling. Without this catch the deck row stays
      // 'generating' forever and the renderer — which calls generate() with a
      // floating `void` — never learns it failed. Flip the row to 'failed' and
      // push an error event so the UI leaves the spinner.
      const message = err instanceof Error ? err.message : String(err)

      console.error(`[quiz] generation failed before stream start (deck ${deckId}): ${message}`)
      try {
        await getAuth().requireDatabase().quizzes().setDeckStatus(deckId, 'failed', message)
      } catch {
        /* DB unavailable — nothing more we can do */
      }
      try {
        e.sender.send(`quiz:generate-event:${streamId}`, { type: 'error', message })
      } catch {
        /* renderer gone */
      }
    } finally {
      activeQuizStreams.delete(streamId)
    }
  })
  ipcMain.handle('quiz:cancel-generate', async (_e, streamId: string) => {
    activeQuizStreams.get(streamId)?.abort()
  })

  ipcMain.handle('quiz:start-attempt', async (_e, deckId: number) =>
    getAuth().requireDatabase().quizzes().startAttempt(deckId),
  )

  ipcMain.handle(
    'quiz:finish-attempt',
    async (
      _e,
      attemptId: number,
      answers: Array<{ questionId: number; selectedIndex: number }>,
    ) => {
      const quizzes = getAuth().requireDatabase().quizzes()
      const attempt = await quizzes.getAttempt(attemptId)
      if (!attempt) throw new Error(`Attempt ${attemptId} not found`)
      const questions = await quizzes.listQuestions(attempt.deckId)
      const { scored, score } = scoreAnswers(questions, answers)
      return quizzes.finishAttempt(attemptId, scored, score)
    },
  )

  ipcMain.handle('quiz:list-attempts', async (_e, deckId: number) =>
    getAuth().requireDatabase().quizzes().listAttempts(deckId),
  )
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'LokLM',
    icon: brandAsset(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    frame: false,
    backgroundColor: '#0B1B2B',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Allow microphone capture for in-app audio recording (transcription). Scoped
  // to the media permission only; the renderer is our own trusted, isolated
  // context (contextIsolation: true, nodeIntegration: false).
  window.webContents.session.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(permission === 'media'),
  )
  window.webContents.session.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  // mirror the OS maximize/unmaximize state to the renderer so the React
  // titlebar can swap the maximize <-> restore icon.
  window.on('maximize', () => window.webContents.send('window:maximized', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized', false))

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

// Only one process is allowed to touch the encrypted vault at a time. Two
// instances would race on loklm.vault.tmp during persistSnapshot and could
// rename a mixed-content tmp over the real vault , producing an AES-GCM tag
// failure on the next login that recovery codes can't fix. The lock also
// matters in dev , where `electron-vite dev` can be started twice by mistake.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows()
    const first = wins[0]
    if (first) {
      if (first.isMinimized()) first.restore()
      first.focus()
    }
  })

  void app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.loklm.app')

    // Resolve where OCR traineddata lives so the documents worker (and the
    // inline fallback) can find it offline. Packaged → resources/tessdata
    // (build.extraResources); dev → repo/tessdata (pnpm tessdata writes here).
    process.env['LOKLM_TESSDATA_DIR'] = app.isPackaged
      ? join(process.resourcesPath, 'tessdata')
      : join(app.getAppPath(), 'tessdata')

    // File logger first — captures uncaughtException / unhandledRejection and
    // intercepts console.error/warn from every service constructed below.
    initLogger()

    // Persist renderer crashes (React errors slipping past ErrorBoundary, OOMs,
    // GPU process kills). reason is one of 'crashed' | 'killed' | 'oom' | etc.
    app.on('render-process-gone', (_e, _wc, details) => {
      console.error(
        `[renderer] process gone: reason=${details.reason} exitCode=${details.exitCode}`,
      )
    })

    // v0.3.0+ : log the installer-written tier so support has a single
    // place to confirm what the wizard recorded. Phase 4 wires this into
    // ResourcePlanner / SettingsService ; for now it's pure telemetry and
    // the legacy settings-driven path still runs unchanged.
    const tierMarker = readTierMarker()
    if (tierMarker) {
      console.log(
        `[tier] installer-recorded : ${tierMarker.tier} ` +
          `(installer ${tierMarker.installerVersion} , ${tierMarker.installedAt})`,
      )
      // One-time migration cleanup : drop the orphaned v0.2.6 userData/models
      // GGUFs now that the wizard owns models in the install dir.
      const swept = sweepLegacyUserDataModels()
      if (swept.removed > 0) {
        console.log(
          `[tier] swept ${swept.removed} legacy userData GGUF(s) , ` +
            `freed ${(swept.freedBytes / 1024 / 1024 / 1024).toFixed(1)} GB`,
        )
      }
    } else {
      console.log('[tier] no marker (pre-v0.3.0 install or dev) , using legacy settings path')
    }

    registerIpc()
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// persist the encrypted snapshot before the process exits. before-quit fires
// before the windows close , so we still have a chance to do async work here.
app.on('before-quit', (event) => {
  if (didFinalPersist || !authService) return
  if (!authService.isUnlocked()) {
    didFinalPersist = true
    return
  }
  event.preventDefault()
  void authService
    .persistSnapshotIfUnlocked()
    .catch(() => {
      /* swallow , we exit anyway and the snapshot stays at the last good state */
    })
    .finally(() => {
      didFinalPersist = true
      app.quit()
    })
})

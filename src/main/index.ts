import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { AuthService, LockedError } from './services/auth/AuthService'
import { runQuitDrain } from './lifecycle/quitDrain'
import { SessionRequests } from './lifecycle/sessionRequests'
import { SessionCloseGate } from './lifecycle/sessionCloseGate'
import { withPrivateIpcAdmission } from './lifecycle/ipcAdmission'
import { isGeneratedDocumentSource } from '../shared/documentSource'
import { validateDeleteConversationTurn } from '../shared/conversationTurn'
import type { DeleteConversationTurnInput } from '../shared/documents'
import { resolveDataDir } from './services/storage/dataDir'
import { inactivityMsFromMinutes } from './services/auth/inactivity'
import { WorkspaceService } from './services/documents/WorkspaceService'
import { DocumentService } from './services/documents/DocumentService'
import { readIndexedPdf } from './services/documents/readIndexedPdf'
import { exportDocument } from './services/documents/exportDocument'
import { FolderSyncService } from './services/documents/FolderSyncService'
import { ImportError } from './services/documents/types'
import { isSupported as isSupportedDocPath } from './services/documents/parser'
import { EmbeddingService } from './services/embeddings/EmbeddingService'
import { loadGitignore } from './services/codebase/gitignore'
import { IGNORED_DIRS } from './services/codebase/ignore'
import { EmbeddingBackfillService } from './services/embeddings/EmbeddingBackfillService'
import { WorkspaceVectorService } from './services/storage/WorkspaceVectorService'
import { RerankerService } from './services/retrieval/RerankerService'
import { RetrievalService } from './services/retrieval/RetrievalService'
import {
  applyLeanRetrievalDefaults,
  needsLeanRetrieval,
} from './services/retrieval/hardwareDefaults'
import { LlamaService, tierMarkerProfile, discoverProfiles } from './services/llm/LlamaService'
import { shouldUnloadOnConversationSwitch } from './services/llm/conversationSwitch'
import { QAService } from './services/qa/QAService'
import { runChatTurn, persistChatTurn } from './services/qa/chatTurn'
import { QuizService } from './services/quiz/QuizService'
import { SummarizationService, SummarizationError } from './services/summarize/SummarizationService'
import { WritingService, WritingError } from './services/writing/WritingService'
import type { WritingMode } from '../shared/writing'
import { scoreAnswers } from './services/quiz/scoring'
import { ModelDownloader, type DownloadEvent } from './services/models/ModelDownloader'
import { TranslationService } from './services/translation/TranslationService'
import { TRANSLATION_LANGUAGES, type TranslateOptions } from '../shared/translation'
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
import { checkAll as checkModelsAvailability } from './services/models/availability'
import { ProviderRegistry } from './services/providers/Registry'
import { BundledLlmProvider } from './services/providers/bundled/BundledLlmProvider'
import { BundledEmbedderProvider } from './services/providers/bundled/BundledEmbedderProvider'
import { BundledRerankerProvider } from './services/providers/bundled/BundledRerankerProvider'
import { OllamaClient } from './services/providers/ollama/OllamaClient'
import { OllamaLlmProvider } from './services/providers/ollama/OllamaLlmProvider'
import { OllamaEmbedderProvider } from './services/providers/ollama/OllamaEmbedderProvider'
import { OllamaRerankerProvider } from './services/providers/ollama/OllamaRerankerProvider'
import { ollamaProviderAvailability } from './services/providers/ollama/configuration'
import { OrganizerService } from './services/organizer/OrganizerService'
import { SettingsService } from './services/settings/SettingsService'
import { runtimeSettingsChanged } from './services/settings/runtimeSettings'
import { DEFAULT_SETTINGS, type UserSettings } from '../shared/settings'
import { isLoopbackBaseUrl } from '../shared/networkHelpers'
import type { WorkspaceType } from '../shared/workspaceStorage'
import { splitSentinels } from '../shared/docType'
import { ResourcePlanner } from './services/embeddings/ResourcePlanner'
import { ModelsWorkerClient } from './services/workers/ModelsWorkerClient'
import { DocumentsWorkerClient } from './services/workers/DocumentsWorkerClient'
import {
  readTierMarker,
  getEffectiveTier,
  isOllamaConnectorEnabled,
  isCodebaseIndexingEnabled,
} from './services/tier/TierMarker'
import { initLogger, getLogDir, logShutdownStage } from './services/logging/logger'

const __dirname = dirname(fileURLToPath(import.meta.url))

function brandAsset(file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(__dirname, '../..', 'resources', file)
}

let authService: AuthService | null = null
let didFinalPersist = false
// Set the first time before-quit decides to drain, so a second quit signal
// during the (possibly multi-second) drain doesn't spawn a concurrent
// drain+lock chain — every later before-quit just preventDefaults and waits.
let quitDraining = false

// The inactivity auto-lock guard suppresses the 15-min vault lock while indexing
// runs — but ONLY while it is actually advancing. If a worker wedges (a native
// embed hang is documented as possible on the iGPU Vulkan backend), the progress
// counter freezes; after this long with no progress the guard stops suppressing
// so the vault still locks instead of staying open forever.
// Generous vs. a single slow batch (seconds), tight vs. the idle window.
const INDEXING_GUARD_WATCHDOG_MS = 3 * 60_000

// Inference belongs to the window and vault session that started it. Locking
// retires every request before its late native result can reach another session.
const sessionRequests = new SessionRequests()
const sessionCloseGate = new SessionCloseGate()
let sessionRequestSequence = 0

function getAuth(): AuthService {
  if (!authService) {
    // Vault + workspaces live next to the executable (the install drive) on a
    // fresh packaged Windows/Linux install, else userData — see resolveDataDir.
    const dataDir = resolveDataDir({
      override: process.env['LOKLM_DATA_DIR'],
      isPackaged: app.isPackaged,
      platform: process.platform,
      execPath: process.execPath,
      userDataDir: app.getPath('userData'),
    })
    mkdirSync(dataDir, { recursive: true })
    console.log(`[auth] vault data dir: ${dataDir}`)
    authService = new AuthService(dataDir)
    authService.setBeforeLock(() => drainPrivateWrites().finally(() => resetSessionServices()))
    authService.setOnLock(() => {
      // The pre-lock hook already retired private work before the key wipe.
      // Final cleanup and notification also cover inactivity-triggered locks.
      cancelPostLoginWarmup()
      resetSessionServices()
      broadcastAuthState()
    })
    // Pause the inactivity auto-lock while a long background task is in flight —
    // otherwise the 15 min idle lock tears the session down mid-task: it closes
    // the workspace store (re-encrypting its files) so the in-flight loop's next
    // DB/vector write throws LockedError, cutting the work partway. Two classes
    // run unattended and outlast the idle window:
    //   - model downloads : multi-GB GGUFs, user sitting at the download view —
    //     self-clearing (download()'s finally) and user-abortable, so suppress
    //     unconditionally ;
    //   - indexing / embedding backfill : import/reindex of a large library, or
    //     catching up NULL-vector chunks. Suppressed ONLY while it is actually
    //     ADVANCING — a wedged worker (native embed hang) would otherwise pin the
    //     vault unlocked forever, defeating the 15-min lock. We watch the shared
    //     progress counter: no tick for INDEXING_GUARD_WATCHDOG_MS ⇒ treat as
    //     wedged and let the vault lock per the idle window.
    // The guard resets the idle clock each skipped tick, so the 15 min lock
    // resumes fresh the moment everything goes idle (or wedges). Singletons are
    // read with ?. (a service never built ⇒ no work) to avoid side-effect builds.
    let lastIdxTicks = -1
    let lastIdxProgressAt = 0
    authService.setInactivityGuard(() => {
      if (getModelDownloader().hasAnyActive()) return true
      const indexing =
        (documentService?.isIndexing() ?? false) || (backfillService?.isAnyRunning() ?? false)
      if (!indexing) {
        lastIdxTicks = -1
        return false
      }
      const ticks = totalIndexProgressTicks()
      const now = Date.now()
      if (ticks !== lastIdxTicks) {
        lastIdxTicks = ticks
        lastIdxProgressAt = now
      }
      return now - lastIdxProgressAt < INDEXING_GUARD_WATCHDOG_MS
    })
  }
  return authService
}

function resetSessionServices(): void {
  sessionClosing = true
  cancelPostLoginWarmup()
  sessionRequests.reset()
  documentService?.invalidateSession()
  folderSyncService?.invalidateSession()
  backfillService?.invalidateSession()
  providerRegistry?.invalidateSession()
  documentService = null
  folderSyncService = null
  void resetTranscriptionSession()
  void resetModelSession().catch(() => undefined)
  void resetDocumentsSession().catch(() => undefined)
  organizerService?.invalidate()
  settingsService?.invalidate()
  organizerService = null
  // The backfill + retrieval services capture a Database reference at
  // construction; after lock/logout that reference is stale, so drop both
  // singletons and let the next caller rebuild against the live Database.
  //
  // Workspace CRUD holds no private background work. Model service objects
  // keep subscribers, but their native worker and session state are retired.
  // Ingestion and folder watchers are recreated with the next session's stores.
  //
  // ProviderRegistry + SettingsService are also reset — the registry depends
  // on AuthService-bound state indirectly through the SettingsService, and
  // SettingsService captures a Database reference at construction.
  backfillService = null
  retrievalService = null
  // ADR-0005: holds a per-session migrated-workspaces cache + binds the live
  // master DEK via AuthService; must not survive a lock/login cycle.
  workspaceVectorService = null
  qaService = null
  quizService = null
  summarizationService = null
  writingService = null
  translationService = null
  providerRegistry = null
  settingsService = null
}

async function scheduleBackfillForAllWorkspaces(): Promise<void> {
  // Best-effort fire-and-forget per workspace. If the embedder GGUF is missing or
  // fails to load, the backfill service silently records 'failed' per workspace
  // and the user can retry from the settings panel later. Catches inside so a
  // single rejection doesn't break the loop.
  //
  // Single-embedder-per-tier (2026-06-26): ONE embedder is resident for the whole
  // install (Qwen on Standard/Pro, BGE-M3 on Lite), so there's no per-workspace
  // model swap to coordinate — every workspace backfills under the same model.
  // (On an install that just switched to the tier model, this also performs the
  // one-time migration: chunks on the previous embedder are purged + re-embedded.)
  const svc = getBackfillService()
  const epoch = warmupEpoch
  const wss = await getAuth().requireDatabase().workspaces().list()
  if (!isWarmupCurrent(epoch)) return
  for (const ws of wss) {
    void svc.run(ws.id).catch(() => undefined)
  }
}

async function startSyncWatchersForAllWorkspaces(): Promise<void> {
  // Attach fs.watch on every workspace that has sync_folders set. Watchers
  // are cheap (a single inotify/ReadDirectoryChangesW handle per folder) so
  // starting them all at login keeps "automatic file update" honest without
  // waiting for the user to first navigate into each workspace.
  const svc = getFolderSyncService()
  const epoch = warmupEpoch
  const wss = await getAuth().requireDatabase().workspaces().list()
  if (!isWarmupCurrent(epoch)) return
  for (const ws of wss) svc.start(ws.id)
}

let workspaceService: WorkspaceService | null = null
let documentService: DocumentService | null = null
let folderSyncService: FolderSyncService | null = null
let embeddingService: EmbeddingService | null = null
let backfillService: EmbeddingBackfillService | null = null
let rerankerService: RerankerService | null = null
let retrievalService: RetrievalService | null = null
let workspaceVectorService: WorkspaceVectorService | null = null
let llamaService: LlamaService | null = null
let qaService: QAService | null = null
let quizService: QuizService | null = null
let summarizationService: SummarizationService | null = null
let writingService: WritingService | null = null
let modelDownloader: ModelDownloader | null = null
let providerRegistry: ProviderRegistry | null = null
let settingsService: SettingsService | null = null
let organizerService: OrganizerService | null = null
let sessionClosing = false

function requireOpenSession(): void {
  if (!getAuth().isUnlocked() || sessionClosing) throw new LockedError()
}

function sessionGuard(): () => void {
  const isCurrent = sessionRequests.captureSession()
  return () => {
    if (!isCurrent() || !getAuth().isUnlocked()) throw new LockedError()
  }
}

async function awaitAuthenticationAdmission(): Promise<void> {
  await sessionCloseGate.waitForClose()
  if (quitDraining) throw new LockedError()
}

/** One-shot private work shares the same lock/window cancellation as streams. */
async function withSessionRequest<T>(
  scope: Parameters<SessionRequests['begin']>[0],
  sender: Electron.WebContents,
  work: (request: ReturnType<SessionRequests['begin']>) => Promise<T>,
): Promise<T> {
  requireOpenSession()
  const request = sessionRequests.begin(scope, sender.id, String(++sessionRequestSequence))
  const abort = (): void => request.controller.abort()
  sender.once('destroyed', abort)
  try {
    const result = await work(request)
    if (!request.isCurrent()) throw new LockedError()
    request.controller.signal.throwIfAborted()
    return result
  } finally {
    request.finish()
    sender.removeListener('destroyed', abort)
  }
}

function getOrganizerService(): OrganizerService {
  requireOpenSession()
  const auth = getAuth()
  organizerService ??= new OrganizerService(
    auth,
    () => auth.persistSnapshotIfUnlocked(),
    () => auth.isUnlocked(),
  )
  return organizerService
}

async function drainPrivateWrites(): Promise<void> {
  sessionClosing = true
  sessionRequests.reset()
  documentService?.invalidateSession()
  folderSyncService?.invalidateSession()
  backfillService?.invalidateSession()
  providerRegistry?.invalidateSession()
  organizerService?.invalidate()
  settingsService?.invalidate()
  // A failed worker shutdown must not let another admitted write lose its
  // database mid-cleanup. Settle every drain before the vault can close.
  const drains = await Promise.allSettled([
    documentService?.drainMutations(),
    organizerService?.drain(),
    settingsService?.drain(),
    resetTranscriptionSession(),
    resetModelSession(),
    resetDocumentsSession(),
  ])
  const failures = drains.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  )
  if (failures.length > 0) throw new AggregateError(failures, 'Private session cleanup failed.')
}
let translationService: TranslationService | null = null

// Shared infrastructure for the three model services. The planner stays on
// main for its cheap pure helpers ; the worker owns its own planner instance
// for the live VRAM probe (which used to block main during getLlama init).
// Load serialisation moved into the worker too , a FIFO mutex there guards
// the heavy loadModel calls across LLM / embedder / reranker.
const sharedPlanner = new ResourcePlanner()
const modelsWorker = new ModelsWorkerClient()
modelsWorker.onActivity((activity) => {
  const visibleActivity =
    !authService?.isUnlocked() || sessionClosing
      ? { phase: 'idle', target: null, stage: null, progress: null, error: null, jobs: [] }
      : activity
  for (const win of BrowserWindow.getAllWindows())
    if (!win.isDestroyed()) win.webContents.send('models:activity', visibleActivity)
})
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
let transcriptionReset: Promise<void> = Promise.resolve()
function resetTranscriptionSession(): Promise<void> {
  transcriptionReset = transcriptionService.resetSession()
  void transcriptionReset.catch((error: unknown) => {
    console.error('[transcription] session cleanup failed', error)
  })
  return transcriptionReset
}

let modelReset: Promise<void> = Promise.resolve()
function resetModelSession(): Promise<void> {
  llamaService?.invalidateSession()
  embeddingService?.invalidateSession()
  rerankerService?.invalidateSession()
  modelReset = modelsWorker.resetSession()
  // Observe failures here but retain the rejection for unlock: it must not
  // admit new native work until the old private process has actually exited.
  void modelReset.catch((error: unknown) =>
    console.error('[models] session cleanup failed:', error),
  )
  return modelReset
}

let documentsReset: Promise<void> = Promise.resolve()
function resetDocumentsSession(): Promise<void> {
  documentsReset = documentsWorker.resetSession()
  void documentsReset.catch((error: unknown) =>
    console.error('[documents] session cleanup failed:', error),
  )
  return documentsReset
}
// Post-login warmup runs on a small delay so the renderer can mount the main
// UI before model loads start consuming the main thread and VRAM. The handle
// is kept so a lock/logout can cancel a pending warmup that did not yet fire.
let postLoginWarmupTimer: NodeJS.Timeout | null = null
let qaWarmupPromise: Promise<void> | null = null
let warmupEpoch = 0
function isWarmupCurrent(epoch: number): boolean {
  return epoch === warmupEpoch && !sessionClosing && getAuth().isUnlocked()
}
function cancelPostLoginWarmup(): void {
  warmupEpoch++
  qaWarmupPromise = null
  if (postLoginWarmupTimer) {
    clearTimeout(postLoginWarmupTimer)
    postLoginWarmupTimer = null
  }
}
function schedulePostLoginWarmup(): void {
  cancelPostLoginWarmup()
  const epoch = warmupEpoch
  // 1.5s is enough for the renderer to swap from the lock screen to the main
  // view on a typical machine ; the load lock serialises the actual work that
  // follows so even if backfill + autoLoad both fire immediately they queue.
  postLoginWarmupTimer = setTimeout(() => {
    postLoginWarmupTimer = null
    if (!isWarmupCurrent(epoch)) return
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
    if (!qaWarmupPromise && (!reg || reg.getLlmSource() !== 'ollama')) {
      void getLlamaService()
        .ensureLoaded()
        .catch(() => undefined)
    }
  }, 1500)
  if (typeof postLoginWarmupTimer.unref === 'function') postLoginWarmupTimer.unref()
}

function getModelDownloader(): ModelDownloader {
  modelDownloader ??= new ModelDownloader()
  return modelDownloader
}

function getTranslationService(): TranslationService {
  if (!translationService) {
    const registry = getProviderRegistry()
    translationService = new TranslationService(registry, {
      ensureReady: async () => {
        if (registry.getLlmSource() !== 'ollama') {
          await getLlamaService().ensureLoaded()
        }
      },
      hasLocalModel: () => discoverProfiles().some((profile) => profile.filename !== null),
    })
  }
  return translationService
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

function getWorkspaceVectorService(): WorkspaceVectorService {
  // Bound to this vault session; old background jobs cannot resolve a new store.
  workspaceVectorService ??= new WorkspaceVectorService(getAuth())
  return workspaceVectorService
}

/** ADR-0006: immediate subdirectories of a synced folder, minus the always-on
 *  ignored dirs — the choices shown in the "which dirs to index" picker when a
 *  codebase folder has no .gitignore. */
async function listTopLevelDirs(root: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !IGNORED_DIRS.has(e.name))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

function getBackfillService(): EmbeddingBackfillService {
  if (!backfillService) {
    const vectors = getWorkspaceVectorService()
    backfillService = new EmbeddingBackfillService(
      getAuth().requireDatabase(),
      getProviderRegistry(),
      vectors.upsert.bind(vectors),
      vectors.remove.bind(vectors),
    )
    // The service broadcasts its own progress; a second subscription here
    // would duplicate every batch update sent to the renderer.
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
      },
      onLlmStatusChanged: () => broadcastLlmStatus(getLlamaService().getStatus()),
    })
  }
  return providerRegistry
}

// Reranking defaults to Auto. Actual GPU capacity determines whether the
// optional model is used; persisted off choices remain off on every tier.
function tierBaseDefaults(): UserSettings {
  return DEFAULT_SETTINGS
}

// Minimum reranker relevance score for a chunk to be fed (all tiers). Applied by
// RetrievalService only when the reranker actually ran — its scores are real
// relevance (bge-reranker-v2-m3, ~0..1), unlike the RRF fallback's ~0.03 rank
// scores. 0.2 sits in the observed gap between on-topic matches (≥0.5) and
// off-topic noise (≤0.13). The top hit is always kept, so this never empties the
// slate. Conservative on purpose: it trims obvious noise without touching the
// borderline band, so recall on genuinely-relevant chunks is unaffected.
const CHAT_RELEVANCE_FLOOR = 0.2

function getSettingsService(): SettingsService {
  if (!settingsService) {
    settingsService = new SettingsService(
      // ADR-0005: settings + avatar live in the encrypted vault body's kv store,
      // which AuthService exposes (getKv/setKv/deleteKv) — no PGlite table.
      getAuth(),
      () => getAuth().persistSnapshotIfUnlocked(),
      tierBaseDefaults(),
    )
  }
  return settingsService
}

/** Finish session preferences before the renderer can request model warmup. */
async function initializeSessionSettings(assertCurrent: () => void): Promise<void> {
  await Promise.all([transcriptionReset, modelReset, documentsReset])
  assertCurrent()
  modelsWorker.resumeSession()
  documentsWorker.resumeSession()
  sessionClosing = false
  const settings = getSettingsService()
  await settings.hydrate()
  assertCurrent()
  await applySettings(settings.get(), assertCurrent)
  assertCurrent()
  broadcastAuthState()
}

/** Registration, login and recovery share one guarded initialization path. */
async function completeSessionOpening(assertCurrent: () => void): Promise<void> {
  assertCurrent()
  await initializeSessionSettings(assertCurrent)
  const documents = getDocumentService()
  const quizzes = getAuth().requireDatabase().quizzes()
  // Reconcile interrupted work before sync watchers and model warmup resume.
  await documents.sweepOrphanedIndexing().catch(() => undefined)
  assertCurrent()
  await quizzes.resetStuckDecks().catch(() => undefined)
  assertCurrent()
  await quizzes.deleteAbandonedAttempts().catch(() => undefined)
  assertCurrent()
  schedulePostLoginWarmup()
}

// Reads hydrated UserSettings and applies them to the live ProviderRegistry +
// bundled services. Called after runtime settings change and once after vault
// hydration. A persisted embedder source is restored here; interactive source
// switching still uses embedder:trySwitchSource's dimension check.
async function applySettings(s: UserSettings, assertCurrent = sessionGuard()): Promise<void> {
  assertCurrent()
  const reg = getProviderRegistry()

  // Session baseline for the LLM answer language. There's no query here , so
  // 'auto' falls back to the UI language ; QAService.answer sets the real
  // per-turn language ( detecting it in Auto mode ) before each ask.
  const answerBaseline =
    s.basic.answerLanguage === 'auto' ? s.basic.language : s.basic.answerLanguage

  // Push basic settings to bundled LLM. The install-time tier is AUTHORITATIVE
  // over a persisted profile that contradicts it ("install-time tier wins",
  // recommendedProfileFromCache): the current UI has no profile picker, so a
  // pinned value can only be a leftover from an older build / dev experiment —
  // and it silently downgraded a standard/pro install to e.g. the lite 8K
  // profile with no way to ever reset it. 'auto' re-enters the normal
  // tier-first recommendation.
  const tierProfile = tierMarkerProfile()
  const effectiveProfile =
    tierProfile && s.basic.llmProfile !== 'auto' && s.basic.llmProfile !== tierProfile
      ? 'auto'
      : s.basic.llmProfile
  if (effectiveProfile !== s.basic.llmProfile) {
    console.log(
      `[settings] persisted llmProfile "${s.basic.llmProfile}" contradicts tier profile "${tierProfile}" — using auto (tier wins)`,
    )
  }
  getLlamaService().setSelectedProfile(effectiveProfile)
  void getLlamaService()
    .setLanguage(answerBaseline)
    .catch(() => {
      // A foreground answer retries and awaits synchronization. Do not publish
      // model/source contents from a background settings failure into app logs.
      console.warn(
        '[settings] Could not synchronize the model response language; the next request will retry.',
      )
    })
  // (LLM context-size choice is a per-load setting — applied at next loadModel.)
  getLlamaService().setSelectedContext(s.advanced.llm.contextChoice)
  // LLM device placement (Auto/Dedicated/Integrated). Resolve it against the
  // install-time GPU inventory and pin it on the worker — awaited so a physical-
  // device change restarts the worker BEFORE the LlmSection's follow-up
  // llm:reload loads the model on the new device.
  getLlamaService().setSelectedPlacement(s.advanced.llm.placement)
  await getLlamaService().applyDevicePlan()
  assertCurrent()

  // Push placement choices:
  getEmbeddingService().setPlacement(s.advanced.embedder.placement)
  getRerankerService().setPlacement(s.advanced.reranker.placement)

  // AP-9 §3.8 "Sperre": apply the auto-lock timeout. 0 ("nie") maps to an
  // infinite timeout so the inactivity timer never trips (see inactivity.ts).
  // Runs on every settings:update AND right after login/register, so a changed
  // value takes effect immediately and the persisted value is restored on unlock.
  getAuth().setInactivityMs(inactivityMsFromMinutes(s.security.autoLockMinutes))

  // Rebuild Ollama providers from the current config (best-effort — no probe here).
  // Install-time opt-in gate first : an install whose tier marker says the
  // user didn't tick the Ollama-connector checkbox never builds providers ,
  // regardless of what the persisted settings contain (e.g. a vault restored
  // from an opted-in machine).
  // Then the loopback gate (defense in depth ; the UI already blocks this
  // path , but a stale renderer or third-party IPC client must not be able
  // to bypass it). Non-loopback baseUrl without allowRemoteOllama => treat
  // as "no ollama configured" , the registry stays bundled-only.
  const o = s.advanced.ollama
  const availableOllama = ollamaProviderAvailability(o, isOllamaConnectorEnabled())
  if (Object.values(availableOllama).some(Boolean)) {
    const client = new OllamaClient({
      baseUrl: o.baseUrl,
      bearerToken: o.bearerToken,
      timeoutMs: o.requestTimeoutMs,
    })
    // Mirror the bundled-LLM language onto the Ollama provider so the system
    // prompt matches the user's basic.language choice. Without this, the
    // Ollama provider falls back to its constructor default ('de') and an
    // English-speaking user with Ollama active gets German system prompts.
    const llm = availableOllama.llm ? new OllamaLlmProvider(client, o.llmModel!) : null
    void llm?.setLanguage(answerBaseline)
    reg.replaceOllama({
      llm,
      embedder: availableOllama.embedder
        ? new OllamaEmbedderProvider(client, o.embedderModel!, null)
        : null,
      reranker: availableOllama.reranker
        ? new OllamaRerankerProvider(client, o.rerankerModel!)
        : null,
    })
  } else {
    reg.replaceOllama({ llm: null, embedder: null, reranker: null })
  }

  // Switch sources only if Ollama providers are actually built; otherwise stay bundled.
  const nextLlmSource: 'bundled' | 'ollama' =
    availableOllama.llm && s.advanced.llm.source === 'ollama' ? 'ollama' : 'bundled'
  const nextRerankerSource: 'bundled' | 'ollama' =
    availableOllama.reranker && s.advanced.reranker.source === 'ollama' ? 'ollama' : 'bundled'
  // Embedder used to be excluded here so a UI flip could only happen via the
  // probe-and-commit `embedder:trySwitchSource` handler (dim-mismatch guard).
  // That left a hole at login: the persisted source was already dim-verified
  // by a prior trySwitchSource, but applySettings never re-applied it, so the
  // registry stayed 'bundled' and the backfill warmed the bundled GGUF even
  // when the user had picked Ollama. Apply the persisted source here too —
  // trySwitchSource still owns runtime flips, this just rehydrates state.
  const nextEmbedderSource: 'bundled' | 'ollama' =
    availableOllama.embedder && s.advanced.embedder.source === 'ollama' ? 'ollama' : 'bundled'
  reg.setLlmSource(nextLlmSource)
  reg.setRerankerSource(nextRerankerSource)
  reg.setEmbedderSource(nextEmbedderSource)

  await getRerankerService().setPolicy({
    enabled: s.advanced.reranker.enabled,
    mode: s.advanced.reranker.policy,
    source: nextRerankerSource,
  })
  assertCurrent()

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
  // setPolicy above already unloads a disabled or externally provided reranker.
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
 * Overlay the selected provider and the registry's current fallback state onto the raw
 * status emitted by LlamaService. LlamaService always reports `source:
 * 'bundled'` in its own initializer because it has no view of the registry;
 * the registry is the source of truth for which engine is currently active.
 */
function composeLlmStatus(
  bundledStatus: import('./services/llm/LlamaService').ModelStatus,
): import('./services/llm/LlamaService').ModelStatus {
  const source = providerRegistry?.getLlmSource() ?? 'bundled'
  const fallback = providerRegistry?.getLlmFallback() ?? { active: false, reason: null }
  // When Ollama is the live source, the bundled LLM is unloaded (see
  // applySettings) so its raw state is 'unloaded'/'idle' — that would render
  // the TitleBar dot grey. Force 'ready' so the dot reflects the active
  // external backend. During fallback, preserve the bundled load/residency
  // status — the chat header pill reads fallback.active to surface
  // that the request actually ran against bundled despite source='ollama'.
  if (source === 'ollama' && !fallback.active) {
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
    fallback,
  }
}

function broadcastLlmStatus(
  bundledStatus: import('./services/llm/LlamaService').ModelStatus,
): void {
  const status = composeLlmStatus(bundledStatus)
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('llm:status', status)
      if (translationService)
        win.webContents.send('translation:status', translationService.status())
    } catch {
      /* ignore */
    }
  }
}

function getQAService(): QAService {
  if (!qaService) {
    const database = getAuth().requireDatabase()
    qaService = new QAService(
      database,
      getRetrievalService(),
      getProviderRegistry(),
      // doc_summary route (ADR-0003): summary intent + resolved target doc →
      // cached whole-doc summary as context instead of topK fragments.
      getSummarizationService(),
      // Codebase-aware answering (ADR-0006): same workspace+tier resolver the
      // retrieval pipeline uses — drives the code topK floor + CODE prompt mode.
      (workspaceId) => isActiveCodebaseWorkspace(workspaceId, database),
    )
  }
  return qaService
}

function getQuizService(): QuizService {
  if (!quizService) {
    quizService = new QuizService(getAuth().requireDatabase(), getProviderRegistry())
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

function getWritingService(): WritingService {
  if (!writingService) {
    writingService = new WritingService(getProviderRegistry())
  }
  return writingService
}

function getRerankerService(): RerankerService {
  if (!rerankerService) {
    rerankerService = new RerankerService({ planner: sharedPlanner, client: modelsWorker })
    rerankerService.subscribe((status) => broadcastRerankerStatus(status))
  }
  return rerankerService
}

function useLeanChatRetrieval(): boolean {
  return needsLeanRetrieval({
    tier: getEffectiveTier(),
    llmSource: providerRegistry?.getLlmSource() ?? 'bundled',
    rerankerDecision: getRerankerService().info().policyDecision,
    totalVramGB: llamaService?.systemInfo().modelCapacity?.totalVramGB,
  })
}

function composeRerankerStatus(
  raw: import('../shared/documents').RerankerStatus,
): import('../shared/documents').RerankerStatus {
  const source = providerRegistry?.getRerankerSource() ?? 'bundled'
  // Same overlay as composeEmbedderStatus — bundled reranker is unloaded on
  // external switch, so report 'ready' so the dot reflects the live Ollama
  // backend rather than the dormant bundled service.
  if (source === 'ollama' && settingsService?.get().advanced.reranker.enabled !== false) {
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
    const database = getAuth().requireDatabase()
    const store = getAuth().getWorkspaceStore()
    const vectors = getWorkspaceVectorService()
    const registry = getProviderRegistry()
    retrievalService = new RetrievalService(
      database,
      registry,
      // ADR-0005: dense search reads from the per-workspace encrypted Lance store.
      vectors.search.bind(vectors),
      // ADR-0005: relational/BM25 reads run against the workspace's SQLite store.
      (workspaceId) => store.openDb(workspaceId),
      // Codebase-workspace + tier resolver: drives the reranker gate, code
      // heuristics, and the code-vs-document query instruction. The embedder
      // identity no longer implies it (single-embedder-per-tier: Qwen serves
      // library workspaces too).
      (workspaceId) => isActiveCodebaseWorkspace(workspaceId, database),
      // Maßnahme 4 (R3), 0.6.5-Umbau: EN-variant via the RESIDENT LLM instead
      // of the MADLAD sidecar (which cost ~3 GB VRAM resident and was
      // therefore pro-only). The LLM is loaded anyway, a 96-token translation
      // is one short generate pass — Standard AND Pro get the variant now.
      // Constrained local GPUs skip this extra pass. Manual translation still
      // uses the LLM. Return null when the LLM is unavailable or the query is
      // already English; retrieval also verifies identifiers survived.
      async (q, opts) => {
        try {
          opts?.abortSignal?.throwIfAborted()
          if (useLeanChatRetrieval()) return null
          const reg = registry
          if (!reg.llm().isReady()) return null
          const { detectIsoLanguage } = await import('./services/documents/languageDetector')
          const iso = await detectIsoLanguage(q).catch(() => null)
          opts?.abortSignal?.throwIfAborted()
          if (!iso || iso === 'en') return null
          const raw = await reg
            .llm()
            .generateRaw(
              `Translate this search query to English. Keep any code identifiers ` +
                `(camelCase, snake_case, dotted.paths) EXACTLY unchanged. Output ONLY ` +
                `the translation, one line, no preamble.\n\nQuery: ${q}\n\nTranslation:`,
              { maxTokens: 96, ...(opts?.abortSignal ? { abortSignal: opts.abortSignal } : {}) },
            )
          const text = raw
            ?.split(/\r?\n/)
            .map((s) => s.trim())
            .find((s) => s.length > 3)
          return text && text.length < 240 ? text : null
        } catch (error) {
          opts?.abortSignal?.throwIfAborted()
          if (error instanceof Error && error.name === 'AbortError') throw error
          return null
        }
      },
    )
  }
  return retrievalService
}

/** True when the workspace is a 'codebase' AND the tier allows codebase indexing
 *  (Standard/Pro; no-marker/dev → allowed). Shared by retrieval + the folder gate. */
async function isActiveCodebaseWorkspace(
  workspaceId: number,
  database: ReturnType<AuthService['requireDatabase']>,
): Promise<boolean> {
  try {
    const wss = await database.workspaces().list()
    return wss.find((w) => w.id === workspaceId)?.type === 'codebase' && isCodebaseIndexingEnabled()
  } catch {
    return false
  }
}

function getDocumentService(): DocumentService {
  if (!documentService) {
    const vectors = getWorkspaceVectorService()
    const settings = getSettingsService()
    documentService = new DocumentService(
      getAuth(),
      getProviderRegistry(),
      documentsWorker,
      // AP-9 §3.8: chunk size/overlap come from the indexing settings for every
      // ingest path (import, reindex, refresh, folder-sync).
      () => settings.get().retrieval,
      // ADR-0005: mirror embeddings into the per-workspace encrypted Lance store,
      // and drop a document's vectors from it on reindex.
      vectors.upsert.bind(vectors),
      vectors.remove.bind(vectors),
    )
  }
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

// Cover the explicit lock/logout sequence (drainIndexingForLock + the vault
// re-encryption inside lock()) with the same "finishing & saving" overlay the
// quit path uses — without it a Lock click reads as a hang for up to
// LOCK_DRAIN_MAX_MS. Unlike app:quitting the window survives, so `false` is
// sent afterwards to tear the overlay back down.
function broadcastLockDraining(active: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app:locking', active)
  }
}

function broadcastAuthState(): void {
  if (!authService) return
  const isCurrent = sessionRequests.captureSession()
  void authService.status().then((state) => {
    if (!isCurrent()) return
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('auth:state', state)
    }
  })
}

function registerIpc(): void {
  registerIpcHandlers(withPrivateIpcAdmission(ipcMain, requireOpenSession, sessionGuard))
}

function registerIpcHandlers(ipcMain: Pick<Electron.IpcMain, 'handle'>): void {
  ipcMain.handle('models:activity', () =>
    !getAuth().isUnlocked() || sessionClosing
      ? { phase: 'idle', target: null, stage: null, progress: null, error: null, jobs: [] }
      : modelsWorker.activity(),
  )
  ipcMain.handle('models:cancelIndexing', async () => {
    backfillService?.cancelRunning()
    await documentService?.cancelAllIndexing(true)
  })
  ipcMain.handle('auth:status', async () => getAuth().status())

  ipcMain.handle(
    'auth:register',
    async (_e, input: { displayName: string; password: string; recoveryLang: 'de' | 'en' }) => {
      await awaitAuthenticationAdmission()
      const assertCurrent = sessionGuard()
      const result = await getAuth().register(input)
      await completeSessionOpening(assertCurrent)
      return result
    },
  )

  ipcMain.handle('auth:login', async (e, input: { password: string }) => {
    await awaitAuthenticationAdmission()
    const assertCurrent = sessionGuard()
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
      await completeSessionOpening(assertCurrent)
    }
    return result
  })

  const lockSession = (): Promise<void> =>
    sessionCloseGate.close(async () => {
      cancelPostLoginWarmup()
      broadcastLockDraining(true)
      try {
        try {
          await drainPrivateWrites()
          await drainIndexingForLock()
        } finally {
          // A failed worker shutdown or pending save must not leave the vault
          // unlocked with private-work admission already disabled.
          await getAuth().lock()
        }
      } finally {
        // Lock clears the key even when its final disk write fails. The private
        // renderer must follow the actual auth state on that rejection path too.
        if (!getAuth().isUnlocked()) {
          resetSessionServices()
          broadcastAuthState()
        }
        broadcastLockDraining(false)
      }
    })
  ipcMain.handle('auth:logout', lockSession)
  ipcMain.handle('auth:lock', lockSession)

  ipcMain.handle('auth:reset', async (_e, input: { passphrase: string; newPassword: string }) => {
    await awaitAuthenticationAdmission()
    const assertCurrent = sessionGuard()
    const result = await getAuth().reset(input)
    if (result.ok) {
      // Recovery unlocks a fresh vault session just like login. Retire any old
      // service handles before restoring preferences and provider policy.
      assertCurrent()
      resetSessionServices()
      await completeSessionOpening(sessionGuard())
    }
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

  // AP-9 Account §3.8: regenerate the recovery passphrase. Requires the current
  // password; replaces the recovery entry (old codes stop working) without
  // touching the password wrap or the body. Returns the new passphrase once.
  ipcMain.handle('auth:regenerateRecovery', async (e, input: { currentPassword: string }) =>
    withSessionRequest('read', e.sender, async () =>
      getAuth().regenerateRecovery(input.currentPassword),
    ),
  )

  // Copies a secret (recovery passphrase) and clears the clipboard after a
  // short TTL — but only if it still holds that exact text, so we never wipe
  // something the user copied afterwards. Without this the passphrase would sit
  // in the OS clipboard indefinitely, where the Windows clipboard history
  // (Win+V) and Cloud-Clipboard sync can pick it up.
  ipcMain.handle('clipboard:copySecret', async (_e, text: string) => {
    if (typeof text !== 'string' || text.length === 0) return
    clipboard.writeText(text)
    const timer = setTimeout(() => {
      try {
        if (clipboard.readText() === text) clipboard.clear()
      } catch {
        /* clipboard unavailable — nothing to clean */
      }
    }, 60_000)
    if (typeof timer.unref === 'function') timer.unref()
  })

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
  ipcMain.handle('workspaces:storageEstimate', async (_e, id: number) =>
    getWorkspaceService().getStorageEstimate(id),
  )
  ipcMain.handle('workspaces:create', async (_e, name: string, encrypted?: boolean) =>
    getWorkspaceService().create(name, { encrypted: encrypted ?? true }),
  )
  ipcMain.handle('workspaces:rename', async (_e, id: number, name: string) =>
    getWorkspaceService().rename(id, name),
  )
  // ADR-0006: set/override the workspace type, and (re)run codebase classification
  // over the synced folders (auto-runs on addFolder; this is the manual hook).
  ipcMain.handle('workspaces:setType', async (_e, id: number, type: WorkspaceType) =>
    getAuth().requireDatabase().workspaces().setType(id, type),
  )
  ipcMain.handle('workspaces:classify', async (_e, id: number) =>
    getFolderSyncService().classifyFolders(id),
  )
  ipcMain.handle('workspaces:delete', async (_e, id: number) => {
    // Stop watching first — otherwise the cascade delete fires the watcher,
    // which would queue a sync against a workspace that no longer exists.
    getFolderSyncService().stop(id)
    await getWorkspaceService().delete(id)
  })
  // ADR-0005: make a workspace the single ACTIVE one (opens its encrypted SQLite
  // store + materialises its LanceDB vectors). The renderer calls this whenever
  // the user switches workspace, so the id-keyed data ops (documents:get,
  // conversations, quizzes, …) operate on the right workspace's store.
  ipcMain.handle('workspaces:activate', (e, workspaceId: number) =>
    withSessionRequest('mutation', e.sender, async (request) => {
      const auth = getAuth()
      const backfill = getBackfillService()
      const folders = getFolderSyncService()
      await auth.activate(workspaceId)
      request.controller.signal.throwIfAborted()
      // Single-embedder-per-tier (chosen 2026-06-26): the embedder is fixed by install
      // tier — Qwen3-Embedding on Standard/Pro (serves library AND codebase), BGE-M3 on
      // Lite — with NO per-workspace model swap. So activation no longer switches models
      // or lazily fetches a code embedder. It just re-embeds any chunks still on a
      // previous embedder so the active workspace catches up promptly (best-effort +
      // deduped; the login backfill also covers every workspace).
      void backfill.run(workspaceId).catch(() => undefined)
      // Reconcile this workspace's watched folders now that it's the active one.
      // Watcher events that fired while it was inactive (or before unlock finished
      // activating it) were skipped by the active-workspace gate in FolderSync, so
      // pick up any changes made since. Fire-and-forget — activation must never
      // block on a folder walk, and a no-sync-folders workspace returns instantly.
      void folders.sync(workspaceId).catch(() => undefined)
    }),
  )
  // ADR-0005: default workspace auto-loaded on unlock.
  ipcMain.handle('workspaces:getDefault', async () => getWorkspaceService().getDefault())
  ipcMain.handle('workspaces:setDefault', async (_e, id: number | null) =>
    getWorkspaceService().setDefault(id),
  )

  // Folder sync — per-workspace watched directories.
  ipcMain.handle('workspaces:listSyncFolders', async (_e, workspaceId: number) =>
    getFolderSyncService().getFolders(workspaceId),
  )
  ipcMain.handle('workspaces:addSyncFolder', (e, workspaceId: number) =>
    withSessionRequest('mutation', e.sender, async (request) => {
      const service = getFolderSyncService()
      const win = BrowserWindow.fromWebContents(e.sender)
      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory'],
      }
      const picked = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      request.controller.signal.throwIfAborted()
      if (picked.canceled || picked.filePaths.length === 0) return null
      const folder = picked.filePaths[0]!
      const folders = await service.addFolder(workspaceId, folder)
      // ADR-0006: a codebase folder with NO .gitignore — let the renderer pick which
      // top-level directories to index BEFORE the first sync (so we don't embed the
      // whole tree). When a .gitignore exists, or it isn't a codebase, sync now as
      // before. classifyFolders is idempotent (only ever flips type → 'codebase').
      try {
        const classification = await service.classifyFolders(workspaceId)
        const hasGitignore = (await loadGitignore(folder)) !== null
        if (classification.isCodebase && !hasGitignore) {
          const topLevelDirs = await listTopLevelDirs(folder)
          if (topLevelDirs.length > 0) {
            // Defer the sync — the renderer calls setIndexDirs(...) then syncNow.
            return { folders, needsDirSelection: { folder, topLevelDirs } }
          }
        }
      } catch {
        /* classify/gitignore probe failed — fall through to a normal immediate sync */
      }
      // Kick off an immediate sync so the folder's existing contents land in
      // the library without a manual "Sync now" click.
      request.controller.signal.throwIfAborted()
      void service.sync(workspaceId).catch(() => undefined)
      return { folders }
    }),
  )
  // ADR-0006: persist / read the user's top-level-dir selection for a synced folder
  // (used when the folder has no .gitignore). Empty list ⇒ index everything.
  ipcMain.handle(
    'workspaces:getIndexDirs',
    async (_e, workspaceId: number, folder: string): Promise<string[]> =>
      getAuth().requireDatabase().workspaces().getIndexDirs(workspaceId, folder),
  )
  ipcMain.handle(
    'workspaces:setIndexDirs',
    async (_e, workspaceId: number, folder: string, dirs: string[]): Promise<void> =>
      getAuth().requireDatabase().workspaces().setIndexDirs(workspaceId, folder, dirs),
  )
  // ADR-0006: data for re-opening the dir picker on an already-synced folder
  // (edit-after-add). `selected` empty ⇒ "all" (index everything); `hasGitignore`
  // true ⇒ the folder is scoped by its .gitignore, so manual selection is moot.
  ipcMain.handle(
    'workspaces:getDirSelection',
    async (
      _e,
      workspaceId: number,
      folder: string,
    ): Promise<{ topLevelDirs: string[]; selected: string[]; hasGitignore: boolean }> => {
      const [topLevelDirs, selected, gi] = await Promise.all([
        listTopLevelDirs(folder),
        getAuth().requireDatabase().workspaces().getIndexDirs(workspaceId, folder),
        loadGitignore(folder),
      ])
      return { topLevelDirs, selected, hasGitignore: gi !== null }
    },
  )
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
  ipcMain.handle('documents:pickFiles', (e) =>
    withSessionRequest('read', e.sender, async () => {
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
    }),
  )
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
    // ADR-0005: DocumentService.deleteDocuments drops the doc's vectors from
    // the encrypted Lance store before the cascade delete wipes its chunks —
    // shared with folder-removal cleanup so no delete path orphans vectors.
    await getDocumentService().deleteDocuments([id])
  })

  // Reveal the original file in the OS file manager. Generated documents have
  // an encrypted text source instead, and the renderer hides this action.
  ipcMain.handle('documents:revealSource', (e, id: number) =>
    withSessionRequest('read', e.sender, async (request) => {
      const doc = await getAuth().requireDatabase().documents().getDocument(id)
      if (!doc) throw new Error(`Document ${id} not found`)
      const { existsSync } = await import('node:fs')
      request.controller.signal.throwIfAborted()
      if (!existsSync(doc.sourcePath)) {
        return { ok: false as const, kind: 'missing' as const, sourcePath: doc.sourcePath }
      }
      shell.showItemInFolder(doc.sourcePath)
      return { ok: true as const, sourcePath: doc.sourcePath }
    }),
  )

  // Export = save a copy of the source file to a path the user picks. Distinct
  // from reveal/openExternal in that the gated PasswordRetypeGate runs first
  // in the renderer ; this handler only fires once verifyPassword succeeded,
  // so the user has reconfirmed they intend to write plaintext outside the
  // vault. Mirrors documents:revealSource's "stat first" guard so a missing
  // source returns a structured result instead of a crash.
  ipcMain.handle('documents:exportDocument', (e, id: number) =>
    withSessionRequest('export', e.sender, async (request) => {
      const database = getAuth().requireDatabase()
      const doc = await database.documents().getDocument(id)
      if (!doc) throw new Error(`Document ${id} not found`)
      const generated = isGeneratedDocumentSource(doc.sourcePath)
      const { existsSync } = await import('node:fs')
      if (!generated && !existsSync(doc.sourcePath)) {
        return { ok: false as const, kind: 'missing' as const, message: 'Quelldatei fehlt.' }
      }
      const win = BrowserWindow.fromWebContents(e.sender)
      const { basename, extname } = await import('node:path')
      const defaultName = basename(generated ? doc.title : doc.sourcePath)
      const ext = generated
        ? doc.mimeType === 'text/markdown'
          ? 'md'
          : 'txt'
        : extname(doc.sourcePath).replace(/^\./, '').toLowerCase() || 'bin'
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
      request.controller.signal.throwIfAborted()
      try {
        if (generated) {
          const repo = await database.documentsFor(doc.workspaceId)
          const text = await repo.getGeneratedText(id)
          if (text === null)
            return {
              ok: false as const,
              kind: 'missing' as const,
              message: 'Document source unavailable.',
            }
          request.controller.signal.throwIfAborted()
          await exportDocument(picked.filePath, { text }, request.controller.signal)
        } else {
          request.controller.signal.throwIfAborted()
          await exportDocument(picked.filePath, { path: doc.sourcePath }, request.controller.signal)
        }
        return { ok: true as const, destPath: picked.filePath }
      } catch (err) {
        return {
          ok: false as const,
          kind: 'write_failed' as const,
          message: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )

  // Open externally with the OS-default app (PDF viewer, editor, etc.). Same
  // missing-file guard as reveal , plus a defense-in-depth extension check so
  // a stored sourcePath pointing at a .lnk / .url / .scpt (e.g. via a stale
  // pre-symlink-fix sync) can't get shell-executed. isSupportedDocPath only
  // accepts the doc extensions we know how to parse.
  ipcMain.handle('documents:openExternal', (e, id: number) =>
    withSessionRequest('read', e.sender, async (request) => {
      const doc = await getAuth().requireDatabase().documents().getDocument(id)
      if (!doc) throw new Error(`Document ${id} not found`)
      if (!isSupportedDocPath(doc.sourcePath)) {
        return {
          ok: false as const,
          kind: 'missing' as const,
          message: 'Unsupported file type for the OS opener.',
        }
      }
      request.controller.signal.throwIfAborted()
      const err = await shell.openPath(doc.sourcePath)
      if (err) return { ok: false as const, kind: 'missing' as const, message: err }
      return { ok: true as const }
    }),
  )

  // Replace = pick a new file on disk + reindex against it. The doc row keeps
  // its id (so chats / quizzes referencing it stay valid), only sourcePath +
  // title + metadata flip.
  ipcMain.handle('documents:replaceSource', (e, id: number) =>
    withSessionRequest('mutation', e.sender, async (request) => {
      // Resolve the origin before the native picker yields. Document IDs are
      // local to a workspace, and another window may activate a different one.
      const documents = getDocumentService()
      const doc = await getAuth().requireDatabase().documents().getDocument(id)
      if (!doc) throw new Error(`Document ${id} not found`)
      request.controller.signal.throwIfAborted()
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
      request.controller.signal.throwIfAborted()
      if (picked.canceled || picked.filePaths.length === 0) return null
      try {
        return await documents.replaceSource(id, picked.filePaths[0]!, e.sender, doc.workspaceId)
      } catch (err) {
        if (err instanceof ImportError) throw new Error(`${err.code}: ${err.message}`)
        throw err
      }
    }),
  )

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
    backfillService?.cancelWorkspace(workspaceId)
    return getDocumentService().cancelWorkspaceIndexing(workspaceId)
  })
  // Lazily compute (or return cached) whole-document summary. Coded errors so
  // the renderer can localize 'no_content' / 'model_not_ready' distinctly.
  ipcMain.handle('documents:summarize', async (e, documentId: number) => {
    try {
      return await withSessionRequest('summary', e.sender, (request) =>
        getSummarizationService().summarize(documentId, {
          abortSignal: request.controller.signal,
        }),
      )
    } catch (err) {
      if (err instanceof SummarizationError) throw new Error(`${err.code}: ${err.message}`)
      throw err
    }
  })
  // Pin/unpin a document — pinned docs get prepended to the QA context packer
  // for every chat turn in their workspace (see PINNED_BUDGET_FRAC in QAService).
  ipcMain.handle('documents:setPinned', async (_e, documentId: number, pinned: boolean) => {
    await getAuth().requireDatabase().documents().setPinned(documentId, pinned)
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
      contentHash: ctx.document.contentHash,
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

  // Return only the indexed PDF version. A changed external file must never
  // masquerade as the evidence behind a persisted citation.
  ipcMain.handle(
    'documents:readDocumentBytes',
    async (e, documentId: number, expectedHash?: string | null) =>
      withSessionRequest('read', e.sender, async (request) => {
        const database = getAuth().requireDatabase()
        const doc = await database.documents().getDocument(documentId)
        const result = await readIndexedPdf(doc, expectedHash, request.controller.signal)
        if (result.status !== 'verified' || !doc) return result
        const repo = await database.documentsFor(doc.workspaceId)
        const current = await repo.getDocument(documentId)
        if (!current) return { status: 'unavailable' as const }
        if (current.contentHash !== doc.contentHash || current.sourcePath !== doc.sourcePath)
          return { status: 'changed' as const }
        return result
      }),
  )

  ipcMain.handle('documents:readGeneratedText', (e, documentId: number) =>
    withSessionRequest('read', e.sender, async () => {
      const database = getAuth().requireDatabase()
      const doc = await database.documents().getDocument(documentId)
      if (!doc || !isGeneratedDocumentSource(doc.sourcePath)) return null
      const repo = await database.documentsFor(doc.workspaceId)
      return repo.getGeneratedText(documentId)
    }),
  )

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
  // Used by the chat Regenerate action — the renderer deletes the last
  // assistant turn before re-streaming the same user question. Citations
  // cascade-drop automatically via the FK.
  ipcMain.handle('conversations:deleteMessage', async (_e, messageId: number) => {
    await getAuth().requireDatabase().conversations().deleteMessage(messageId)
  })
  ipcMain.handle('conversations:deleteLatestTurn', (e, input: DeleteConversationTurnInput) =>
    withSessionRequest('mutation', e.sender, async (request) => {
      validateDeleteConversationTurn(input)
      const repo = await getAuth().requireDatabase().conversationsFor(input.workspaceId)
      request.controller.signal.throwIfAborted()
      await repo.deleteLatestTurn(input)
    }),
  )

  // ---- folders (user-created document organization) ----
  ipcMain.handle('folders:list', async (_e, workspaceId: number) => {
    const repo = getAuth().requireDatabase().folders()
    const [folders, assignments] = await Promise.all([
      repo.list(workspaceId),
      repo.listAssignments(workspaceId),
    ])
    return { folders, assignments }
  })
  ipcMain.handle(
    'folders:create',
    async (_e, workspaceId: number, name: string, parentId: number | null) =>
      getAuth().requireDatabase().folders().create(workspaceId, name, parentId),
  )
  ipcMain.handle('folders:rename', async (_e, workspaceId: number, id: number, name: string) => {
    await getAuth().requireDatabase().folders().rename(workspaceId, id, name)
  })
  ipcMain.handle('folders:delete', async (_e, workspaceId: number, id: number) => {
    await getAuth().requireDatabase().folders().delete(workspaceId, id)
  })
  ipcMain.handle(
    'folders:setDocumentFolder',
    async (_e, workspaceId: number, documentId: number, folderId: number | null) => {
      await getAuth()
        .requireDatabase()
        .folders()
        .setDocumentFolder(workspaceId, documentId, folderId)
    },
  )

  // Generate a chat title from the first user/assistant exchange. Idempotent
  // by design — the renderer fires this once on the first round-trip; if the
  // conversation already has a non-null title we leave it alone so a future
  // manual rename is preserved. Returns the title that ended up on the row
  // (existing or freshly generated, or null if the model couldn't produce
  // anything usable).
  ipcMain.handle('conversations:generateTitle', async (e, id: number): Promise<string | null> => {
    return withSessionRequest('title', e.sender, async (request) => {
      const database = getAuth().requireDatabase()
      const data = await database.conversations().getWithMessages(id)
      request.controller.signal.throwIfAborted()
      if (!data) return null
      if (data.conversation.title != null && data.conversation.title.trim().length > 0) {
        return data.conversation.title
      }
      const repo = await database.conversationsFor(data.conversation.workspaceId)
      request.controller.signal.throwIfAborted()
      const firstUser = data.messages.find((m) => m.role === 'user')
      const firstAssistant = data.messages.find((m) => m.role === 'assistant')
      if (!firstUser || !firstAssistant) return null
      const title = await getLlamaService().generateTitle(
        firstUser.content,
        firstAssistant.content,
        {
          abortSignal: request.controller.signal,
        },
      )
      request.controller.signal.throwIfAborted()
      if (!title) return null
      return await repo.setTitleIfEmpty(id, title)
    })
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

  // Translation shares the selected LLM. Requests are scoped to their window,
  // so closing a panel/window cancels only its own queued or running work.
  ipcMain.handle('translation:status', async () => getTranslationService().status())
  ipcMain.handle('translation:translate', async (e, text: string, opts: TranslateOptions) => {
    requireOpenSession()
    const requestId =
      opts?.requestId ?? `translation-${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) {
      throw new Error('Invalid translation request ID.')
    }
    const request = sessionRequests.begin('translation', e.sender.id, requestId)
    const controller = request.controller
    const abort = (): void => controller.abort()
    e.sender.once('destroyed', abort)
    try {
      const result = await getTranslationService().translate(text, opts, {
        abortSignal: controller.signal,
        onProgress: (progress) => {
          if (request.isCurrent() && !e.sender.isDestroyed())
            e.sender.send('translation:progress', { requestId, ...progress })
        },
      })
      if (!request.isCurrent()) throw new LockedError()
      return result
    } finally {
      request.finish()
      e.sender.removeListener('destroyed', abort)
    }
  })
  ipcMain.handle('translation:cancel', (e, requestId: string) => {
    sessionRequests.cancel('translation', e.sender.id, requestId)
  })
  ipcMain.handle('translation:languages', async () => TRANSLATION_LANGUAGES)
  // Pull a document's indexed text (chunks joined in order) for translation.
  // Reuses the same chunk store the summarizer reads — no re-parse of the
  // original file.
  ipcMain.handle('translation:documentText', async (_e, documentId: number) => {
    requireOpenSession()
    const database = getAuth().requireDatabase()
    const doc = await database.documents().getDocument(documentId)
    if (!doc) throw new Error('Document not found')
    const repo = await database.documentsFor(doc.workspaceId)
    const chunks = await repo.listChunksForDocument(documentId)
    return { title: doc.title, text: chunks.map((c) => c.text).join('\n\n') }
  })
  // Save a translation as a new document in the workspace , routed through the
  // normal import pipeline so it gets chunked + embedded like any other doc.
  ipcMain.handle(
    'translation:saveDocument',
    async (e, workspaceId: number, title: string, text: string, target: string) => {
      requireOpenSession()
      const base =
        title
          .replace(/\.[a-z0-9]{1,8}$/i, '') // drop the source extension (report.pdf → report)
          .replace(/[\\/:*?"<>|\r\n]/g, '_')
          .slice(0, 100)
          .trim() || 'document'
      return getDocumentService().importGeneratedText({
        workspaceId,
        title: `${base} (${target}).md`,
        text,
        mimeType: 'text/markdown',
        sender: e.sender,
      })
    },
  )

  // writing — DeepL-Write-style rewriting on the bundled chat LLM. generateRaw
  // won't auto-load , so ensure the bundled model is warming before we ask
  // (the post-login warmup usually beat us here; this covers the cold case).
  // Skipped when the user is on external Ollama — its provider reports ready
  // by reachability and there's no local GGUF to load.
  ipcMain.handle('writing:improve', async (e, text: string, mode: WritingMode) => {
    try {
      return await withSessionRequest('writing', e.sender, async (request) => {
        const reg = getProviderRegistry()
        if (!reg.llm().isReady() && reg.getLlmSource() !== 'ollama') {
          await getLlamaService().ensureLoaded()
        }
        request.controller.signal.throwIfAborted()
        return getWritingService().improve(text, mode, {
          abortSignal: request.controller.signal,
        })
      })
    } catch (err) {
      if (err instanceof WritingError) throw new Error(`${err.code}: ${err.message}`)
      console.error('[writing] rewrite failed:', err)
      throw err
    }
  })

  // transcription — whisper + diarization in dedicated utilityProcesses. The
  // renderer decodes/resamples audio to 16 kHz mono and streams the PCM to a
  // temp file via stageChunk; run() drives transcribe → (diarize → align) and
  // forwards events on transcription:event:<streamId>.
  ipcMain.handle('transcription:stageBegin', () => {
    requireOpenSession()
    return transcriptionService.stager.begin()
  })
  ipcMain.handle('transcription:stageChunk', async (_e, audioId: string, bytes: Uint8Array) => {
    requireOpenSession()
    await transcriptionService.stager.chunk(audioId, bytes)
  })
  ipcMain.handle('transcription:stageCommit', async (_e, audioId: string, durationSec: number) => {
    requireOpenSession()
    await transcriptionService.stager.commit(audioId)
    return { audioId, durationSec }
  })
  ipcMain.handle(
    'transcription:run',
    async (e, streamId: string, audioId: string, opts: TranscriptionOptions) => {
      requireOpenSession()
      const key = `${e.sender.id}:${streamId}`
      const cancel = (): void => transcriptionService.cancel(key)
      e.sender.once('destroyed', cancel)
      try {
        await transcriptionService.run(key, audioId, opts, (ev: TranscriptionEvent) => {
          if (sessionClosing || !getAuth().isUnlocked()) {
            if (ev.type !== 'done' && ev.type !== 'error') return
            ev = { type: 'done', segments: [] }
          }
          try {
            if (!e.sender.isDestroyed()) e.sender.send(`transcription:event:${streamId}`, ev)
          } catch {
            /* renderer torn down — drop the event */
          }
        })
      } finally {
        e.sender.removeListener('destroyed', cancel)
      }
    },
  )
  ipcMain.handle('transcription:cancel', (e, streamId: string) => {
    transcriptionService.cancel(`${e.sender.id}:${streamId}`)
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
      requireOpenSession()
      if (ext !== 'txt' && ext !== 'md') throw new Error('Invalid transcript format')
      return getDocumentService().importGeneratedText({
        workspaceId,
        title: `transcript-${Date.now()}.${ext}`,
        text,
        mimeType: ext === 'md' ? 'text/markdown' : 'text/plain',
        sender: e.sender,
      })
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
  // Distinct documents that still have un-embedded chunks — the Library polls
  // this while a backfill runs to mark only the actually-pending rows as
  // 're-embedding' (instead of painting the whole workspace).
  ipcMain.handle('embedder:pendingReembedDocs', async (_e, workspaceId: number) =>
    getAuth().requireDatabase().documents().documentIdsMissingEmbedding(workspaceId),
  )
  ipcMain.handle('embedder:runBackfill', async (_e, workspaceId: number) => {
    // Single-embedder-per-tier: the resident model is fixed by tier, so a manual
    // retry just re-embeds NULL/stale chunks under it — no preference to set.
    await getBackfillService().run(workspaceId)
  })

  // retrieval (programmatic API; eval harness consumes this in 2C)
  ipcMain.handle(
    'search:hybrid',
    async (
      e,
      workspaceId: number,
      query: string,
      topK: number,
      opts: import('../shared/documents').RetrievalOptions = {},
    ) =>
      withSessionRequest('search', e.sender, (request) =>
        getRetrievalService().search(workspaceId, query, topK, {
          ...opts,
          abortSignal: request.controller.signal,
        }),
      ),
  )

  // reranker
  ipcMain.handle('reranker:status', async () =>
    composeRerankerStatus(getRerankerService().getStatus()),
  )
  ipcMain.handle('reranker:info', async () => {
    const reranker = getRerankerService()
    await reranker.refreshPolicy()
    const info = reranker.info()
    return { ...info, ...composeRerankerStatus(info) }
  })
  ipcMain.handle('reranker:reload', async () => {
    const reg = getProviderRegistry()
    if (reg.getRerankerSource() === 'bundled') await getRerankerService().unload()
    if (getSettingsService().get().advanced.reranker.enabled) await reg.reranker().ensureReady()
    const info = getRerankerService().info()
    return { ...info, ...composeRerankerStatus(info) }
  })
  // Pre-warm the reranker so the first chat:stream doesn't pay the GGUF load.
  // ChatView fires this on mount ; idempotent (ensureReady dedupes) so repeated
  // calls (workspace switches, re-mounts) are cheap.
  ipcMain.handle('reranker:warmup', async () => {
    // The provider and service enforce source choice and hardware policy.
    if (!getSettingsService().get().advanced.reranker.enabled) return
    void getProviderRegistry()
      .reranker()
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
  // Warm every model the QA pipeline needs, for the post-unlock loading screen.
  // Load them ONE AT A TIME (awaited in sequence): all three share a single
  // node-llama-cpp backend, and firing the loads concurrently makes the native
  // inits fight for the same device — thrash on an iGPU, up to "not responding".
  // Warm small retrieval models first and finish with chat resident. The
  // parked configurations remain ready on demand; startup does not keep
  // every model in GPU memory or load chat twice on a small card.
  ipcMain.handle('models:warmupForQa', async () => {
    requireOpenSession()
    if (qaWarmupPromise) return
    const epoch = warmupEpoch
    const reg = getProviderRegistry()
    const rerankerEnabled = getSettingsService().get().advanced.reranker.enabled
    const llama = getLlamaService()
    const warming = (async () => {
      await reg
        .embedder()
        .ensureReady()
        .catch(() => undefined)
      if (!isWarmupCurrent(epoch)) return
      if (rerankerEnabled)
        await reg
          .reranker()
          .ensureReady()
          .catch(() => undefined)
      if (!isWarmupCurrent(epoch)) return
      if (reg.getLlmSource() !== 'ollama') {
        await llama.ensureLoaded().catch(() => undefined)
        if (!isWarmupCurrent(epoch)) return
        await modelsWorker.restoreChat().catch(() => undefined)
      }
    })()
      .catch((error) => console.warn('[models] warmup failed:', error))
      .finally(() => {
        if (qaWarmupPromise === warming) qaWarmupPromise = null
      })
    qaWarmupPromise = warming
  })

  // settings
  ipcMain.handle('organizer:list', () => getOrganizerService().list())
  ipcMain.handle('organizer:saveNote', (_e, input: unknown) =>
    getOrganizerService().saveNote(input as never),
  )
  ipcMain.handle('organizer:deleteNote', (_e, input: unknown) =>
    getOrganizerService().deleteNote(input as never),
  )
  ipcMain.handle('organizer:saveTask', (_e, input: unknown) =>
    getOrganizerService().saveTask(input as never),
  )
  ipcMain.handle('organizer:deleteTask', (_e, input: unknown) =>
    getOrganizerService().deleteTask(input as never),
  )
  ipcMain.handle('organizer:saveEvent', (_e, input: unknown) =>
    getOrganizerService().saveEvent(input as never),
  )
  ipcMain.handle('organizer:deleteEvent', (_e, input: unknown) =>
    getOrganizerService().deleteEvent(input as never),
  )

  ipcMain.handle('settings:get', async () => {
    // useT() — and through it useSettings — runs on the pre-unlock login /
    // loading screens too , so settings:get is legitimately called while the
    // vault is locked. The real settings live in the encrypted DB we can't
    // read yet , so hand back defaults rather than throwing LockedError. The
    // old throw only spammed the main log and poisoned the renderer's settings
    // hook (every Settings tab stuck on "loading" after a slow-unlock race ,
    // e.g. on a reinstall). The renderer re-reads the real settings on unlock.
    if (!getAuth().isUnlocked() || sessionClosing) return DEFAULT_SETTINGS
    return getSettingsService().get()
  })
  let settingsUpdateQueue: Promise<unknown> = Promise.resolve()
  ipcMain.handle('settings:update', async (_e, patch: unknown) => {
    if (!getAuth().isUnlocked() || sessionClosing) throw new LockedError()
    const settings = getSettingsService()
    const operation = settingsUpdateQueue
      .catch(() => undefined)
      .then(async () => {
        if (settings !== settingsService || !getAuth().isUnlocked() || sessionClosing)
          throw new LockedError()
        const before = settings.get()
        await settings.update(patch as never)
        if (settings !== settingsService || !getAuth().isUnlocked() || sessionClosing)
          throw new LockedError()
        const after = settings.get()
        if (runtimeSettingsChanged(before, after)) await applySettings(after)
        return after
      })
    settingsUpdateQueue = operation
    return operation
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
  // Install-time opt-in : whether the tier marker says the user ticked the
  // Ollama-connector checkbox in the wizard. The renderer uses this to lock
  // the whole Ollama settings panel ; the probe handler below enforces it
  // again so a stale renderer can't reach an external host anyway.
  ipcMain.handle('ollama:connectorEnabled', async () => isOllamaConnectorEnabled())

  // Effective install tier (or LOKLM_TIER dev override). The renderer uses this
  // to drop tier-specific UI — e.g. the lite tier hides the reranker status dot.
  ipcMain.handle('tier:get', async () => getEffectiveTier())

  ipcMain.handle(
    'ollama:probe',
    async (_e, cfg: { baseUrl: string; bearerToken: string | null; timeoutMs: number }) => {
      if (!isOllamaConnectorEnabled()) {
        return {
          ok: false as const,
          kind: 'connector-disabled' as const,
          message: 'Ollama-Connector bei der Installation nicht aktiviert.',
        }
      }
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
  ipcMain.handle(
    'chat:stream',
    async (
      e,
      streamId: string,
      workspaceId: number,
      query: string,
      opts: import('../shared/documents').AnswerOptions = {},
    ) => {
      requireOpenSession()
      // Register before asynchronous preflight so Stop cannot miss this turn.
      // The outer finally also covers settings and database failures.
      const request = sessionRequests.begin('chat', e.sender.id, streamId)
      const ctrl = request.controller
      const abort = (): void => ctrl.abort()
      e.sender.once('destroyed', abort)
      let terminal:
        | Extract<import('../shared/documents').StreamEvent, { type: 'done' | 'error' }>
        | undefined
      const emit = (event: import('../shared/documents').StreamEvent): void => {
        if (!request.isCurrent()) {
          if (event.type !== 'done' && event.type !== 'error') return
          event = { type: 'done', full_text: '', citations: [], outcome: 'cancelled' }
        }
        if (event.type === 'done' || event.type === 'error') terminal = event
        try {
          e.sender.send(`chat:stream-event:${streamId}`, event)
        } catch {
          ctrl.abort()
        }
      }
      try {
        // Answer language: honour the user's answerLanguage setting. 'de'/'en'
        // force that language ; 'auto' (the default) leaves opts.language unset so
        // QAService.answer detects it per-turn from the query (eld , mapped to the
        // two supported answer languages). The MVP used to force the language
        // unconditionally — Auto is now an explicit opt-in, so detection no longer
        // silently overrides a manual DE/EN choice. ( The UI language lives in
        // basic.language and is unaffected by this. )
        const basic = getSettingsService().get().basic
        if (basic.answerLanguage === 'de' || basic.answerLanguage === 'en') {
          opts.language = basic.answerLanguage
        } else {
          // Auto: eld classifies the prompt per-turn (it handles short German like
          // "Fasse Kapitel 3 zusammen" fine). For the genuinely ambiguous tail eld
          // can't score ("ok", a bare number), answer in the user's UI language
          // rather than a hardcoded English.
          opts.fallbackLanguage = basic.language
        }

        // AP-9 §3.8 "Treffer-K": drive chat retrieval depth from the user's
        // setting. The renderer never pins opts.topK, so this always applies for
        // chat; the configured value overrides the per-query adaptiveTopK
        // heuristic (which remains the fallback for quiz / eval callers).
        if (opts.topK == null) opts.topK = getSettingsService().get().retrieval.topK

        // Relevance floor — ALL tiers, not just lite. Whenever the reranker runs
        // its scores are real per-(query, passage) relevance, so drop the sub-
        // relevant tail instead of padding the fed set to a fixed topK. Observed
        // cliff on a focused query: on-topic matches ≥0.5, noise ≤0.13 — 0.2 sits
        // in the gap, keeping the relevant chunks and dropping the OS/Java/team-
        // roles chunks a fixed count (made worse by doc-diversity) was dragging
        // in. RetrievalService gates this on rerank having actually run and always
        // keeps the top hit, so the RRF fallback and weak-but-best matches are
        // unaffected. Evals/quiz never set it → legacy fixed-K behaviour there.
        if (opts.relevanceFloor == null) opts.relevanceFloor = CHAT_RELEVANCE_FLOOR

        // A 4 GB-class local GPU pays for every extra generation/model swap,
        // including Standard/dev installs. Keep caller-pinned retrieval controls.
        if (useLeanChatRetrieval()) applyLeanRetrievalDefaults(opts)
        // The master switch also applies to an external reranker, whose provider
        // remains configured/ready even when the user turns this stage off.
        const rerankerDecision = getRerankerService().info().policyDecision
        if (
          !getSettingsService().get().advanced.reranker.enabled ||
          rerankerDecision?.allowed === false
        )
          opts.rerank = false

        // Pin to THIS chat's workspace, not the active one: a message append routed
        // through active() lands in the wrong store when another workspace is active
        // (FOREIGN KEY constraint failed on conversation_id).
        const conversations =
          opts.conversationId != null
            ? await getAuth().requireDatabase().conversationsFor(workspaceId)
            : null

        // Persist the user message up-front so chat history is intact even if
        // the stream errors or the renderer disconnects mid-flight.
        if (conversations && opts.conversationId != null) {
          ctrl.signal.throwIfAborted()
          await conversations.appendMessage(opts.conversationId, 'user', query)
        }

        await runChatTurn({
          stream: () => getQAService().answer(workspaceId, query, opts, ctrl.signal),
          signal: ctrl.signal,
          language: opts.language ?? opts.fallbackLanguage ?? basic.language,
          emit,
          ...(conversations && opts.conversationId != null
            ? {
                persist: (turn) =>
                  request.isCurrent()
                    ? persistChatTurn(conversations, opts.conversationId!, turn)
                    : Promise.resolve(),
              }
            : {}),
        })
        // The invoke reply and stream events use separate IPC channels. Return
        // the same terminal so the renderer can finalize even if its event is late.
        return terminal
      } catch (err) {
        // runChatTurn normalizes generation and persistence failures. This path
        // covers preflight failure before an assistant turn can be collected.
        console.error('[chat:stream] preflight failed:', err)
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
        return terminal
      } finally {
        request.finish()
        e.sender.removeListener('destroyed', abort)
      }
    },
  )
  ipcMain.handle('chat:cancel', async (e, streamId: string) => {
    sessionRequests.cancel('chat', e.sender.id, streamId)
  })

  // AP-9 §3.8 "Konv.-Wechsel": the renderer calls this when the user switches to
  // a different conversation. When the setting is 'unload' we free the LLM
  // eagerly (rather than waiting for LlamaService's idle timer); 'keep' is a
  // no-op. shouldUnloadOnConversationSwitch skips the unload while any chat
  // stream is live so an in-flight answer is never killed.
  ipcMain.handle('chat:conversationSwitched', async () => {
    const mode = getSettingsService().get().runtime.conversationSwitch
    if (shouldUnloadOnConversationSwitch(mode, sessionRequests.has('chat'))) {
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

  ipcMain.handle('quiz:create-deck', async (e, input: import('../shared/quiz').CreateQuizInput) => {
    // QuizService.createDeckRow validates name/docs and resolves
    // language from 'auto' before insert.
    return withSessionRequest('read', e.sender, (request) =>
      getQuizService().createDeckRow(input, request.controller.signal),
    )
  })

  // Create-dialog preview: derived question count for a document selection.
  // Pure chunk-stat math in the service — no LLM call, returns in ms.
  ipcMain.handle('quiz:estimate', async (e, documentIds: number[]) => {
    if (!Array.isArray(documentIds) || documentIds.some((id) => !Number.isInteger(id))) {
      throw new Error('documentIds must be an array of integers')
    }
    return withSessionRequest('read', e.sender, (request) =>
      getQuizService().estimate(documentIds, request.controller.signal),
    )
  })

  ipcMain.handle('quiz:delete-deck', async (_e, deckId: number) => {
    await getAuth().requireDatabase().quizzes().deleteDeck(deckId)
  })

  ipcMain.handle('quiz:merge-decks', async (_e, input: import('../shared/quiz').MergeQuizInput) => {
    const name = (input?.name ?? '').trim()
    if (name.length < 1 || name.length > 128) {
      throw new Error('Quiz name must be 1–128 characters')
    }
    if (!Array.isArray(input.deckIds) || input.deckIds.length < 2) {
      throw new Error('Select at least two quizzes to merge')
    }
    return getAuth()
      .requireDatabase()
      .quizzes()
      .mergeDecks({
        workspaceId: input.workspaceId,
        name,
        deckIds: input.deckIds,
        shuffle: input.shuffle !== false,
      })
  })

  ipcMain.handle('quiz:regenerate-deck', async (_e, deckId: number) => {
    requireOpenSession()
    return getQuizService().prepareRegeneration(deckId)
  })

  ipcMain.handle('quiz:generate', async (e, streamId: string, deckId: number) => {
    requireOpenSession()
    const quizzes = getAuth().requireDatabase().quizzes()
    const request = sessionRequests.begin('quiz', e.sender.id, streamId)
    const ctrl = request.controller
    const abort = (): void => ctrl.abort()
    e.sender.once('destroyed', abort)
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
      if (!request.isCurrent()) return
      // A throw BEFORE the generator reaches its own try-block (service
      // construction, getDeck, model init) bypasses QuizService.generate's
      // internal failure handling. Without this catch the deck row stays
      // 'generating' forever and the renderer — which calls generate() with a
      // floating `void` — never learns it failed. Flip the row to 'failed' and
      // push an error event so the UI leaves the spinner.
      const message = err instanceof Error ? err.message : String(err)

      console.error(`[quiz] generation failed before stream start (deck ${deckId}): ${message}`)
      try {
        await quizzes.setDeckStatus(deckId, 'failed', message)
      } catch {
        /* DB unavailable — nothing more we can do */
      }
      try {
        e.sender.send(`quiz:generate-event:${streamId}`, { type: 'error', message })
      } catch {
        /* renderer gone */
      }
    } finally {
      request.finish()
      e.sender.removeListener('destroyed', abort)
    }
  })
  ipcMain.handle('quiz:cancel-generate', async (e, streamId: string) => {
    sessionRequests.cancel('quiz', e.sender.id, streamId)
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
      // index.cjs , not .mjs : sandboxed preloads can't be ES modules , so the
      // preload build emits CommonJS ( see electron.vite.config.ts ).
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Full Chromium sandbox for the renderer. The app ingests untrusted
      // documents ( PDFs through pdfjs , OCR'd images , markdown ) — if one of
      // them lands a renderer exploit , the sandbox is what keeps it away from
      // the filesystem and the unlocked vault in main. The preload only uses
      // contextBridge / ipcRenderer / webUtils , all sandbox-safe.
      sandbox: true,
      webviewTag: false,
    },
  })

  // Allow microphone capture for in-app audio recording (transcription) and
  // sanitized clipboard writes — every copy button in the renderer goes through
  // navigator.clipboard.writeText, which Chromium gates behind the
  // clipboard-sanitized-write permission; denying it made all copies silent
  // no-ops. Scoped to these two; the renderer is our own trusted, isolated
  // context (contextIsolation: true, nodeIntegration: false).
  const grantedPermissions = new Set(['media', 'clipboard-sanitized-write'])
  window.webContents.session.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(grantedPermissions.has(permission)),
  )
  window.webContents.session.setPermissionCheckHandler((_wc, permission) =>
    grantedPermissions.has(permission),
  )

  // mirror the OS maximize/unmaximize state to the renderer so the React
  // titlebar can swap the maximize <-> restore icon.
  window.on('maximize', () => window.webContents.send('window:maximized', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized', false))

  window.once('ready-to-show', () => window.show())

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

// Hardening for every webContents the app ever creates ( main window today ,
// anything added later inherits it automatically ). Renderer content includes
// untrusted text — document chunks and LLM output rendered by react-markdown —
// so links in it are attacker-influenced :
//   - window.open / target=_blank : never create a child window. Hand the URL
//     to the OS browser only when the scheme is http(s)/mailto , so a crafted
//     file:// , smb:// or custom-protocol link can't launch a local handler.
//   - will-navigate : the SPA never navigates top-level. Allow only the dev
//     server ( HMR full-reload ) and a same-URL reload ; block everything else
//     so a renderer compromise can't load remote content into our context.
//   - webviews : disabled in webPreferences , and refused here again in case a
//     future window forgets the flag.
function isSafeExternalUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:'
  } catch {
    return false
  }
}

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    if (devServerUrl && url.startsWith(devServerUrl)) return
    if (url === contents.getURL()) return // location.reload()
    event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
})

// Process-wide renderer sandbox , on top of the per-window webPreferences
// flag : a window added later that forgets sandbox: true would otherwise run
// unsandboxed without anyone noticing. Must be called before app ready.
app.enableSandbox()

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

// How often the quit drain re-checks indexing state.
const QUIT_DRAIN_POLL_MS = 150
// Stall cap: give up after this long with ZERO forward progress — a wedged
// worker, not a slow-but-working one. Big enough to span a slow non-OCR parse
// between progress ticks.
const QUIT_DRAIN_STALL_MS = 30_000
// Absolute ceiling on the whole drain, independent of the stall window: even a
// genuinely-progressing book-length document must not hold the quit open for an
// unbounded time. The 'app:quitting' overlay covers the wait with feedback; past
// this, lock() proceeds (the cut doc is reset to 'failed' + re-indexed next
// launch, and LanceWorkspaceStore serializes the close behind any in-flight
// write so nothing is torn).
const QUIT_DRAIN_MAX_MS = 90_000

/** Sum of the indexing + backfill progress counters. Monotonic; advances once
 *  per embedded batch (and per phase/OCR tick), so a change between polls means
 *  embedding is still doing real work. */
function totalIndexProgressTicks(): number {
  return (documentService?.indexProgressTicks() ?? 0) + (backfillService?.embedProgressTicks() ?? 0)
}

/** App-quit drain: stop starting new indexing, end the background backfill at a
 *  batch boundary, then wait (via the pure runQuitDrain core) for whatever is
 *  already running in a worker to finish so its writes land before the store is
 *  re-encrypted. Adaptive — keeps waiting while embedding progresses, bailing on
 *  a stall or the absolute ceiling, so a single book-length document still gets
 *  to finish without an unbounded quit. */
async function drainIndexingForQuit(): Promise<void> {
  documentService?.quiesce()
  backfillService?.cancelAll()
  await runQuitDrain({
    isActive: () =>
      (documentService?.hasActiveIndexing() ?? false) || (backfillService?.isAnyRunning() ?? false),
    progressTicks: totalIndexProgressTicks,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollMs: QUIT_DRAIN_POLL_MS,
    stallMs: QUIT_DRAIN_STALL_MS,
    maxMs: QUIT_DRAIN_MAX_MS,
  })
}

// Explicit lock/logout drain caps. Tighter than the quit drain: lock is a
// security action (the user may be walking away), so the vault must not stay
// open for up to 90 s over a book-length document. Work cut at the cap
// self-heals — the doc is reset by sweepOrphanedIndexing on the next unlock.
const LOCK_DRAIN_STALL_MS = 10_000
const LOCK_DRAIN_MAX_MS = 30_000

/** Lock/logout drain: resumable counterpart to drainIndexingForQuit. Cancels
 *  the queued jobs (reconciling their doc rows while the DB is still open)
 *  instead of quiescing — the session may unlock again — then briefly waits
 *  for the in-flight jobs so their writes land before the store closes.
 *  Without this, lock() clears the manifest under a full queue and the pump
 *  cascades one "workspace not found" failure per queued document. */
async function drainIndexingForLock(): Promise<void> {
  await documentService?.cancelAllIndexing().catch(() => undefined)
  backfillService?.cancelAll()
  await runQuitDrain({
    isActive: () =>
      (documentService?.hasActiveIndexing() ?? false) || (backfillService?.isAnyRunning() ?? false),
    progressTicks: totalIndexProgressTicks,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollMs: QUIT_DRAIN_POLL_MS,
    stallMs: LOCK_DRAIN_STALL_MS,
    maxMs: LOCK_DRAIN_MAX_MS,
  })
}

// Flush durably before the process exits. before-quit fires before the windows
// close , so we still have a chance to do async work here. Two things must
// survive: the active indexing batch (drained so it isn't killed mid-write) and
// the per-workspace vector store. lock() (not persistSnapshot) is what we want —
// it re-encrypts the Lance work/ dir into the at-rest enc/ tree, so the session's
// freshly-embedded vectors are durable; persistSnapshot alone only saves the
// vault body (manifest + kv), leaving meta.db flagged 'embedded' with no vector.
app.on('before-quit', (event) => {
  if (didFinalPersist || !authService) return
  // Re-entrancy: didFinalPersist only flips in the async chain's finally, which
  // is up to QUIT_DRAIN_MAX_MS away. Without quitDraining, a second quit signal
  // during the drain would preventDefault again and start a CONCURRENT
  // drain+lock chain. Collapse every later before-quit to a no-op wait.
  if (quitDraining) {
    event.preventDefault()
    return
  }
  const auth = authService
  // isUnlocked() is also false while a lock is still persisting. Always await
  // the idempotent lock promise, including a quit that interrupts that drain.
  event.preventDefault()
  quitDraining = true
  // Tell every renderer we're shutting down so it can cover the drain wait with
  // a non-dismissable "finishing & saving" overlay instead of a frozen window.
  // Best-effort: a renderer already torn down just drops the event.
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('app:quitting')
    } catch {
      /* renderer gone */
    }
  }
  void (async () => {
    try {
      logShutdownStage('private-writes')
      await drainPrivateWrites()
      logShutdownStage('indexing')
      await drainIndexingForQuit()
    } finally {
      logShutdownStage('vault-lock')
      await auth.lock()
    }
  })()
    .catch((error: unknown) => {
      console.error('[app] shutdown cleanup failed:', error)
    })
    .finally(() => {
      logShutdownStage('exit')
      didFinalPersist = true
      // Electron runs microtasks inside its native before-quit callback. An
      // already-locked vault can drain there; retrying quit in the same turn
      // would let the original cancelled quit overwrite the new quit state.
      setImmediate(() => app.quit())
    })
})

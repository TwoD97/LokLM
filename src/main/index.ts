import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { AuthService } from './services/auth/AuthService'
import { WorkspaceService } from './services/documents/WorkspaceService'
import { DocumentService } from './services/documents/DocumentService'
import { ImportError } from './services/documents/types'
import { EmbeddingService } from './services/embeddings/EmbeddingService'
import { EmbeddingBackfillService } from './services/embeddings/EmbeddingBackfillService'
import { RerankerService } from './services/retrieval/RerankerService'
import { RetrievalService } from './services/retrieval/RetrievalService'
import { LlamaService } from './services/llm/LlamaService'
import { QAService } from './services/qa/QAService'
import { ModelDownloader, type DownloadEvent } from './services/models/ModelDownloader'
import { checkAll as checkModelsAvailability } from './services/models/availability'
import type { SetupOptions, SetupStatus } from '../shared/setupTypes'

const __dirname = dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

const SETUP_REGISTRY_KEY = 'HKCU\\Software\\LokLM\\Setup'
const RUN_REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

const DEFAULT_SETUP_OPTIONS: SetupOptions = {
  createDesktopShortcut: true,
  createStartMenuShortcut: true,
  enableAutostart: false,
}

function brandAsset(file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(__dirname, '../..', 'resources', file)
}

function setupStatePath(): string {
  return join(app.getPath('userData'), 'setup.json')
}

function normalizeSetupOptions(input: Partial<SetupOptions> | null | undefined): SetupOptions {
  return {
    createDesktopShortcut:
      input?.createDesktopShortcut ?? DEFAULT_SETUP_OPTIONS.createDesktopShortcut,
    createStartMenuShortcut:
      input?.createStartMenuShortcut ?? DEFAULT_SETUP_OPTIONS.createStartMenuShortcut,
    enableAutostart: input?.enableAutostart ?? DEFAULT_SETUP_OPTIONS.enableAutostart,
  }
}

async function readSetupStatus(): Promise<SetupStatus> {
  try {
    const raw = await readFile(setupStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<SetupStatus>
    return {
      firstRunDone: parsed.firstRunDone === true,
      options: parsed.options ? normalizeSetupOptions(parsed.options) : null,
    }
  } catch {
    return { firstRunDone: false, options: null }
  }
}

async function writeSetupStatus(status: SetupStatus): Promise<void> {
  const file = setupStatePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(status, null, 2), 'utf8')
}

function regExe(): string {
  return process.env['SystemRoot']
    ? join(process.env['SystemRoot'], 'System32', 'reg.exe')
    : 'reg.exe'
}

async function writeRegistryValue(key: string, name: string, value: string): Promise<void> {
  await execFileAsync(regExe(), ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], {
    windowsHide: true,
  })
}

async function deleteRegistryValue(key: string, name: string): Promise<void> {
  try {
    await execFileAsync(regExe(), ['delete', key, '/v', name, '/f'], { windowsHide: true })
  } catch {
    /* value may not exist */
  }
}

async function applyWindowsSetupOptions(options: SetupOptions): Promise<void> {
  await writeRegistryValue(
    SETUP_REGISTRY_KEY,
    'DesktopShortcut',
    options.createDesktopShortcut ? '1' : '0',
  ).catch(() => undefined)
  await writeRegistryValue(
    SETUP_REGISTRY_KEY,
    'StartMenuShortcut',
    options.createStartMenuShortcut ? '1' : '0',
  ).catch(() => undefined)

  if (!app.isPackaged) return

  if (!options.createDesktopShortcut) {
    await rm(join(app.getPath('desktop'), 'LokLM.lnk'), { force: true }).catch(() => undefined)
  }
  if (!options.createStartMenuShortcut) {
    await rm(
      join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'LokLM.lnk'),
      { force: true },
    ).catch(() => undefined)
  }

  if (options.enableAutostart) {
    await writeRegistryValue(RUN_REGISTRY_KEY, 'LokLM', `"${process.execPath}"`).catch(
      () => undefined,
    )
  } else {
    await deleteRegistryValue(RUN_REGISTRY_KEY, 'LokLM')
  }
}

async function saveSetupOptions(input: SetupOptions): Promise<SetupOptions> {
  const options = normalizeSetupOptions(input)
  if (process.platform === 'win32') {
    await applyWindowsSetupOptions(options)
  } else if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: options.enableAutostart })
  }

  const current = await readSetupStatus()
  await writeSetupStatus({ firstRunDone: current.firstRunDone, options })
  return options
}

let authService: AuthService | null = null
let didFinalPersist = false

function getAuth(): AuthService {
  if (!authService) {
    authService = new AuthService(app.getPath('userData'))
    authService.setOnLock(() => {
      resetSessionServices()
      broadcastAuthState()
    })
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
  backfillService = null
  retrievalService = null
  qaService = null
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

let workspaceService: WorkspaceService | null = null
let documentService: DocumentService | null = null
let embeddingService: EmbeddingService | null = null
let backfillService: EmbeddingBackfillService | null = null
let rerankerService: RerankerService | null = null
let retrievalService: RetrievalService | null = null
let llamaService: LlamaService | null = null
let qaService: QAService | null = null
let modelDownloader: ModelDownloader | null = null

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
    embeddingService = new EmbeddingService()
    embeddingService.subscribe((status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send('embedder:status', status)
        } catch {
          /* ignore */
        }
      }
    })
  }
  return embeddingService
}

function getBackfillService(): EmbeddingBackfillService {
  if (!backfillService) {
    backfillService = new EmbeddingBackfillService(
      getAuth().requireDatabase(),
      getEmbeddingService(),
    )
  }
  return backfillService
}

function getLlamaService(): LlamaService {
  if (!llamaService) {
    llamaService = new LlamaService()
    llamaService.subscribe((status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send('llm:status', status)
        } catch {
          /* ignore */
        }
      }
    })
  }
  return llamaService
}

function getQAService(): QAService {
  if (!qaService) {
    qaService = new QAService(getAuth().requireDatabase(), getRetrievalService(), getLlamaService())
  }
  return qaService
}

function getRerankerService(): RerankerService {
  if (!rerankerService) {
    rerankerService = new RerankerService()
    rerankerService.subscribe((status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send('reranker:status', status)
        } catch {
          /* ignore */
        }
      }
    })
  }
  return rerankerService
}

function getRetrievalService(): RetrievalService {
  if (!retrievalService) {
    retrievalService = new RetrievalService(
      getAuth().requireDatabase(),
      getEmbeddingService(),
      getRerankerService(),
      getLlamaService(),
    )
  }
  return retrievalService
}

function getDocumentService(): DocumentService {
  documentService ??= new DocumentService(getAuth(), getEmbeddingService())
  return documentService
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
  ipcMain.handle('setup:status', async () => readSetupStatus())
  ipcMain.handle('setup:saveOptions', async (_e, input: SetupOptions) => saveSetupOptions(input))
  ipcMain.handle('setup:markFirstRunDone', async () => {
    const current = await readSetupStatus()
    await writeSetupStatus({ ...current, firstRunDone: true })
  })

  ipcMain.handle('auth:status', async () => getAuth().status())

  ipcMain.handle(
    'auth:register',
    async (_e, input: { displayName: string; password: string; recoveryLang: 'de' | 'en' }) => {
      const result = await getAuth().register(input)
      broadcastAuthState()
      void scheduleBackfillForAllWorkspaces().catch(() => undefined)
      void getLlamaService()
        .autoLoad()
        .catch(() => undefined)
      return result
    },
  )

  ipcMain.handle('auth:login', async (_e, input: { password: string }) => {
    const result = await getAuth().login(input.password)
    if (result.ok) {
      broadcastAuthState()
      void scheduleBackfillForAllWorkspaces().catch(() => undefined)
      void getLlamaService()
        .autoLoad()
        .catch(() => undefined)
    }
    return result
  })

  ipcMain.handle('auth:logout', async () => {
    await getAuth().logout()
    resetSessionServices()
    broadcastAuthState()
  })

  ipcMain.handle('auth:lock', async () => {
    await getAuth().lock()
    resetSessionServices()
    broadcastAuthState()
  })

  ipcMain.handle('auth:reset', async (_e, input: { passphrase: string; newPassword: string }) => {
    const result = await getAuth().reset(input)
    if (result.ok) broadcastAuthState()
    return result
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

  // workspaces
  ipcMain.handle('workspaces:list', async () => getWorkspaceService().list())
  ipcMain.handle('workspaces:create', async (_e, name: string) =>
    getWorkspaceService().create(name),
  )
  ipcMain.handle('workspaces:rename', async (_e, id: number, name: string) =>
    getWorkspaceService().rename(id, name),
  )
  ipcMain.handle('workspaces:delete', async (_e, id: number) => getWorkspaceService().delete(id))

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
          extensions: ['pdf', 'md', 'markdown', 'txt', 'rst', 'json', 'yaml', 'yml', 'toml'],
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
  ipcMain.handle('documents:reindex', async (e, id: number) => {
    await getAuth().requireDatabase().documents().reindexDocument(id)
    // re-import using the existing source path to repopulate chunks via the
    // normal background indexing flow.
    const doc = await getAuth().requireDatabase().documents().getDocument(id)
    if (!doc) throw new Error(`Document ${id} not found`)
    return getDocumentService().importFile({
      workspaceId: doc.workspaceId,
      sourcePath: doc.sourcePath,
      sender: e.sender,
    })
  })

  ipcMain.handle(
    'documents:getChunkWithContext',
    async (_e, chunkId: number, before: number = 1, after: number = 1) =>
      getAuth().requireDatabase().documents().getChunkWithContext(chunkId, before, after),
  )

  ipcMain.handle('documents:getSourceForChunk', async (_e, chunkId: number) => {
    const repo = getAuth().requireDatabase().documents()
    const [doc, headingPath] = await Promise.all([
      repo.getDocumentByChunkId(chunkId),
      repo.getChunkHeadingPath(chunkId),
    ])
    if (!doc) return null
    return {
      documentId: doc.id,
      title: doc.title,
      mimeType: doc.mimeType,
      sourcePath: doc.sourcePath,
      headingPath,
    }
  })

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
  ipcMain.handle('conversations:create', async (_e, workspaceId: number, title?: string) =>
    getAuth()
      .requireDatabase()
      .conversations()
      .create(workspaceId, title ?? null),
  )
  ipcMain.handle('conversations:delete', async (_e, id: number) => {
    await getAuth().requireDatabase().conversations().delete(id)
  })
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

  // embedder
  ipcMain.handle('embedder:status', async () => getEmbeddingService().getStatus())
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
  ipcMain.handle('reranker:status', async () => getRerankerService().getStatus())
  ipcMain.handle('reranker:info', async () => getRerankerService().info())
  ipcMain.handle('reranker:reload', async () => {
    await getRerankerService().unload()
    await getRerankerService().ensureReady()
    return getRerankerService().info()
  })
  ipcMain.handle('reranker:setPlacement', async (_e, choice: 'auto' | 'cpu' | 'gpu') => {
    getRerankerService().setPlacement(choice)
  })

  // llm
  ipcMain.handle('llm:status', async () => getLlamaService().getStatus())
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
      const ctrl = new AbortController()
      activeStreams.set(streamId, ctrl)
      const conversations =
        opts.conversationId != null ? getAuth().requireDatabase().conversations() : null

      // Persist the user message up-front so chat history is intact even if
      // the stream errors or the renderer disconnects mid-flight.
      if (conversations && opts.conversationId != null) {
        await conversations.appendMessage(opts.conversationId, 'user', query)
      }

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
        const stream = getQAService().answer(workspaceId, query, opts)
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
            tokenCount += 1
          } else if (ev.type === 'citation')
            citations.push({ doc_id: ev.doc_id, chunk_id: ev.chunk_id, score: ev.score })
          else if (ev.type === 'refusal') {
            refused = true
            refusalMessage = ev.message
          }
        }

        // Persist the assistant turn. Refusal short-circuits to an empty
        // citations list with the refusal text as the assistant's content —
        // resume of the conversation later sees an intact timeline.
        if (conversations && opts.conversationId != null && !ctrl.signal.aborted) {
          if (refused && refusalMessage != null) {
            await conversations.appendMessage(opts.conversationId, 'assistant', refusalMessage)
          } else if (tokenBuffer.length > 0) {
            const assistantContent = tokenBuffer.join('')
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
            if (citations.length > 0) {
              await conversations.persistCitations(asst.id, citations)
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

void app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.loklm.app')
  registerIpc()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

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

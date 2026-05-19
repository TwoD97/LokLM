import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
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

const __dirname = dirname(fileURLToPath(import.meta.url))

function brandAsset(file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(__dirname, '../..', 'resources', file)
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
  ipcMain.handle('auth:status', async () => getAuth().status())

  ipcMain.handle(
    'auth:register',
    async (_e, input: { displayName: string; password: string; recoveryLang: 'de' | 'en' }) => {
      const result = await getAuth().register(input)
      broadcastAuthState()
      void scheduleBackfillForAllWorkspaces().catch(() => undefined)
      return result
    },
  )

  ipcMain.handle('auth:login', async (_e, input: { password: string }) => {
    const result = await getAuth().login(input.password)
    if (result.ok) {
      broadcastAuthState()
      void scheduleBackfillForAllWorkspaces().catch(() => undefined)
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
          if (ev.type === 'token') tokenBuffer.push(ev.text)
          else if (ev.type === 'citation')
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
            const asst = await conversations.appendMessage(
              opts.conversationId,
              'assistant',
              assistantContent,
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

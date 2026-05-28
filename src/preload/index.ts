import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  AuthLoginProgressEvent,
  AuthStatus,
  LoginResult,
  RegisterResult,
  ResetResult,
} from '../shared/authTypes'
import type { UserSettings } from '../shared/settings'
import type {
  QuizDeck,
  QuizDeckSummary,
  QuizDeckWithQuestions,
  QuizAttempt,
  CreateQuizInput,
  QuizGenerationEvent,
} from '../shared/quiz'
import type {
  Document,
  Workspace,
  IndexProgress,
  EmbedderStatus,
  EmbedderInfo,
  BackfillStatus,
  RerankerStatus,
  RerankerInfo,
  RetrievalHit,
  RetrievalOptions,
  ModelStatus,
  SystemInfo,
  LlmProfileChoice,
  AnswerOptions,
  StreamEvent,
  Conversation,
  ConversationWithMessages,
  ChunkSource,
  DocumentChunk,
  ModelsStatus,
} from '../shared/documents'

/** Mirrors `DownloadEvent` in src/main/services/models/ModelDownloader.ts —
 *  duplicated here to avoid pulling main-process types into the preload's
 *  module graph. Renderer + main must stay in sync; type-test in
 *  `tests/unit/model-download-types.test.ts` enforces this. */
export interface ModelDownloadEvent {
  id: string
  phase: 'downloading' | 'verifying' | 'complete' | 'error' | 'cancelled'
  bytesReceived: number
  totalBytes: number
  bytesPerSec: number | null
  message: string | null
}

/** Mirrors `SyncEvent` in src/main/services/documents/FolderSyncService.ts.
 *  Same duplicate-rather-than-import rationale as ModelDownloadEvent above. */
export interface SyncProgressEvent {
  workspaceId: number
  phase: 'start' | 'progress' | 'done' | 'failed'
  imported: number
  reindexed: number
  markedMissing: number
  unchanged: number
  detail?: string
}

const api = {
  auth: {
    status: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:status'),
    register: (
      displayName: string,
      password: string,
      recoveryLang: 'de' | 'en',
    ): Promise<RegisterResult> =>
      ipcRenderer.invoke('auth:register', { displayName, password, recoveryLang }),
    login: (password: string): Promise<LoginResult> =>
      ipcRenderer.invoke('auth:login', { password }),
    logout: (): Promise<void> => ipcRenderer.invoke('auth:logout'),
    lock: (): Promise<void> => ipcRenderer.invoke('auth:lock'),
    reset: (passphrase: string, newPassword: string): Promise<ResetResult> =>
      ipcRenderer.invoke('auth:reset', { passphrase, newPassword }),
    verifyPassword: (
      password: string,
    ): Promise<
      | { ok: true }
      | { ok: false; reason: 'no_user' | 'locked_session' | 'bad_password' }
      | { ok: false; reason: 'rate_limited'; retryAfterMs: number }
    > => ipcRenderer.invoke('auth:verifyPassword', { password }),
    onState: (cb: (state: AuthStatus) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, state: AuthStatus): void => cb(state)
      ipcRenderer.on('auth:state', listener)
      return () => {
        ipcRenderer.removeListener('auth:state', listener)
      }
    },
    /**
     * Subscribe to login progress events. The LoginView uses this to swap
     * the spinner label between the argon2-KDF , body-decrypt , and PGlite-
     * restore phases so a slow login no longer looks like a frozen UI.
     */
    onLoginProgress: (cb: (ev: AuthLoginProgressEvent) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, ev: AuthLoginProgressEvent): void => cb(ev)
      ipcRenderer.on('auth:login-progress', listener)
      return () => {
        ipcRenderer.removeListener('auth:login-progress', listener)
      }
    },
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggleMaximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChange: (cb: (maximized: boolean) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, value: boolean): void => cb(value)
      ipcRenderer.on('window:maximized', listener)
      return () => {
        ipcRenderer.removeListener('window:maximized', listener)
      }
    },
  },
  workspaces: {
    list: (): Promise<Workspace[]> => ipcRenderer.invoke('workspaces:list'),
    create: (name: string): Promise<Workspace> => ipcRenderer.invoke('workspaces:create', name),
    rename: (id: number, name: string): Promise<void> =>
      ipcRenderer.invoke('workspaces:rename', id, name),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('workspaces:delete', id),
    listSyncFolders: (workspaceId: number): Promise<string[]> =>
      ipcRenderer.invoke('workspaces:listSyncFolders', workspaceId),
    // Returns the updated folder list on add ; null when the user cancels the
    // picker. The main process kicks off a one-shot sync right after add so
    // the renderer can rely on indexing:progress + a refresh to surface the
    // newly imported docs.
    addSyncFolder: (workspaceId: number): Promise<string[] | null> =>
      ipcRenderer.invoke('workspaces:addSyncFolder', workspaceId),
    removeSyncFolder: (workspaceId: number, folderPath: string): Promise<string[]> =>
      ipcRenderer.invoke('workspaces:removeSyncFolder', workspaceId, folderPath),
    syncNow: (
      workspaceId: number,
    ): Promise<{
      imported: number
      reindexed: number
      markedMissing: number
      unchanged: number
      stillMissing: number
    }> => ipcRenderer.invoke('workspaces:syncNow', workspaceId),
    onSyncProgress: (cb: (ev: SyncProgressEvent) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, ev: SyncProgressEvent): void => cb(ev)
      ipcRenderer.on('sync:progress', listener)
      return () => {
        ipcRenderer.removeListener('sync:progress', listener)
      }
    },
  },
  documents: {
    list: (workspaceId: number): Promise<Document[]> =>
      ipcRenderer.invoke('documents:list', workspaceId),
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    pickFiles: (): Promise<string[]> => ipcRenderer.invoke('documents:pickFiles'),
    import: (workspaceId: number, sourcePath: string): Promise<Document> =>
      ipcRenderer.invoke('documents:import', workspaceId, sourcePath),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('documents:delete', id),
    reindex: (id: number): Promise<Document> => ipcRenderer.invoke('documents:reindex', id),
    revealSource: (
      id: number,
    ): Promise<
      { ok: true; sourcePath: string } | { ok: false; kind: 'missing'; sourcePath: string }
    > => ipcRenderer.invoke('documents:revealSource', id),
    openExternal: (
      id: number,
    ): Promise<{ ok: true } | { ok: false; kind: 'missing'; message: string }> =>
      ipcRenderer.invoke('documents:openExternal', id),
    /** Gated behind PasswordRetypeGate in the renderer — the main-process
     *  handler trusts that the caller already passed verifyPassword. Returns
     *  `{ ok: true, destPath }` on a successful copy, or a structured failure
     *  ('missing' = source gone , 'cancelled' = user dismissed the save
     *  dialog , 'write_failed' = fs error). */
    exportDocument: (
      id: number,
    ): Promise<
      | { ok: true; destPath: string }
      | { ok: false; kind: 'missing' | 'cancelled' | 'write_failed'; message: string }
    > => ipcRenderer.invoke('documents:exportDocument', id),
    replaceSource: (id: number): Promise<Document | null> =>
      ipcRenderer.invoke('documents:replaceSource', id),
    refresh: (
      id: number,
    ): Promise<
      | { ok: true; outcome: 'unchanged' | 'reindexed' | 'missing' }
      | { ok: false; kind: string; message: string }
    > => ipcRenderer.invoke('documents:refresh', id),
    listMissing: (workspaceId: number): Promise<Document[]> =>
      ipcRenderer.invoke('documents:listMissing', workspaceId),
    /** User clicked "Behalten" — stamp dismissed_at so the banner stops
     *  surfacing this doc until the file reappears + vanishes again. */
    keepMissing: (id: number): Promise<void> => ipcRenderer.invoke('documents:keepMissing', id),
    listChunksForDocument: (documentId: number): Promise<DocumentChunk[]> =>
      ipcRenderer.invoke('documents:listChunksForDocument', documentId),
    getSourceForChunk: (chunkId: number): Promise<ChunkSource | null> =>
      ipcRenderer.invoke('documents:getSourceForChunk', chunkId),
    readDocumentBytes: (documentId: number): Promise<Uint8Array | null> =>
      ipcRenderer.invoke('documents:readDocumentBytes', documentId),
    onIndexProgress: (cb: (p: IndexProgress) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, p: IndexProgress): void => cb(p)
      ipcRenderer.on('indexing:progress', listener)
      return () => {
        ipcRenderer.removeListener('indexing:progress', listener)
      }
    },
  },
  conversations: {
    list: (workspaceId: number): Promise<Conversation[]> =>
      ipcRenderer.invoke('conversations:list', workspaceId),
    create: (
      workspaceId: number,
      title?: string,
      activeDocumentIds?: number[],
    ): Promise<Conversation> =>
      ipcRenderer.invoke('conversations:create', workspaceId, title, activeDocumentIds),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('conversations:delete', id),
    getWithMessages: (id: number): Promise<ConversationWithMessages> =>
      ipcRenderer.invoke('conversations:getWithMessages', id),
    generateTitle: (id: number): Promise<string | null> =>
      ipcRenderer.invoke('conversations:generateTitle', id),
    setActiveDocumentIds: (conversationId: number, ids: number[]): Promise<void> =>
      ipcRenderer.invoke('conversations:setActiveDocumentIds', conversationId, ids),
  },
  models: {
    status: (): Promise<ModelsStatus> => ipcRenderer.invoke('models:status'),
    download: (id: string): Promise<void> => ipcRenderer.invoke('models:download', id),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke('models:cancel', id),
    checkSpace: (
      requiredBytes: number,
    ): Promise<
      | { unknown: false; ok: boolean; availableBytes: number; requiredBytes: number }
      | { unknown: true; message: string; requiredBytes: number }
    > => ipcRenderer.invoke('models:checkSpace', requiredBytes),
    onProgress: async (cb: (ev: ModelDownloadEvent) => void): Promise<() => void> => {
      const channel = await ipcRenderer.invoke('models:subscribeProgress')
      const listener = (_e: IpcRendererEvent, ev: ModelDownloadEvent): void => cb(ev)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
  },
  embedder: {
    status: (): Promise<EmbedderStatus> => ipcRenderer.invoke('embedder:status'),
    info: (): Promise<EmbedderInfo> => ipcRenderer.invoke('embedder:info'),
    reload: (): Promise<EmbedderInfo> => ipcRenderer.invoke('embedder:reload'),
    setPlacement: (choice: 'auto' | 'cpu' | 'gpu'): Promise<void> =>
      ipcRenderer.invoke('embedder:setPlacement', choice),
    backfillStatus: (workspaceId: number): Promise<BackfillStatus> =>
      ipcRenderer.invoke('embedder:backfillStatus', workspaceId),
    runBackfill: (workspaceId: number): Promise<void> =>
      ipcRenderer.invoke('embedder:runBackfill', workspaceId),
    onStatus: (cb: (s: EmbedderStatus) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, s: EmbedderStatus): void => cb(s)
      ipcRenderer.on('embedder:status', listener)
      return () => {
        ipcRenderer.removeListener('embedder:status', listener)
      }
    },
    onBackfillStatus: (cb: (s: BackfillStatus) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, s: BackfillStatus): void => cb(s)
      ipcRenderer.on('embedder:backfillStatus', listener)
      return () => {
        ipcRenderer.removeListener('embedder:backfillStatus', listener)
      }
    },
    trySwitchSource: (source: 'bundled' | 'ollama') =>
      ipcRenderer.invoke('embedder:trySwitchSource', source) as Promise<
        { ok: true; identity: string } | { ok: false; kind: string; message?: string }
      >,
  },
  search: {
    hybrid: (
      workspaceId: number,
      query: string,
      topK: number,
      opts?: RetrievalOptions,
    ): Promise<RetrievalHit[]> =>
      ipcRenderer.invoke('search:hybrid', workspaceId, query, topK, opts ?? {}),
  },
  reranker: {
    status: (): Promise<RerankerStatus> => ipcRenderer.invoke('reranker:status'),
    info: (): Promise<RerankerInfo> => ipcRenderer.invoke('reranker:info'),
    reload: (): Promise<RerankerInfo> => ipcRenderer.invoke('reranker:reload'),
    warmup: (): Promise<void> => ipcRenderer.invoke('reranker:warmup'),
    setPlacement: (choice: 'auto' | 'cpu' | 'gpu'): Promise<void> =>
      ipcRenderer.invoke('reranker:setPlacement', choice),
    onStatus: (cb: (s: RerankerStatus) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, s: RerankerStatus): void => cb(s)
      ipcRenderer.on('reranker:status', listener)
      return () => {
        ipcRenderer.removeListener('reranker:status', listener)
      }
    },
  },
  llm: {
    status: (): Promise<ModelStatus> => ipcRenderer.invoke('llm:status'),
    info: (): Promise<SystemInfo> => ipcRenderer.invoke('llm:info'),
    reload: (): Promise<SystemInfo> => ipcRenderer.invoke('llm:reload'),
    setProfile: (choice: LlmProfileChoice): Promise<void> =>
      ipcRenderer.invoke('llm:setProfile', choice),
    onStatus: (cb: (s: ModelStatus) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, s: ModelStatus): void => cb(s)
      ipcRenderer.on('llm:status', listener)
      return () => {
        ipcRenderer.removeListener('llm:status', listener)
      }
    },
  },
  chat: {
    stream: (
      streamId: string,
      workspaceId: number,
      query: string,
      opts?: AnswerOptions,
    ): Promise<void> => ipcRenderer.invoke('chat:stream', streamId, workspaceId, query, opts ?? {}),
    cancel: (streamId: string): Promise<void> => ipcRenderer.invoke('chat:cancel', streamId),
    onEvent: (streamId: string, cb: (ev: StreamEvent) => void): (() => void) => {
      const channel = `chat:stream-event:${streamId}`
      const listener = (_e: IpcRendererEvent, ev: StreamEvent): void => cb(ev)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
  },
  settings: {
    get: (): Promise<UserSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: unknown): Promise<UserSettings> => ipcRenderer.invoke('settings:update', patch),
    getAvatar: (): Promise<number[] | null> => ipcRenderer.invoke('settings:getAvatar'),
    setAvatar: (bytes: number[] | null): Promise<void> =>
      ipcRenderer.invoke('settings:setAvatar', bytes),
    setDisplayName: (name: string): Promise<void> =>
      ipcRenderer.invoke('settings:setDisplayName', name),
  },
  ollama: {
    probe: (cfg: { baseUrl: string; bearerToken: string | null; timeoutMs: number }) =>
      ipcRenderer.invoke('ollama:probe', cfg) as Promise<
        | { ok: true; version: string; models: string[] }
        | { ok: false; kind: string; message: string }
      >,
  },
  logs: {
    openFolder: (): Promise<void> => ipcRenderer.invoke('logs:openFolder'),
  },
  providers: {
    onFallback: (cb: (ev: { kind: 'llm' | 'reranker'; reason: string }) => void): (() => void) => {
      const listener = (
        _e: IpcRendererEvent,
        ev: { kind: 'llm' | 'reranker'; reason: string },
      ): void => cb(ev)
      ipcRenderer.on('provider:fallback', listener)
      return () => {
        ipcRenderer.removeListener('provider:fallback', listener)
      }
    },
  },
  quiz: {
    listDecks: (workspaceId: number): Promise<QuizDeckSummary[]> =>
      ipcRenderer.invoke('quiz:list-decks', workspaceId),
    getDeck: (deckId: number): Promise<QuizDeckWithQuestions> =>
      ipcRenderer.invoke('quiz:get-deck', deckId),
    createDeck: (input: CreateQuizInput): Promise<QuizDeck> =>
      ipcRenderer.invoke('quiz:create-deck', input),
    deleteDeck: (deckId: number): Promise<void> => ipcRenderer.invoke('quiz:delete-deck', deckId),
    regenerateDeck: (deckId: number): Promise<void> =>
      ipcRenderer.invoke('quiz:regenerate-deck', deckId),
    generate: (streamId: string, deckId: number): Promise<void> =>
      ipcRenderer.invoke('quiz:generate', streamId, deckId),
    cancelGenerate: (streamId: string): Promise<void> =>
      ipcRenderer.invoke('quiz:cancel-generate', streamId),
    onGenerateEvent: (streamId: string, cb: (ev: QuizGenerationEvent) => void): (() => void) => {
      const channel = `quiz:generate-event:${streamId}`
      const listener = (_e: IpcRendererEvent, ev: QuizGenerationEvent): void => cb(ev)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
    startAttempt: (deckId: number): Promise<QuizAttempt> =>
      ipcRenderer.invoke('quiz:start-attempt', deckId),
    finishAttempt: (
      attemptId: number,
      answers: Array<{ questionId: number; selectedIndex: number }>,
    ): Promise<QuizAttempt> => ipcRenderer.invoke('quiz:finish-attempt', attemptId, answers),
    listAttempts: (deckId: number): Promise<QuizAttempt[]> =>
      ipcRenderer.invoke('quiz:list-attempts', deckId),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

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
  ChunkWithContext,
  ChunkSource,
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
    getChunkWithContext: (
      chunkId: number,
      before?: number,
      after?: number,
    ): Promise<ChunkWithContext[]> =>
      ipcRenderer.invoke('documents:getChunkWithContext', chunkId, before ?? 1, after ?? 1),
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
    create: (workspaceId: number, title?: string): Promise<Conversation> =>
      ipcRenderer.invoke('conversations:create', workspaceId, title),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('conversations:delete', id),
    getWithMessages: (id: number): Promise<ConversationWithMessages> =>
      ipcRenderer.invoke('conversations:getWithMessages', id),
    generateTitle: (id: number): Promise<string | null> =>
      ipcRenderer.invoke('conversations:generateTitle', id),
  },
  models: {
    status: (): Promise<ModelsStatus> => ipcRenderer.invoke('models:status'),
    download: (id: string): Promise<void> => ipcRenderer.invoke('models:download', id),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke('models:cancel', id),
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
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

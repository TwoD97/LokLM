import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AuthStatus, LoginResult, RegisterResult, ResetResult } from '../shared/authTypes'
import type {
  Document,
  Workspace,
  IndexProgress,
  EmbedderStatus,
  EmbedderInfo,
  BackfillStatus,
} from '../shared/documents'

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
    import: (workspaceId: number, sourcePath: string): Promise<Document> =>
      ipcRenderer.invoke('documents:import', workspaceId, sourcePath),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('documents:delete', id),
    reindex: (id: number): Promise<Document> => ipcRenderer.invoke('documents:reindex', id),
    onIndexProgress: (cb: (p: IndexProgress) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, p: IndexProgress): void => cb(p)
      ipcRenderer.on('indexing:progress', listener)
      return () => {
        ipcRenderer.removeListener('indexing:progress', listener)
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
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

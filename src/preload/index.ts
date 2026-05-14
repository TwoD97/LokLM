import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AuthStatus, LoginResult, RegisterResult, ResetResult } from '../shared/authTypes'

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
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

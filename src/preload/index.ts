import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

const api = {
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    register: (displayName: string, password: string, recoveryLang: 'de' | 'en') =>
      ipcRenderer.invoke('auth:register', { displayName, password, recoveryLang }),
    login: (password: string) => ipcRenderer.invoke('auth:login', { password }),
    logout: () => ipcRenderer.invoke('auth:logout'),
    lock: () => ipcRenderer.invoke('auth:lock'),
    reset: (passphrase: string, newPassword: string) =>
      ipcRenderer.invoke('auth:reset', { passphrase, newPassword }),
    onState: (cb: (state: unknown) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, state: unknown): void => cb(state)
      ipcRenderer.on('auth:state', listener)
      return () => {
        ipcRenderer.removeListener('auth:state', listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

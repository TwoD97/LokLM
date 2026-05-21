const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('installer', {
  getState: () => ipcRenderer.invoke('installer:get-state'),
  getLicense: () => ipcRenderer.invoke('installer:get-license'),
  chooseDir: (current) => ipcRenderer.invoke('installer:choose-dir', current),
  install: (options) => ipcRenderer.invoke('installer:install', options),
  launch: (appExePath) => ipcRenderer.invoke('installer:launch', appExePath),
  close: () => ipcRenderer.invoke('installer:close'),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('installer:progress', listener)
    return () => ipcRenderer.removeListener('installer:progress', listener)
  },
})

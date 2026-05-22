// Exposes the `window.installer.*` API that renderer.js was originally
// written against ( back when the wizard ran on electron + preload.cjs ).
// Now it just bridges those calls to Tauri's __TAURI__.core.invoke()
// channel. Loaded BEFORE renderer.js so the rest of the frontend stays
// unchanged.
;(function () {
  if (typeof window === 'undefined') return
  if (window.installer) return // electron preload won
  const tauri = window.__TAURI__
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') return
  const { invoke } = tauri.core
  const { listen } = tauri.event || {}

  window.installer = {
    getState: () => invoke('get_state'),
    getLicense: () => invoke('get_license'),
    chooseDir: (current) => invoke('choose_dir', { current }),
    install: (options) => invoke('install', { options }),
    launch: (appExePath) => invoke('launch', { appExePath }),
    close: () => invoke('close_app'),
    minimize: () => invoke('minimize_window'),
    // Mirror the electron preload signature : returns an unsubscribe fn.
    onProgress: (callback) => {
      if (!listen) return () => undefined
      let unlisten = null
      const promise = listen('installer:progress', (event) => callback(event.payload))
      promise.then((fn) => {
        unlisten = fn
      })
      return () => {
        if (typeof unlisten === 'function') unlisten()
      }
    },
  }
})()

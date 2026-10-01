import type { IpcMain } from 'electron'

// Authentication entry, window chrome and static installation/model status are
// needed before unlock. Cancellation must remain usable during a drain. Every
// other channel is private by default, including future registrations.
const PUBLIC_CHANNELS = new Set([
  'auth:status',
  'auth:register',
  'auth:login',
  'auth:reset',
  'auth:logout',
  'auth:lock',
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:isMaximized',
  'settings:get', // The handler returns defaults while locked/draining.
  'models:activity', // The handler redacts private indexing jobs while locked/draining.
  'models:status',
  'models:download',
  'models:cancel',
  'models:checkSpace',
  'models:subscribeProgress',
  'models:cancelIndexing',
  'llm:status',
  'llm:info',
  'embedder:status',
  'embedder:info',
  'reranker:status',
  'reranker:info',
  'transcription:modelStatus',
  'translation:languages',
  'ollama:connectorEnabled',
  'tier:get',
  'chat:cancel',
  'translation:cancel',
  'transcription:cancel',
  'quiz:cancel-generate',
])

/** Guard renderer admission, not AuthService's database access: writes admitted
 * before locking still need their original database while shutdown drains them. */
export function withPrivateIpcAdmission(
  ipc: Pick<IpcMain, 'handle'>,
  requireOpenSession: () => void,
  captureResponseGuard: () => () => void,
): Pick<IpcMain, 'handle'> {
  return {
    handle(channel, listener) {
      ipc.handle(channel, (event, ...args) => {
        if (PUBLIC_CHANNELS.has(channel)) return listener(event, ...args)
        requireOpenSession()
        const assertCurrent = captureResponseGuard()
        const result = listener(event, ...args)
        return Promise.resolve(result).then(
          (value) => {
            // An admitted DB operation may finish during draining, but its old
            // result must never be published into a locked/replacement session.
            requireOpenSession()
            assertCurrent()
            return value
          },
          (error: unknown) => {
            // Errors may contain source paths or document text too. Retire an
            // old rejection just as strictly as a successful private result.
            requireOpenSession()
            assertCurrent()
            throw error
          },
        )
      })
    },
  }
}

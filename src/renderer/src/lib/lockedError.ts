/** Renderer-side detector for the LockedError class that main throws when
 *  AuthService.requireDatabase() is called against a locked session. The
 *  class lives in main (src/main/services/auth/AuthService.ts) and can't
 *  cross the IPC boundary as an `instanceof`-able class — Electron flattens
 *  thrown errors into a plain Error with `message` and (for own enumerable
 *  fields on Error subclasses) `code` + `name` preserved. We check all three
 *  channels to stay robust across Electron versions and error origins.
 *
 *  The intent on the renderer side: detect this without having to wrap every
 *  one of the 27+ IPC handlers individually. App.tsx installs a global
 *  `unhandledrejection` listener; views that handle their own IPC errors can
 *  still use this directly. */
export function isLockedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; name?: unknown; message?: unknown }
  if (e.code === 'LOCKED' || e.name === 'LockedError') return true
  // Last-resort match against the message text. Kept narrow so a chat
  // refusal that happens to contain the word "locked" can't trigger it.
  if (typeof e.message === 'string') {
    if (e.message === 'locked') return true
    // Electron wraps thrown errors as
    //   "Error invoking remote method '…': Error: locked"
    if (/: Error: locked$/.test(e.message)) return true
  }
  return false
}

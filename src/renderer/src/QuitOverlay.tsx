import { useEffect, useState } from 'react'
import { useT } from './i18n'

/**
 * Full-screen overlay shown while the main process drains in-flight indexing
 * and re-encrypts the vault — either during the before-quit drain or an
 * explicit lock/logout (drainIndexingForLock). Without it the window stays
 * interactive for the length of the drain — up to the drain ceiling — and
 * reads as a hang. The quit variant has no "hide" path (the window closes,
 * unmounting the renderer); the lock variant is torn down by the trailing
 * `app:locking false` once the vault is locked.
 */
export function QuitOverlay(): JSX.Element | null {
  const t = useT()
  const [quitting, setQuitting] = useState(false)
  const [locking, setLocking] = useState(false)

  useEffect(() => {
    const offQuit = window.api.window.onQuitting(() => setQuitting(true))
    const offLock = window.api.window.onLocking(setLocking)
    return () => {
      offQuit()
      offLock()
    }
  }, [])

  if (!quitting && !locking) return null
  return (
    <div className="quit-overlay" role="status" aria-live="polite">
      <div className="quit-overlay__spinner" aria-hidden="true" />
      {/* quitting wins: if a quit lands mid-lock-drain the process is exiting,
          so the message must not flip back to "locking". */}
      <span>{t(quitting ? 'shell.quitting' : 'shell.locking')}</span>
    </div>
  )
}

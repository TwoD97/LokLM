import { useEffect, useRef, useState } from 'react'
import { useT } from './i18n'
import { useModalFocus } from './ui/useModalFocus'

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
  const overlay = useRef<HTMLDivElement>(null)
  const active = quitting || locking
  useModalFocus(overlay, active)
  useEffect(() => {
    if (active) overlay.current?.focus()
  }, [active])

  useEffect(() => {
    const offQuit = window.api.window.onQuitting(() => setQuitting(true))
    const offLock = window.api.window.onLocking(setLocking)
    return () => {
      offQuit()
      offLock()
    }
  }, [])

  if (!active) return null
  return (
    <div
      ref={overlay}
      className="quit-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t(quitting ? 'shell.quitting' : 'shell.locking')}
      tabIndex={-1}
    >
      <div className="quit-overlay__spinner" aria-hidden="true" />
      {/* quitting wins: if a quit lands mid-lock-drain the process is exiting,
          so the message must not flip back to "locking". */}
      <span role="status" aria-live="polite">
        {t(quitting ? 'shell.quitting' : 'shell.locking')}
      </span>
    </div>
  )
}

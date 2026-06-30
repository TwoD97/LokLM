import { useEffect, useState } from 'react'
import { useT } from './i18n'

/**
 * Full-screen overlay shown once the main process begins its before-quit drain
 * (finishing in-flight indexing, then re-encrypting the vault). Without it the
 * window stays open and interactive for the length of the drain — up to
 * QUIT_DRAIN_MAX_MS — and reads as a hang. The window closes when the drain
 * completes, which unmounts the whole renderer, so there is no "hide" path: once
 * shown it stays until the process exits.
 */
export function QuitOverlay(): JSX.Element | null {
  const t = useT()
  const [quitting, setQuitting] = useState(false)

  useEffect(() => {
    const off = window.api.window.onQuitting(() => setQuitting(true))
    return () => off()
  }, [])

  if (!quitting) return null
  return (
    <div className="quit-overlay" role="status" aria-live="polite">
      <div className="quit-overlay__spinner" aria-hidden="true" />
      <span>{t('shell.quitting')}</span>
    </div>
  )
}

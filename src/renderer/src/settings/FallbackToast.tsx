import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

/** Bottom-right toast that appears when the provider registry signals a
 *  fallback from Ollama back to the bundled LLM (Task 19 wired the
 *  `provider:fallback` channel). The toast auto-dismisses after 8s and
 *  offers a shortcut into Settings so the user can reconfigure Ollama.
 *
 *  Only `kind === 'llm'` fallbacks are surfaced here — reranker fallbacks
 *  are silently degraded since they don't affect answer text. */
export function FallbackToast(props: { onOpenSettings: () => void }): JSX.Element | null {
  const t = useT()
  const [visible, setVisible] = useState(false)
  // Track the active auto-dismiss timer so a new fallback event (or an
  // unmount) cancels the previous one cleanly. Without this, the inner
  // setTimeout would leak across rapid successive fallbacks.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const clearTimer = (): void => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    const off = window.api.providers.onFallback((ev) => {
      if (ev.kind !== 'llm') return
      clearTimer()
      setVisible(true)
      timerRef.current = setTimeout(() => {
        setVisible(false)
        timerRef.current = null
      }, 8000)
    })
    return () => {
      clearTimer()
      off()
    }
  }, [])

  if (!visible) return null
  return (
    <div className="settings-fallback-toast" role="status" aria-live="polite">
      {t('settings.fallback.message')}{' '}
      <button type="button" onClick={props.onOpenSettings} style={{ marginLeft: 8 }}>
        {t('settings.fallback.settings')}
      </button>
      <button
        type="button"
        onClick={() => setVisible(false)}
        style={{ marginLeft: 4 }}
        aria-label={t('settings.fallback.dismiss')}
      >
        ×
      </button>
    </div>
  )
}

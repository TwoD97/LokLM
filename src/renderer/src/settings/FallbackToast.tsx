import { useEffect, useRef, useState } from 'react'

/** Bottom-right toast that appears when the provider registry signals a
 *  fallback from Ollama back to the bundled LLM (Task 19 wired the
 *  `provider:fallback` channel). The toast auto-dismisses after 8s and
 *  offers a shortcut into Settings so the user can reconfigure Ollama.
 *
 *  Only `kind === 'llm'` fallbacks are surfaced here — reranker fallbacks
 *  are silently degraded since they don't affect answer text. */
export function FallbackToast(props: { onOpenSettings: () => void }): JSX.Element | null {
  const [msg, setMsg] = useState<string | null>(null)
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
      setMsg('Ollama unreachable — used bundled model.')
      timerRef.current = setTimeout(() => {
        setMsg(null)
        timerRef.current = null
      }, 8000)
    })
    return () => {
      clearTimer()
      off()
    }
  }, [])

  if (!msg) return null
  return (
    <div className="settings-fallback-toast" role="status" aria-live="polite">
      {msg}{' '}
      <button type="button" onClick={props.onOpenSettings} style={{ marginLeft: 8 }}>
        Settings
      </button>
      <button
        type="button"
        onClick={() => setMsg(null)}
        style={{ marginLeft: 4 }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}

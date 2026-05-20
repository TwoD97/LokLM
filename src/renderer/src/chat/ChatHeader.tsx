import { useEffect, useState } from 'react'
import type { ModelStatus } from '@shared/documents'

type Props = {
  title: string
  onDelete: (() => void) | null
}

export function ChatHeader({ title, onDelete }: Props): JSX.Element {
  // Subscribe to LLM status so we can surface which provider produced the
  // current model state. The TitleBar already owns the colored status dot;
  // here we just append a small text label next to the title so users in the
  // chat view can see at a glance whether they're talking to Ollama or the
  // bundled engine (and whether a runtime fallback flipped them back).
  const [status, setStatus] = useState<Pick<ModelStatus, 'source' | 'fallback'> | null>(null)
  useEffect(() => {
    void window.api.llm.status().then((s) => setStatus({ source: s.source, fallback: s.fallback }))
    const off = window.api.llm.onStatus((s) =>
      setStatus({ source: s.source, fallback: s.fallback }),
    )
    return () => off()
  }, [])

  return (
    <header className="chat__header">
      <span className="chat__header-title">{title}</span>
      {status && status.source === 'ollama' && (
        <span
          className="chat__header-source"
          style={{ marginLeft: 8, color: '#9fb3cc', fontSize: 12 }}
          title={status.fallback?.reason ?? undefined}
        >
          {status.fallback?.active ? 'via Ollama → bundled (fallback)' : 'via Ollama'}
        </span>
      )}
      {onDelete && (
        <button
          type="button"
          className="chat__header-action"
          onClick={onDelete}
          aria-label="Delete conversation"
          title="Delete conversation"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path
              d="M5 7h14M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2m-7 0v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7M10 11v6M14 11v6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </header>
  )
}

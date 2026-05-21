import { useEffect, useState } from 'react'
import type { EmbedderState, ModelState, RerankerState } from '@shared/documents'

type DotState = EmbedderState | RerankerState | ModelState

function dotLabel(label: string, state: DotState, message: string | null): string {
  const base = `${label}: ${state}`
  return message ? `${base} — ${message}` : base
}

type TitleBarProps = {
  onOpenSettings?: () => void
  unlocked?: boolean
}

export function TitleBar({ onOpenSettings, unlocked = false }: TitleBarProps = {}): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const [embedder, setEmbedder] = useState<{ state: EmbedderState; message: string | null }>({
    state: 'idle',
    message: null,
  })
  const [reranker, setReranker] = useState<{ state: RerankerState; message: string | null }>({
    state: 'idle',
    message: null,
  })
  const [llm, setLlm] = useState<{
    state: ModelState
    message: string | null
    source: 'bundled' | 'ollama'
  }>({
    state: 'idle',
    message: null,
    source: 'bundled',
  })

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    const off = window.api.window.onMaximizedChange(setMaximized)
    return () => off()
  }, [])

  useEffect(() => {
    void window.api.embedder
      .status()
      .then((s) => setEmbedder({ state: s.state, message: s.message }))
    const off = window.api.embedder.onStatus((s) =>
      setEmbedder({ state: s.state, message: s.message }),
    )
    return () => off()
  }, [])

  useEffect(() => {
    void window.api.reranker
      .status()
      .then((s) => setReranker({ state: s.state, message: s.message }))
    const off = window.api.reranker.onStatus((s) =>
      setReranker({ state: s.state, message: s.message }),
    )
    return () => off()
  }, [])

  useEffect(() => {
    void window.api.llm
      .status()
      .then((s) => setLlm({ state: s.state, message: s.message, source: s.source }))
    const off = window.api.llm.onStatus((s) =>
      setLlm({ state: s.state, message: s.message, source: s.source }),
    )
    return () => off()
  }, [])

  return (
    <div className="titlebar" role="presentation">
      <div className="titlebar__brand-group">
        <span className="titlebar__logo" aria-hidden="true">
          <svg viewBox="0 0 64 64" width="16" height="16" fill="none">
            <rect
              x="14"
              y="22"
              width="36"
              height="30"
              rx="2"
              stroke="#F6F4EF"
              strokeWidth="3"
              opacity="0.4"
            />
            <rect
              x="11"
              y="17"
              width="36"
              height="30"
              rx="2"
              stroke="#F6F4EF"
              strokeWidth="3"
              opacity="0.7"
            />
            <rect
              x="8"
              y="12"
              width="36"
              height="30"
              rx="2"
              fill="#0B1B2B"
              stroke="#F6F4EF"
              strokeWidth="3"
            />
            <circle cx="38" cy="20" r="2.6" fill="#7DD3FC" />
          </svg>
        </span>
        <span className="titlebar__brand">LokLM</span>
      </div>

      <div className="titlebar__status" aria-label="Modellstatus">
        <span
          className={`titlebar__dot titlebar__dot--${llm.state}${
            llm.state === 'ready' && llm.source === 'ollama' ? ' titlebar__dot--ollama' : ''
          }`}
          role="img"
          aria-label={dotLabel('LLM', llm.state, llm.message)}
          title={dotLabel('LLM', llm.state, llm.message)}
        />
        <span
          className={`titlebar__dot titlebar__dot--${embedder.state}`}
          role="img"
          aria-label={dotLabel('Embedder', embedder.state, embedder.message)}
          title={dotLabel('Embedder', embedder.state, embedder.message)}
        />
        <span
          className={`titlebar__dot titlebar__dot--${reranker.state}`}
          role="img"
          aria-label={dotLabel('Reranker', reranker.state, reranker.message)}
          title={dotLabel('Reranker', reranker.state, reranker.message)}
        />
      </div>

      <div className="titlebar__spacer" />

      <div className="titlebar__controls">
        {unlocked && onOpenSettings && (
          <button
            type="button"
            className="titlebar__btn titlebar__btn--icon"
            aria-label="Settings"
            title="Settings"
            onClick={onOpenSettings}
          >
            ⚙
          </button>
        )}
        <button
          type="button"
          className="titlebar__btn"
          aria-label="Minimieren"
          onClick={() => void window.api.window.minimize()}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar__btn"
          aria-label={maximized ? 'Wiederherstellen' : 'Maximieren'}
          onClick={() => void window.api.window.toggleMaximize()}
        >
          {maximized ? (
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
              <rect
                x="2"
                y="0.5"
                width="7.5"
                height="7.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
              <rect
                x="0.5"
                y="2"
                width="7.5"
                height="7.5"
                fill="var(--bg-0)"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="9"
                height="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="titlebar__btn titlebar__btn--close"
          aria-label="Schließen"
          onClick={() => void window.api.window.close()}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  )
}

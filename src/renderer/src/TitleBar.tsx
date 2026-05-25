import { useEffect, useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import type { EmbedderState, ModelState, RerankerState } from '@shared/documents'
import { useT, type TFn } from './i18n'

type DotState = EmbedderState | RerankerState | ModelState
type DotSource = 'bundled' | 'ollama'

// Maps the raw service state + source onto the pill text shown in the hover
// tooltip. Mirrors the LLM chat-header pill vocabulary ("Local"/"Remote") so
// the TitleBar reads consistently with the rest of the app.
function pillText(t: TFn, state: DotState, source: DotSource): string {
  const where = source === 'ollama' ? t('shell.locationRemote') : t('shell.locationLocal')
  switch (state) {
    case 'ready':
      return t('shell.statusRunning', { where })
    case 'loading':
      return t('shell.statusLoading', { where })
    case 'failed':
      return t('shell.statusFailed', { where })
    case 'unloaded':
      return t('shell.statusUnloaded', { where })
    case 'idle':
    default:
      return t('shell.statusIdle', { where })
  }
}

// Native `title=` fallback for screen readers and users who hover before our
// custom tooltip renders. The pill is decorative; this string is the truth.
function ariaText(
  t: TFn,
  label: string,
  state: DotState,
  source: DotSource,
  message: string | null,
): string {
  const base = `${label}: ${pillText(t, state, source)}`
  return message ? `${base} — ${message}` : base
}

type DotProps = {
  label: string
  state: DotState
  source: DotSource
  message: string | null
  extraClass?: string
}

function StatusDot({ label, state, source, message, extraClass }: DotProps): JSX.Element {
  const t = useT()
  const ollamaClass = state === 'ready' && source === 'ollama' ? ' titlebar__dot--ollama' : ''
  return (
    <span
      className={`titlebar__dot-wrap${extraClass ? ` ${extraClass}` : ''}`}
      role="img"
      aria-label={ariaText(t, label, state, source, message)}
    >
      <span className={`titlebar__dot titlebar__dot--${state}${ollamaClass}`} aria-hidden="true" />
      <span className="titlebar__pill" role="tooltip">
        <span className="titlebar__pill-label">{label}</span>
        <span className={`titlebar__pill-dot titlebar__pill-dot--${state}${ollamaClass}`} />
        <span className="titlebar__pill-text">{pillText(t, state, source)}</span>
        {message && <span className="titlebar__pill-msg">{message}</span>}
      </span>
    </span>
  )
}

type TitleBarProps = {
  onOpenSettings?: () => void
  unlocked?: boolean
}

export function TitleBar({ onOpenSettings, unlocked = false }: TitleBarProps = {}): JSX.Element {
  const t = useT()
  const [maximized, setMaximized] = useState(false)
  const [embedder, setEmbedder] = useState<{
    state: EmbedderState
    message: string | null
    source: DotSource
  }>({
    state: 'idle',
    message: null,
    source: 'bundled',
  })
  const [reranker, setReranker] = useState<{
    state: RerankerState
    message: string | null
    source: DotSource
  }>({
    state: 'idle',
    message: null,
    source: 'bundled',
  })
  const [llm, setLlm] = useState<{
    state: ModelState
    message: string | null
    source: DotSource
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
      .then((s) => setEmbedder({ state: s.state, message: s.message, source: s.source }))
    const off = window.api.embedder.onStatus((s) =>
      setEmbedder({ state: s.state, message: s.message, source: s.source }),
    )
    return () => off()
  }, [])

  useEffect(() => {
    void window.api.reranker
      .status()
      .then((s) => setReranker({ state: s.state, message: s.message, source: s.source }))
    const off = window.api.reranker.onStatus((s) =>
      setReranker({ state: s.state, message: s.message, source: s.source }),
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

      <div className="titlebar__status" aria-label={t('shell.modelStatus')}>
        <StatusDot label="LLM" state={llm.state} source={llm.source} message={llm.message} />
        <StatusDot
          label="Embedder"
          state={embedder.state}
          source={embedder.source}
          message={embedder.message}
        />
        <StatusDot
          label="Reranker"
          state={reranker.state}
          source={reranker.source}
          message={reranker.message}
        />
      </div>

      <div className="titlebar__spacer" />

      <div className="titlebar__controls">
        {unlocked && onOpenSettings && (
          <button
            type="button"
            className="titlebar__btn titlebar__btn--icon"
            aria-label={t('shell.settings')}
            title={t('shell.settings')}
            onClick={onOpenSettings}
          >
            <SettingsIcon size={16} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="titlebar__btn"
          aria-label={t('shell.minimize')}
          onClick={() => void window.api.window.minimize()}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar__btn"
          aria-label={maximized ? t('shell.restore') : t('shell.maximize')}
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
          aria-label={t('common.close')}
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

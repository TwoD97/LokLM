import { useEffect, useState } from 'react'

export function TitleBar(): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    const off = window.api.window.onMaximizedChange(setMaximized)
    return () => off()
  }, [])

  return (
    <div className="titlebar" role="presentation">
      <div className="titlebar__brand-group">
        <span className="titlebar__logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14">
            <defs>
              <linearGradient id="tb-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#60a5fa" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
            <rect x="3" y="3" width="18" height="18" rx="5" fill="url(#tb-grad)" opacity="0.9" />
            <path
              d="M8 8.5 v7 h7.5"
              fill="none"
              stroke="#0e1116"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="titlebar__brand">LokLM</span>
      </div>

      <div className="titlebar__spacer" />

      <div className="titlebar__controls">
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

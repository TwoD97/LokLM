import { useEffect, useState } from 'react'
import { Settings as SettingsIcon, Lock as LockIcon } from 'lucide-react'
import { useT } from './i18n'
import { AppStatus } from './status/AppStatus'

type TitleBarProps = {
  onOpenSettings?: (section?: 'system') => void
  unlocked?: boolean
}

export function TitleBar({ onOpenSettings, unlocked = false }: TitleBarProps = {}): JSX.Element {
  const t = useT()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    void window.api.window
      .isMaximized()
      .then(setMaximized)
      .catch(() => undefined)
    return window.api.window.onMaximizedChange(setMaximized)
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

      <div className="titlebar__spacer" />
      {unlocked && <AppStatus onOpenSettings={onOpenSettings} />}
      <div className="titlebar__spacer" />

      <div className="titlebar__controls">
        {unlocked && (
          <button
            type="button"
            className="titlebar__btn titlebar__btn--icon"
            aria-label={t('auth.lock')}
            title={t('auth.lock')}
            onClick={() => void window.api.auth.lock()}
          >
            <LockIcon size={16} aria-hidden="true" />
          </button>
        )}
        {unlocked && onOpenSettings && (
          <button
            type="button"
            className="titlebar__btn titlebar__btn--icon"
            aria-label={t('shell.settings')}
            title={t('shell.settings')}
            onClick={() => onOpenSettings()}
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

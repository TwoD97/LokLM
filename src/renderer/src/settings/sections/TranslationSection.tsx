import { SectionHeader } from './SectionHeader'
import { useEffect, useId, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { TranslatorStatus } from '@shared/translation'
import { useT } from '../../i18n'

// Translation shares the selected chat model and its lifecycle/status.

export function TranslationSection(): JSX.Element {
  const t = useT()
  const sectionId = useId()
  const [open, setOpen] = useState(true)
  const [status, setStatus] = useState<TranslatorStatus | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let mounted = true
    let receivedUpdate = false
    setLoadFailed(false)
    void window.api.translation
      .status()
      .then((s) => {
        if (mounted && !receivedUpdate) setStatus(s)
      })
      .catch(() => {
        if (mounted && !receivedUpdate) setLoadFailed(true)
      })
    const offStatus = window.api.translation.onStatus((s) => {
      receivedUpdate = true
      if (mounted) {
        setStatus(s)
        setLoadFailed(false)
      }
    })
    return () => {
      mounted = false
      offStatus()
    }
  }, [attempt])

  const state = status?.state ?? null
  const stateKey =
    state === null
      ? 'settings.loading'
      : (
          {
            not_installed: 'settings.translation.stateNotInstalled',
            installed: 'settings.translation.stateInstalled',
            starting: 'settings.translation.stateStarting',
            ready: 'settings.translation.stateReady',
            error: 'settings.translation.stateError',
          } as const
        )[state]

  const notInstalled = state === 'not_installed' || state === 'error'

  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <SectionHeader
        id={sectionId}
        title={t('settings.translation.title')}
        subtitle={t('settings.translation.sub')}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      <div
        id={`${sectionId}-body`}
        role="region"
        aria-labelledby={`${sectionId}-title`}
        hidden={!open}
      >
        <div className="settings-group__body">
          {loadFailed && (
            <p className="preferences-error" role="alert">
              {t('settings.translation.loadError')}{' '}
              <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                {t('prefs.retry')}
              </button>
            </p>
          )}
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.translation.status')}</span>
              {!loadFailed && <span className="settings-row__hint">{t(stateKey)}</span>}
            </div>
          </div>

          {notInstalled && (
            <div className="settings-row">
              <div className="settings-row__label">
                <span className="settings-row__hint">
                  {t('settings.translation.notInstalledHint')}
                </span>
              </div>
            </div>
          )}

          {state === 'error' && status?.message && (
            <div className="settings-inline-warning">
              <span className="settings-inline-warning__icon" aria-hidden="true">
                <AlertTriangle size={14} />
              </span>
              <span>{status.message}</span>
            </div>
          )}

          {(state === 'installed' || state === 'ready' || state === 'starting') && (
            <div className="settings-row">
              <div className="settings-row__label">
                <span className="settings-row__hint">{t('settings.translation.usageHint')}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

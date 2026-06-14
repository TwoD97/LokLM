import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { TranslatorStatus } from '@shared/translation'
import { useT } from '../../i18n'

// Status of the MADLAD translation model (~2.8 GB). The model is provisioned
// by the installer wizard ( model-manifest.json , role "translation" ) , not
// downloaded in-app — so this section only reports state and , when the model
// is absent , points the user back to re-running the LokLM installer. State
// lives in main (TranslationService) and is mirrored here via translation:status
// pushes.

export function TranslationSection(): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(true)
  const [status, setStatus] = useState<TranslatorStatus | null>(null)

  useEffect(() => {
    let mounted = true
    void window.api.translation.status().then((s) => {
      if (mounted) setStatus(s)
    })
    const offStatus = window.api.translation.onStatus((s) => setStatus(s))
    return () => {
      mounted = false
      offStatus()
    }
  }, [])

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
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">{t('settings.translation.title')}</div>
          <div className="settings-group__sub">{t('settings.translation.sub')}</div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.translation.status')}</span>
              <span className="settings-row__hint">{t(stateKey)}</span>
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

          {status && !status.sidecarAvailable && (
            <div className="settings-inline-warning">
              <span className="settings-inline-warning__icon" aria-hidden="true">
                <AlertTriangle size={14} />
              </span>
              <span>{t('settings.translation.sidecarMissing')}</span>
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
      )}
    </div>
  )
}

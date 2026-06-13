import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { ModelDownloadEvent } from '@preload/index'
import type { TranslatorStatus } from '@shared/translation'
import { useT } from '../../i18n'

// Install/manage the MADLAD translation model (~2.8 GB , optional). Unlike
// the other sections this owns no UserSettings — state lives in main
// (TranslationService) and is mirrored here via translation:status pushes.
// Download progress rides the shared models progress channel; the four
// translator files all carry `translator-*` ids and model.bin is 99.7% of
// the bytes , so showing the active file's progress is honest enough.

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

type Progress = {
  id: string
  phase: ModelDownloadEvent['phase']
  bytesReceived: number
  totalBytes: number
  bytesPerSec: number | null
  message: string | null
}

export function TranslationSection(): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(true)
  const [status, setStatus] = useState<TranslatorStatus | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)

  useEffect(() => {
    let mounted = true
    void window.api.translation.status().then((s) => {
      if (mounted) setStatus(s)
    })
    const offStatus = window.api.translation.onStatus((s) => setStatus(s))
    let offProgress: (() => void) | null = null
    let cancelled = false
    void window.api.models
      .onProgress((ev: ModelDownloadEvent) => {
        if (!ev.id.startsWith('translator-')) return
        setProgress(ev)
      })
      .then((off) => {
        if (cancelled) off()
        else offProgress = off
      })
    return () => {
      mounted = false
      cancelled = true
      offStatus()
      if (offProgress) offProgress()
    }
  }, [])

  const state = status?.state ?? null
  const stateKey =
    state === null
      ? 'settings.loading'
      : (
          {
            not_installed: 'settings.translation.stateNotInstalled',
            downloading: 'settings.translation.stateDownloading',
            installed: 'settings.translation.stateInstalled',
            starting: 'settings.translation.stateStarting',
            ready: 'settings.translation.stateReady',
            error: 'settings.translation.stateError',
          } as const
        )[state]

  const showInstall = state === 'not_installed' || state === 'error'
  const downloading = state === 'downloading'
  const pct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.bytesReceived / progress.totalBytes) * 100))
      : null

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
            {showInstall && (
              <button
                className="settings-btn"
                disabled={!status || !status.sidecarAvailable}
                onClick={() => {
                  setProgress(null)
                  void window.api.translation.install().catch(() => {
                    // Error state arrives via the status push; nothing to do here.
                  })
                }}
              >
                {state === 'error'
                  ? t('settings.translation.retry')
                  : t('settings.translation.install')}
              </button>
            )}
            {downloading && (
              <button
                className="settings-btn"
                onClick={() => void window.api.translation.cancelInstall()}
              >
                {t('settings.translation.cancel')}
              </button>
            )}
          </div>

          {showInstall && (
            <div className="settings-row">
              <div className="settings-row__label">
                <span className="settings-row__hint">{t('settings.translation.installHint')}</span>
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

          {downloading && progress && (
            <div className="settings-row">
              <div className="settings-row__label">
                <span className="settings-row__label-text">
                  {pct !== null
                    ? t('settings.translation.progress', {
                        pct,
                        received: fmtBytes(progress.bytesReceived),
                        total: fmtBytes(progress.totalBytes),
                      })
                    : t('settings.translation.progressIndeterminate')}
                </span>
                <span className="settings-row__hint">
                  {progress.bytesPerSec != null && `${fmtBytes(progress.bytesPerSec)}/s`}
                </span>
              </div>
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

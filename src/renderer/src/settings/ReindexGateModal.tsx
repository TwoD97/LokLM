import { useEffect, useState } from 'react'
import { useT } from '../i18n'

type Props = {
  open: boolean
  fromIdentity: string
  toIdentity: string
  onConfirm: () => Promise<void>
  onCancel: () => void
}

export function ReindexGateModal({
  open,
  fromIdentity,
  toIdentity,
  onConfirm,
  onCancel,
}: Props): JSX.Element | null {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) {
      setBusy(false)
      setError(null)
    }
  }, [open])
  if (!open) return null
  return (
    <div className="settings-backdrop" role="presentation">
      <div className="settings-modal" style={{ width: 520 }} role="dialog" aria-modal="true">
        <div className="settings-modal__body">
          <h3 style={{ marginTop: 0 }}>{t('settings.reindex.heading')}</h3>
          <p>
            {t('settings.reindex.bodyPre')} <code>{fromIdentity}</code>{' '}
            {t('settings.reindex.bodyMid')} <code>{toIdentity}</code>{' '}
            {t('settings.reindex.bodyPost')}
          </p>
          {error && <div style={{ color: 'var(--error)', marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onCancel} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button
              style={{ background: 'var(--success)', color: '#fff' }}
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await onConfirm()
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? t('settings.reindex.busy') : t('settings.reindex.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

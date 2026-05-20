import { useEffect, useState } from 'react'

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
          <h3 style={{ marginTop: 0 }}>Re-index required</h3>
          <p>
            Switching embedder from <code>{fromIdentity}</code> to <code>{toIdentity}</code> changes
            the embedding model. Existing chunks must be re-embedded; search results will be
            unavailable until re-indexing finishes.
          </p>
          {error && <div style={{ color: '#ff8080', marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              style={{ background: '#2c5d4f', color: '#fff' }}
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
              {busy ? 'Re-indexing…' : 'Re-index now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

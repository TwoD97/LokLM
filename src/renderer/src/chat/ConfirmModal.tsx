type Props = {
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  return (
    <div className="confirm-modal__backdrop" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
        <p style={{ marginTop: 8, opacity: 0.8 }}>{body}</p>
        <div className="confirm-modal__actions">
          <button onClick={onCancel}>{cancelLabel}</button>
          <button onClick={onConfirm} style={{ background: '#5a1f1f', color: '#f0d4d4' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

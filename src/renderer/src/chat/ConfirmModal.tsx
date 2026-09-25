import { useT } from '../i18n'
import { useId, useRef } from 'react'
import { useModalFocus } from '../ui/useModalFocus'

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
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModalFocus(ref, true)
  const confirm = confirmLabel ?? t('common.delete')
  const cancel = cancelLabel ?? t('common.cancel')
  return (
    <div className="confirm-modal__backdrop" onClick={onCancel}>
      <div
        className="confirm-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} style={{ margin: 0, fontSize: 18 }}>
          {title}
        </h3>
        <p style={{ marginTop: 8, opacity: 0.8 }}>{body}</p>
        <div className="confirm-modal__actions">
          <button onClick={onCancel}>{cancel}</button>
          <button
            onClick={onConfirm}
            style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
          >
            {confirm}
          </button>
        </div>
      </div>
    </div>
  )
}

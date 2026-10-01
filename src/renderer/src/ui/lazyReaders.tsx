import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { useT } from '../i18n'
import { useModalFocus } from './useModalFocus'
import '../chat/chat.css'

export const SourceViewer = lazy(() =>
  import('../chat/SourceViewer').then((module) => ({ default: module.SourceViewer })),
)
export const DocumentPreview = lazy(() =>
  import('../library/DocumentPreview').then((module) => ({ default: module.DocumentPreview })),
)

/** Keep the reader's close/focus controls available while its local chunk loads. */
export function ReaderBoundary({
  children,
  label,
  onClose,
}: {
  children: ReactNode
  label: string
  onClose: () => void
}): JSX.Element {
  return (
    <Suspense fallback={<ReaderLoading label={label} onClose={onClose} />}>{children}</Suspense>
  )
}

function ReaderLoading({ label, onClose }: { label: string; onClose: () => void }): JSX.Element {
  const t = useT()
  const ref = useRef<HTMLElement>(null)
  useModalFocus(ref, true)
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div
      className="source-viewer__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside
        ref={ref}
        className="source-viewer source-viewer--text"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <header className="source-viewer__header">
          <span className="source-viewer__title">{label}</span>
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </header>
        <div className="source-viewer__body">
          <p role="status">{t('common.loading')}</p>
        </div>
      </aside>
    </div>
  )
}

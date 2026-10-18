import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Document } from '@shared/documents'
import { useGeneration } from '../generation/GenerationContext'
import { useT } from '../i18n'
import type { TFn } from '../i18n'
import { useModalFocus } from '../ui/useModalFocus'

type SummaryState =
  | { kind: 'loading' }
  | { kind: 'ready'; text: string }
  | { kind: 'error'; message: string }

/**
 * Lazily fetches (and the backend caches) a whole-document summary, shown in a
 * modal. First open generates it — subsequent opens return the cache instantly.
 */
export function SummaryModal({
  doc,
  onClose,
}: {
  doc: Document
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const { begin: beginGeneration } = useGeneration()
  const [state, setState] = useState<SummaryState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const modalRef = useRef<HTMLDivElement>(null)
  useModalFocus(modalRef, true)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    // The summary generates on the LLM (worker FIFO) and keeps running in main
    // even if this modal is closed, so end the registry job when the request
    // settles — not on unmount.
    const endGeneration = beginGeneration('summary')
    window.api.documents
      .summarize(doc.id)
      .then((r) => {
        if (!cancelled) setState({ kind: 'ready', text: r.summary })
      })
      .catch((err) => {
        if (cancelled) return
        const raw = err instanceof Error ? err.message : String(err)
        setState({ kind: 'error', message: localizeSummaryError(raw, t) })
      })
      .finally(() => endGeneration())
    return () => {
      cancelled = true
    }
  }, [doc.id, t, beginGeneration, attempt])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="library__summary-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="library__summary-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={t('library.summaryTitle', { title: doc.title })}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="library__summary-head">
          {/* doc.title is user data — rendered as text, React escapes it. */}
          <strong>{t('library.summaryTitle', { title: doc.title })}</strong>
          <button
            type="button"
            className="library__summary-close"
            onClick={onClose}
            aria-label={t('library.closeEsc')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="library__summary-body">
          {state.kind === 'loading' && (
            <span className="library__summary-loading" role="status">
              {t('library.summarizing')}
            </span>
          )}
          {state.kind === 'error' && (
            <div className="library__summary-error" role="alert">
              <p>{state.message}</p>
              <button
                type="button"
                onClick={() => {
                  // Retry removes this button; leave focus on the persistent
                  // close control while the next summary is loading.
                  modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
                  setAttempt((value) => value + 1)
                }}
              >
                {t('common.retry')}
              </button>
            </div>
          )}
          {state.kind === 'ready' && <p className="library__summary-text">{state.text}</p>}
        </div>
      </div>
    </div>
  )
}

/** Map the `code: message` error from the IPC handler to a localized string. */
function localizeSummaryError(raw: string, t: TFn): string {
  const code = raw.split(':')[0]?.trim()
  if (code === 'model_not_ready') return t('library.summaryModelNotReady')
  if (code === 'no_content') return t('library.summaryNoContent')
  return t('library.summaryFailed', { message: raw })
}

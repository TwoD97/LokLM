import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useT } from '../i18n'

type Props = {
  /** How many documents are currently in the failed state. */
  count: number
  /** Re-index every failed document in one shot. */
  onRetryAll: () => void
}

/**
 * Bulk "retry failed" banner. Appears in the LibraryView only when ≥1 document
 * failed to index (the failed rows themselves stay visible in the table below
 * with their per-row Reindex, so this stays compact — just the count + a single
 * Retry-all). Re-indexing flips the docs back to pending/indexing, the list
 * refreshes on the index-progress events, and the banner clears itself.
 */
export function FailedDocsBanner({ count, onRetryAll }: Props): JSX.Element | null {
  const t = useT()
  if (count === 0) return null
  return (
    <div className="library__failed" role="status">
      <span className="library__failed-header">
        <AlertTriangle size={16} aria-hidden="true" />
        {count === 1 ? t('library.failedOne') : t('library.failedMany', { count })}
      </span>
      <button type="button" className="library__failed-retry" onClick={onRetryAll}>
        <RotateCcw size={14} aria-hidden="true" />
        {t('library.retryAllFailed', { count })}
      </button>
    </div>
  )
}

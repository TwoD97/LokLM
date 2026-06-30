import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Document, IndexProgress } from '@shared/documents'
import { DocumentRow } from './DocumentRow'
import { deriveRowStatus } from './documentStatus'
import { useT } from '../i18n'

type Props = {
  docs: Document[]
  // Stable identity of the underlying dataset (the workspace id). The pager
  // jumps back to page 1 when THIS changes — i.e. on a genuine workspace
  // switch — not on every `docs` array refresh. A background refresh (index
  // 'done', sync, delete) hands down a new array with the same contents; keying
  // the reset on the array reference would yank the user back to page 1.
  resetKey: number
  progress: Map<number, IndexProgress>
  /** Documents with chunks pending re-embedding — their rows read 're-embedding'. */
  reembedDocIds?: Set<number>
  /** Optionally-lifted page index (AppShell owns it so it survives a tab-switch
   *  unmount of the Library). Omitted → the table owns the page internally, the
   *  standalone / test default. The hide-ready toggle stays component-local. */
  page?: number | undefined
  onPageChange?: ((page: number) => void) | undefined
  onDelete: (id: number) => void
  onReindex: (id: number) => void
  onReveal: (id: number) => void
  onOpenExternal: (id: number) => void
  onReplace: (id: number) => void
  onRefresh: (id: number) => void
  onRead: (doc: Document) => void
  onExport: (doc: Document) => void
  onSummarize: (doc: Document) => void
  onTogglePin: (doc: Document) => void
}

// Fixed-size page-based pagination. An earlier infinite-scroll window (an
// IntersectionObserver that grew the visible count) kept every scrolled-past
// row mounted, so a library of a few thousand docs ended up with thousands of
// live `<tr>`s and got janky. Paging caps the DOM at PAGE_SIZE rows no matter
// how large the library is. For libraries that fit on one page (the common
// case) the pager hides and this renders as a plain table.
const PAGE_SIZE = 100

export function DocumentTable({
  docs,
  resetKey,
  progress,
  reembedDocIds,
  page: controlledPage,
  onPageChange,
  onDelete,
  onReindex,
  onReveal,
  onOpenExternal,
  onReplace,
  onRefresh,
  onRead,
  onExport,
  onSummarize,
  onTogglePin,
}: Props): JSX.Element {
  const t = useT()
  const [internalPage, setInternalPage] = useState(0)
  const page = controlledPage ?? internalPage
  // Stable setter (reads its targets from refs) so it can sit in effect deps
  // without churning. Writes to the lifted owner when controlled, else internal.
  const onPageChangeRef = useRef(onPageChange)
  onPageChangeRef.current = onPageChange
  const isControlledRef = useRef(controlledPage !== undefined)
  isControlledRef.current = controlledPage !== undefined
  const setPage = useCallback((next: number) => {
    onPageChangeRef.current?.(next)
    if (!isControlledRef.current) setInternalPage(next)
  }, [])

  // In-progress rows (indexing / queued / re-embedding) float to the TOP so a
  // big import's active rows land on page 1; 'ready' and 'failed' keep the
  // workspace's original order in the body. Recomputed as `progress` ticks,
  // which is exactly when the ordering needs to move. (Hiding/keeping by index
  // state is now the toolbar's Status filter, applied to `docs` upstream.)
  const orderedDocs = useMemo(() => {
    const topDocs: Document[] = []
    const restDocs: Document[] = []
    for (const d of docs) {
      const s = deriveRowStatus(d, progress.get(d.id), reembedDocIds?.has(d.id))
      // 'failed' isn't "in progress", so it stays in the body — it just doesn't
      // float up (the FailedDocsBanner already surfaces it for a bulk retry).
      if (s !== 'ready' && s !== 'failed') topDocs.push(d)
      else restDocs.push(d)
    }
    return [...topDocs, ...restDocs]
  }, [docs, progress, reembedDocIds])

  const pageCount = Math.max(1, Math.ceil(orderedDocs.length / PAGE_SIZE))

  // Jump back to page 1 when the dataset identity changes (workspace switch).
  // NOT on every `docs` reference change — refreshDocs() mints a fresh array on
  // each index-progress 'done'/sync/delete, and resetting on that would yank the
  // user off the page they're reading. The ref guard skips the initial mount so
  // a tab-switch remount restores the lifted page instead of snapping back to
  // page 1 (the reset only fires on a real change).
  const lastResetKey = useRef(resetKey)
  useEffect(() => {
    if (lastResetKey.current === resetKey) return
    lastResetKey.current = resetKey
    setPage(0)
  }, [resetKey, setPage])

  // Clamp if the list shrank under the current page (deletes, the filter, a
  // failed re-import) so the user is never stranded on an empty page past the end.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount, setPage])

  if (docs.length === 0) {
    return <div className="library__empty">{t('library.empty')}</div>
  }
  // Always slice from a clamped page so a render between the list shrinking and
  // the clamp effect firing can't show an empty page.
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * PAGE_SIZE
  const visibleDocs = orderedDocs.slice(start, start + PAGE_SIZE)
  return (
    <>
      <table className="library__table">
        <thead>
          <tr>
            <th>{t('library.colTitle')}</th>
            <th>{t('library.colStatus')}</th>
            <th>{t('library.colChunks')}</th>
            <th>{t('library.colAdded')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleDocs.map((d) => {
            const p = progress.get(d.id)
            return (
              <DocumentRow
                key={d.id}
                doc={d}
                {...(p !== undefined ? { progress: p } : {})}
                {...(reembedDocIds?.has(d.id) ? { reembedding: true } : {})}
                onDelete={onDelete}
                onReindex={onReindex}
                onReveal={onReveal}
                onOpenExternal={onOpenExternal}
                onReplace={onReplace}
                onRefresh={onRefresh}
                onRead={onRead}
                onExport={onExport}
                onSummarize={onSummarize}
                onTogglePin={onTogglePin}
              />
            )
          })}
        </tbody>
      </table>
      {pageCount > 1 && (
        <nav className="library__pagination" aria-label={t('library.paginationLabel')}>
          <button
            type="button"
            className="library__pagination-btn"
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
          >
            <ChevronLeft size={14} aria-hidden="true" />
            {t('library.paginationPrev')}
          </button>
          <span className="library__pagination-status" aria-live="polite">
            <span className="library__pagination-page">
              {t('library.paginationStatus', { page: safePage + 1, total: pageCount })}
            </span>
            <span className="library__pagination-range">
              {t('library.paginationRange', {
                from: start + 1,
                to: start + visibleDocs.length,
                count: orderedDocs.length,
              })}
            </span>
          </span>
          <button
            type="button"
            className="library__pagination-btn"
            onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            disabled={safePage === pageCount - 1}
          >
            {t('library.paginationNext')}
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </nav>
      )}
    </>
  )
}

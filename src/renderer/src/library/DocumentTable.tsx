import { useEffect, useRef, useState } from 'react'
import type { Document, IndexProgress } from '@shared/documents'
import { DocumentRow } from './DocumentRow'

type Props = {
  docs: Document[]
  progress: Map<number, IndexProgress>
  onDelete: (id: number) => void
  onReindex: (id: number) => void
  onReveal: (id: number) => void
  onOpenExternal: (id: number) => void
  onReplace: (id: number) => void
  onRefresh: (id: number) => void
  onRead: (doc: Document) => void
  onExport: (doc: Document) => void
}

// Cheap windowed render: start with INITIAL_BATCH rows, observe a sentinel
// `<tr>` at the bottom, and expand by BATCH_STEP each time it scrolls into
// view. For libraries under INITIAL_BATCH docs (the common case) this is
// behaviourally identical to a plain map. For thousands of docs it caps the
// initial DOM count + lets the browser idle the rest until scrolled into
// view. Plain `<tr>` (not a virtual-scroll lib) keeps the `<table>` layout
// honest — IntersectionObserver alone is enough; we don't need to know row
// heights.
const INITIAL_BATCH = 80
const BATCH_STEP = 80

export function DocumentTable({
  docs,
  progress,
  onDelete,
  onReindex,
  onReveal,
  onOpenExternal,
  onReplace,
  onRefresh,
  onRead,
  onExport,
}: Props): JSX.Element {
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH)
  const sentinelRef = useRef<HTMLTableRowElement | null>(null)

  // Reset when the doc set changes (workspace switch, search, etc.) so the
  // window doesn't carry over to a smaller list and render a stale tail.
  useEffect(() => {
    setVisibleCount(INITIAL_BATCH)
  }, [docs])

  useEffect(() => {
    if (visibleCount >= docs.length) return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((n) => Math.min(n + BATCH_STEP, docs.length))
        }
      },
      // Trigger ~one viewport early so the user never sees the loading gap.
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visibleCount, docs.length])

  if (docs.length === 0) {
    return (
      <div className="library__empty">Noch keine Dokumente. Dateien per Drag-Drop importieren.</div>
    )
  }
  const visibleDocs = visibleCount >= docs.length ? docs : docs.slice(0, visibleCount)
  const hiddenCount = docs.length - visibleDocs.length
  return (
    <table className="library__table">
      <thead>
        <tr>
          <th>Titel</th>
          <th>Status</th>
          <th>Chunks</th>
          <th>Hinzugefügt</th>
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
              onDelete={onDelete}
              onReindex={onReindex}
              onReveal={onReveal}
              onOpenExternal={onOpenExternal}
              onReplace={onReplace}
              onRefresh={onRefresh}
              onRead={onRead}
              onExport={onExport}
            />
          )
        })}
        {hiddenCount > 0 && (
          <tr ref={sentinelRef} className="library__row-sentinel" aria-hidden="true">
            <td colSpan={5} style={{ padding: '8px 0', opacity: 0.5, textAlign: 'center' }}>
              … {hiddenCount} weitere werden geladen
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

import { useEffect, useState } from 'react'
import type { ChunkWithContext } from '@shared/documents'

type Props = {
  chunkId: number
  documentTitle?: string | null
  onClose: () => void
}

export function SourceViewer({ chunkId, documentTitle, onClose }: Props): JSX.Element {
  const [chunks, setChunks] = useState<ChunkWithContext[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setChunks(null)
    setError(null)
    window.api.documents
      .getChunkWithContext(chunkId, 1, 1)
      .then((rows) => {
        if (!cancelled) setChunks(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [chunkId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const target = chunks?.find((c) => c.isTarget)
  const pageRange =
    target?.pageFrom != null
      ? target.pageTo != null && target.pageTo !== target.pageFrom
        ? `p. ${target.pageFrom}–${target.pageTo}`
        : `p. ${target.pageFrom}`
      : null

  return (
    <>
      <div className="source-viewer__backdrop" onClick={onClose} />
      <aside className="source-viewer" role="dialog" aria-label="Source viewer">
        <header className="source-viewer__header">
          <span className="source-viewer__title">
            {documentTitle ?? `Chunk #${chunkId}`}
            {pageRange ? ` · ${pageRange}` : ''}
          </span>
          <button
            className="source-viewer__close"
            onClick={onClose}
            aria-label="Close source viewer"
          >
            ×
          </button>
        </header>
        <div className="source-viewer__body">
          {error && <div className="source-viewer__error">{error}</div>}
          {!error && chunks === null && <div className="source-viewer__empty">Loading…</div>}
          {!error && chunks !== null && chunks.length === 0 && (
            <div className="source-viewer__empty">No surrounding context.</div>
          )}
          {!error &&
            chunks?.map((c) => (
              <div
                key={c.id}
                className={`source-viewer__chunk ${c.isTarget ? 'source-viewer__chunk--target' : ''}`}
              >
                <div className="source-viewer__chunk-meta">
                  ordinal {c.ordinal}
                  {c.pageFrom != null ? ` · p. ${c.pageFrom}` : ''}
                  {c.isTarget ? ' · cited' : ''}
                </div>
                {c.text}
              </div>
            ))}
        </div>
      </aside>
    </>
  )
}

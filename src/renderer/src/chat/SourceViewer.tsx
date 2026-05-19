import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChunkSource, ChunkWithContext } from '@shared/documents'
import { PdfPagePreview } from './PdfPagePreview'

type Props = {
  chunkId: number
  documentTitle?: string | null
  onClose: () => void
}

type BodyMode = 'pdf' | 'markdown' | 'text'

function pickBodyMode(source: ChunkSource | null): BodyMode {
  if (!source) return 'text'
  const path = source.sourcePath.toLowerCase()
  if (source.mimeType === 'application/pdf' || path.endsWith('.pdf')) return 'pdf'
  if (path.endsWith('.md') || path.endsWith('.markdown')) return 'markdown'
  return 'text'
}

export function SourceViewer({ chunkId, documentTitle, onClose }: Props): JSX.Element {
  const [chunks, setChunks] = useState<ChunkWithContext[] | null>(null)
  const [source, setSource] = useState<ChunkSource | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setChunks(null)
    setSource(null)
    setError(null)
    Promise.all([
      window.api.documents.getChunkWithContext(chunkId, 1, 1),
      window.api.documents.getSourceForChunk(chunkId),
    ])
      .then(([rows, src]) => {
        if (cancelled) return
        setChunks(rows)
        setSource(src)
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

  const target = chunks?.find((c) => c.isTarget) ?? null
  const pageRange =
    target?.pageFrom != null
      ? target.pageTo != null && target.pageTo !== target.pageFrom
        ? `p. ${target.pageFrom}–${target.pageTo}`
        : `p. ${target.pageFrom}`
      : null

  const bodyMode = useMemo(() => pickBodyMode(source), [source])
  const showPdf = bodyMode === 'pdf' && source != null && target?.pageFrom != null

  return (
    <>
      <div className="source-viewer__backdrop" onClick={onClose} />
      <aside
        className={`source-viewer ${showPdf ? 'source-viewer--with-page' : ''}`}
        role="dialog"
        aria-label="Source viewer"
      >
        <header className="source-viewer__header">
          <span className="source-viewer__title">
            {documentTitle ?? source?.title ?? `Chunk #${chunkId}`}
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

          {!error && showPdf && target?.pageFrom != null && source != null && (
            <section className="source-viewer__page" aria-label="Seitenvorschau">
              <PdfPagePreview documentId={source.documentId} pageNumber={target.pageFrom} />
            </section>
          )}

          {!error && chunks !== null && chunks.length === 0 && (
            <div className="source-viewer__empty">No surrounding context.</div>
          )}

          {!error && chunks !== null && chunks.length > 0 && (
            <section className="source-viewer__chunks" aria-label="Textauszug">
              {chunks.map((c) => (
                <ChunkBody key={c.id} chunk={c} mode={bodyMode} />
              ))}
            </section>
          )}
        </div>
      </aside>
    </>
  )
}

function ChunkBody({ chunk, mode }: { chunk: ChunkWithContext; mode: BodyMode }): JSX.Element {
  return (
    <div className={`source-viewer__chunk ${chunk.isTarget ? 'source-viewer__chunk--target' : ''}`}>
      <div className="source-viewer__chunk-meta">
        ordinal {chunk.ordinal}
        {chunk.pageFrom != null ? ` · p. ${chunk.pageFrom}` : ''}
        {chunk.isTarget ? ' · cited' : ''}
      </div>
      {mode === 'markdown' ? (
        <div className="source-viewer__chunk-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{chunk.text}</ReactMarkdown>
        </div>
      ) : (
        <pre className="source-viewer__chunk-pre">{chunk.text}</pre>
      )}
    </div>
  )
}

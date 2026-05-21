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

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function pickBodyMode(source: ChunkSource | null): BodyMode {
  if (!source) return 'text'
  const path = (source.sourcePath ?? '').toLowerCase()
  if (source.mimeType === 'application/pdf' || path.endsWith('.pdf')) return 'pdf'
  // .docx chunks are stored as markdown (mammoth-converted at parse time),
  // so they render through the existing markdown branch — same as .md.
  if (
    source.mimeType === DOCX_MIME ||
    path.endsWith('.docx') ||
    path.endsWith('.md') ||
    path.endsWith('.markdown')
  )
    return 'markdown'
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
  const headingCrumb =
    source?.headingPath && source.headingPath.length > 0
      ? `§ ${source.headingPath.join(' › ')}`
      : null
  // Combine when both exist (PDFs with bookmarks) — the breadcrumb gives the
  // user topical orientation, the page range tells them where to look in the
  // preview. Markdown has no page; PDFs without bookmarks have no breadcrumb.
  const locationLabel =
    headingCrumb && pageRange ? `${headingCrumb} · ${pageRange}` : (headingCrumb ?? pageRange)

  const bodyMode = useMemo(() => pickBodyMode(source), [source])
  const showPdf = bodyMode === 'pdf' && source != null && target?.pageFrom != null

  const variantClass =
    bodyMode === 'markdown'
      ? 'source-viewer--markdown'
      : showPdf
        ? 'source-viewer--with-page'
        : 'source-viewer--text'

  return (
    <aside
      className={`source-viewer ${variantClass}`}
      role="complementary"
      aria-label="Source viewer"
    >
      <header className="source-viewer__header">
        <span className="source-viewer__title">
          {documentTitle ?? source?.title ?? `Chunk #${chunkId}`}
          {locationLabel ? ` · ${locationLabel}` : ''}
        </span>
        <button
          type="button"
          className="chat__header-action"
          onClick={onClose}
          aria-label="Close source viewer"
          title="Close (Esc)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
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

        {!error && chunks !== null && chunks.length > 0 && bodyMode === 'markdown' && (
          <article className="source-viewer__doc" aria-label="Dokumentvorschau">
            {chunks.map((c) => (
              <section
                key={c.id}
                className={`source-viewer__doc-section ${c.isTarget ? 'source-viewer__doc-section--cited' : ''}`}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.text}</ReactMarkdown>
              </section>
            ))}
          </article>
        )}

        {!error && chunks !== null && chunks.length > 0 && bodyMode !== 'markdown' && !showPdf && (
          <section className="source-viewer__chunks" aria-label="Textauszug">
            {chunks.map((c) => (
              <ChunkBody key={c.id} chunk={c} />
            ))}
          </section>
        )}
      </div>
    </aside>
  )
}

function ChunkBody({ chunk }: { chunk: ChunkWithContext }): JSX.Element {
  return (
    <div className={`source-viewer__chunk ${chunk.isTarget ? 'source-viewer__chunk--target' : ''}`}>
      <div className="source-viewer__chunk-meta">
        ordinal {chunk.ordinal}
        {chunk.pageFrom != null ? ` · p. ${chunk.pageFrom}` : ''}
        {chunk.isTarget ? ' · cited' : ''}
      </div>
      <pre className="source-viewer__chunk-pre">{chunk.text}</pre>
    </div>
  )
}

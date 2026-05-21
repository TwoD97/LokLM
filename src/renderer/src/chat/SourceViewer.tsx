import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChunkSource, DocumentChunk } from '@shared/documents'
import { extractCitationSnippets } from '@shared/citationContext'
import { applyHighlights, findFuzzyHighlights } from '@shared/fuzzyHighlight'
import { MultiPagePdfPreview } from './MultiPagePdfPreview'

type Props = {
  chunkId: number
  documentTitle?: string | null
  /** Full text of the assistant message that owns the clicked citation. Used to
   *  extract the surrounding sentence(s) and fuzzy-highlight them inside the
   *  cited chunk. When null (e.g. opened from a context where the message text
   *  isn't available) , the modal still renders the document but skips
   *  highlighting. */
  messageText?: string | null
  onClose: () => void
}

type BodyMode = 'pdf' | 'text'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function pickBodyMode(source: ChunkSource | null): BodyMode {
  if (!source) return 'text'
  const path = (source.sourcePath ?? '').toLowerCase()
  if (source.mimeType === 'application/pdf' || path.endsWith('.pdf')) return 'pdf'
  return 'text'
}

function isMarkdownPath(source: ChunkSource | null): boolean {
  if (!source) return false
  const path = (source.sourcePath ?? '').toLowerCase()
  // .docx is mammoth-converted to markdown at parse time , render via the same branch.
  if (source.mimeType === DOCX_MIME || path.endsWith('.docx')) return true
  return path.endsWith('.md') || path.endsWith('.markdown')
}

export function SourceViewer({ chunkId, documentTitle, messageText, onClose }: Props): JSX.Element {
  const [chunks, setChunks] = useState<DocumentChunk[] | null>(null)
  const [source, setSource] = useState<ChunkSource | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 1) Resolve which document this chunk belongs to , then list ALL its chunks.
  // Two round trips because getSourceForChunk also returns the headingPath
  // for the cited chunk specifically — we need both pieces.
  useEffect(() => {
    let cancelled = false
    setChunks(null)
    setSource(null)
    setError(null)
    void (async () => {
      try {
        const src = await window.api.documents.getSourceForChunk(chunkId)
        if (cancelled) return
        setSource(src)
        if (!src) {
          setChunks([])
          return
        }
        const all = await window.api.documents.listChunksForDocument(src.documentId)
        if (cancelled) return
        setChunks(all)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
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

  const targetChunk = useMemo(
    () => chunks?.find((c) => c.id === chunkId) ?? null,
    [chunks, chunkId],
  )
  const snippets = useMemo(
    () =>
      messageText
        ? extractCitationSnippets(messageText, {
            documentId: targetChunk?.documentId ?? source?.documentId ?? -1,
            chunkId,
          })
        : [],
    [messageText, targetChunk?.documentId, source?.documentId, chunkId],
  )

  const pageRange =
    targetChunk?.pageFrom != null
      ? targetChunk.pageTo != null && targetChunk.pageTo !== targetChunk.pageFrom
        ? `p. ${targetChunk.pageFrom}–${targetChunk.pageTo}`
        : `p. ${targetChunk.pageFrom}`
      : null
  const headingCrumb =
    source?.headingPath && source.headingPath.length > 0
      ? `§ ${source.headingPath.join(' › ')}`
      : null
  const locationLabel =
    headingCrumb && pageRange ? `${headingCrumb} · ${pageRange}` : (headingCrumb ?? pageRange)

  const bodyMode = useMemo(() => pickBodyMode(source), [source])
  const showPdf = bodyMode === 'pdf' && source != null && targetChunk?.pageFrom != null
  const isMarkdownDoc = isMarkdownPath(source)

  return (
    <div
      className="source-viewer__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Source viewer"
      onMouseDown={(e) => {
        // Close on outside click only — clicks inside the modal shouldn't
        // bubble through, so guard with target === currentTarget.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <aside className={`source-viewer ${showPdf ? 'source-viewer--pdf' : 'source-viewer--text'}`}>
        <header className="source-viewer__header">
          <span className="source-viewer__title">
            {documentTitle ?? source?.title ?? `Chunk #${chunkId}`}
            {locationLabel ? ` · ${locationLabel}` : ''}
          </span>
          {snippets.length > 0 && (
            <span className="source-viewer__highlight-hint" title={snippets.join(' / ')}>
              {snippets.length === 1 ? '1 highlight' : `${snippets.length} highlights`}
            </span>
          )}
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

          {!error && showPdf && source != null && targetChunk?.pageFrom != null && (
            <MultiPagePdfPreview documentId={source.documentId} targetPage={targetChunk.pageFrom} />
          )}

          {!error && chunks !== null && chunks.length === 0 && !showPdf && (
            <div className="source-viewer__empty">No chunks available for this document.</div>
          )}

          {!error && !showPdf && chunks !== null && chunks.length > 0 && (
            <TextDocumentBody
              chunks={chunks}
              targetChunkId={chunkId}
              snippets={snippets}
              renderMarkdown={isMarkdownDoc}
            />
          )}
        </div>
      </aside>
    </div>
  )
}

function TextDocumentBody({
  chunks,
  targetChunkId,
  snippets,
  renderMarkdown,
}: {
  chunks: DocumentChunk[]
  targetChunkId: number
  snippets: string[]
  renderMarkdown: boolean
}): JSX.Element {
  const targetRef = useRef<HTMLElement | null>(null)

  // Scroll the cited chunk into view on first paint after chunks land. Use a
  // layout effect so we measure once the DOM is in place; useEffect would fire
  // a frame later and show a flash of unscrolled content first.
  useLayoutEffect(() => {
    const el = targetRef.current
    if (!el) return
    // `block: center` puts the cited chunk roughly in the middle of the modal
    // so the user can see what came before AND after without scrolling.
    el.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [targetChunkId, chunks])

  return (
    <article className="source-viewer__doc" aria-label="Document preview">
      {chunks.map((c) => {
        const isTarget = c.id === targetChunkId
        return (
          <section
            key={c.id}
            ref={isTarget ? (targetRef as React.RefObject<HTMLElement>) : undefined}
            className={`source-viewer__doc-section${isTarget ? ' source-viewer__doc-section--cited' : ''}`}
          >
            {isTarget ? (
              <HighlightedText text={c.text} snippets={snippets} />
            ) : renderMarkdown ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.text}</ReactMarkdown>
            ) : (
              <pre className="source-viewer__chunk-pre">{c.text}</pre>
            )}
          </section>
        )
      })}
    </article>
  )
}

function HighlightedText({ text, snippets }: { text: string; snippets: string[] }): JSX.Element {
  const segments = useMemo(() => {
    const ranges = findFuzzyHighlights(text, snippets)
    return applyHighlights(text, ranges)
  }, [text, snippets])
  // Preserve newlines from the source — chunks are extracted at paragraph
  // boundaries; without pre-wrap they'd collapse into one long line.
  return (
    <p className="source-viewer__cited-text">
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <mark key={i} className="source-viewer__mark">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  )
}

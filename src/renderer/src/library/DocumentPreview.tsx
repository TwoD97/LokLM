import { useEffect, useState } from 'react'
import { MarkdownView } from '../markdown/MarkdownView'
import type { Document, DocumentChunk } from '@shared/documents'
import { MultiPagePdfPreview } from '../chat/MultiPagePdfPreview'
import { useT } from '../i18n'

type Props = {
  doc: Document
  onClose: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'
type BodyMode = 'pdf' | 'markdown' | 'text'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function classifyDoc(doc: Document): BodyMode {
  const path = (doc.sourcePath ?? '').toLowerCase()
  if (doc.mimeType === 'application/pdf' || path.endsWith('.pdf')) return 'pdf'
  if (doc.mimeType === DOCX_MIME || path.endsWith('.docx')) return 'markdown'
  if (path.endsWith('.md') || path.endsWith('.markdown')) return 'markdown'
  return 'text'
}

/** Library-side document reader. Reuses the same `.source-viewer__*` chrome
 *  the chat citation modal uses (defined in chat.css) but skips the
 *  fuzzy-highlight machinery — the library has no message context to
 *  ground a citation in. PDF goes straight to MultiPagePdfPreview at page 1 ;
 *  non-PDFs load the chunk list and render the doc in reading order. */
export function DocumentPreview({ doc, onClose }: Props): JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [chunks, setChunks] = useState<DocumentChunk[]>([])
  const bodyMode = classifyDoc(doc)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setErrorMessage(null)
    setChunks([])
    if (bodyMode === 'pdf') {
      // MultiPagePdfPreview owns its own load lifecycle ; nothing to fetch here.
      setStatus('ready')
      return
    }
    void (async () => {
      try {
        const all = await window.api.documents.listChunksForDocument(doc.id)
        if (cancelled) return
        setChunks(all)
        setStatus('ready')
      } catch (err: unknown) {
        if (cancelled) return
        setErrorMessage(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc.id, bodyMode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const showPdf = bodyMode === 'pdf'
  const renderMarkdown = bodyMode === 'markdown'

  return (
    <div
      className="source-viewer__backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <aside
        className={`source-viewer ${showPdf ? 'source-viewer--pdf' : 'source-viewer--text'}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('library.previewAria', { title: doc.title })}
      >
        <header className="source-viewer__header">
          <span className="source-viewer__title">{doc.title}</span>
          <button
            type="button"
            className="chat__header-action"
            onClick={onClose}
            aria-label={t('library.closePreview')}
            title={t('library.closeEsc')}
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
          {status === 'error' && errorMessage && (
            <div className="source-viewer__error">{errorMessage}</div>
          )}
          {status === 'loading' && (
            <div className="source-viewer__empty">{t('library.loading')}</div>
          )}
          {status === 'ready' && showPdf && (
            <MultiPagePdfPreview documentId={doc.id} targetPage={1} />
          )}
          {status === 'ready' && !showPdf && chunks.length === 0 && (
            <div className="source-viewer__empty">{t('library.noChunks')}</div>
          )}
          {status === 'ready' && !showPdf && chunks.length > 0 && (
            <article className="source-viewer__doc" aria-label={t('library.previewDoc')}>
              {chunks.map((c) => (
                <section key={c.id} className="source-viewer__doc-section">
                  {c.language && c.language !== 'other' && (
                    <span
                      className="library__lang-badge"
                      title={t('library.chunkLanguageTitle', {
                        language:
                          c.language === 'de' ? t('library.langGerman') : t('library.langEnglish'),
                      })}
                    >
                      {c.language}
                    </span>
                  )}
                  {renderMarkdown ? (
                    <MarkdownView>{c.text}</MarkdownView>
                  ) : (
                    <pre className="source-viewer__chunk-pre">{c.text}</pre>
                  )}
                </section>
              ))}
            </article>
          )}
        </div>
      </aside>
    </div>
  )
}

import { memo, useEffect, useRef, useState } from 'react'
import {
  MoreHorizontal,
  FolderOpen,
  ExternalLink,
  RefreshCw,
  Replace,
  RotateCcw,
  Trash2,
  AlertTriangle,
  BookOpen,
  Download,
} from 'lucide-react'
import type { Document, IndexProgress } from '@shared/documents'

type Props = {
  doc: Document
  progress?: IndexProgress
  onDelete: (id: number) => void
  onReindex: (id: number) => void
  onReveal: (id: number) => void
  onOpenExternal: (id: number) => void
  onReplace: (id: number) => void
  onRefresh: (id: number) => void
  onRead: (doc: Document) => void
  onExport: (doc: Document) => void
}

function DocumentRowImpl({
  doc,
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
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click — the original ⋯-menu would persist across rows
  // if the user clicked into another, which felt buggy now that the menu has
  // six items instead of two.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const status =
    progress?.phase === 'failed' || doc.status === 'failed'
      ? 'failed'
      : progress && progress.phase !== 'done'
        ? 'indexing'
        : doc.status
  const isMissing = doc.missingAt != null

  return (
    <tr className={isMissing ? 'library__row--missing' : ''} onDoubleClick={() => onRead(doc)}>
      <td>
        <span className="library__row-title">
          {isMissing && (
            <AlertTriangle
              size={14}
              aria-label="Quelldatei fehlt"
              className="library__row-missing-icon"
            />
          )}
          {doc.title}
          {doc.language && <LanguageBadge language={doc.language} />}
        </span>
      </td>
      <td>
        <span className={`library__status library__status--${status}`}>{status}</span>
        {progress && progress.phase !== 'done' && progress.phase !== 'failed' && (
          <span style={{ marginLeft: 8, opacity: 0.7 }}>
            {progress.phase} {progress.step}/{progress.total}
          </span>
        )}
      </td>
      <td>{doc.chunkCount}</td>
      <td>{new Date(doc.addedAt * 1000).toLocaleString()}</td>
      <td style={{ width: 40, position: 'relative' }}>
        <button
          className="library__row-menu-btn"
          onClick={() => setMenu((v) => !v)}
          aria-label="actions"
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
        {menu && (
          <div ref={menuRef} className="library__row-menu">
            <button
              onClick={() => {
                setMenu(false)
                onRead(doc)
              }}
            >
              <BookOpen size={14} aria-hidden="true" />
              Lesen
            </button>
            <button
              onClick={() => {
                setMenu(false)
                onExport(doc)
              }}
            >
              <Download size={14} aria-hidden="true" />
              Exportieren…
            </button>
            <button
              onClick={() => {
                setMenu(false)
                onReveal(doc.id)
              }}
            >
              <FolderOpen size={14} aria-hidden="true" />
              Im Ordner zeigen
            </button>
            <button
              onClick={() => {
                setMenu(false)
                onOpenExternal(doc.id)
              }}
            >
              <ExternalLink size={14} aria-hidden="true" />
              Extern öffnen
            </button>
            <button
              onClick={() => {
                setMenu(false)
                onRefresh(doc.id)
              }}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Aktualisieren
            </button>
            <button
              onClick={() => {
                setMenu(false)
                onReplace(doc.id)
              }}
            >
              <Replace size={14} aria-hidden="true" />
              Datei ersetzen…
            </button>
            <button
              onClick={() => {
                setMenu(false)
                onReindex(doc.id)
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Reindex
            </button>
            <button
              className="library__row-menu-danger"
              onClick={() => {
                setMenu(false)
                onDelete(doc.id)
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              Löschen
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

function LanguageBadge({ language }: { language: 'de' | 'en' | 'mixed' }): JSX.Element {
  const label = language === 'mixed' ? 'de+en' : language
  const className =
    language === 'mixed' ? 'library__lang-badge library__lang-badge--mixed' : 'library__lang-badge'
  return (
    <span
      className={className}
      title={
        language === 'mixed'
          ? 'Dokument enthält Chunks in beiden Sprachen'
          : `Dokumentsprache: ${language === 'de' ? 'Deutsch' : 'Englisch'}`
      }
    >
      {label}
    </span>
  )
}

// memoised so rows whose (doc, progress) didn't change skip re-render when
// the parent's progress map updates a different row , under indexing
// storms the whole table used to redraw every tick.
export const DocumentRow = memo(DocumentRowImpl)

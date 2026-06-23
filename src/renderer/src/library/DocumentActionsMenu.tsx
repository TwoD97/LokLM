import { useEffect, useRef, useState } from 'react'
import {
  MoreHorizontal,
  FolderOpen,
  ExternalLink,
  RefreshCw,
  Replace,
  RotateCcw,
  Trash2,
  BookOpen,
  Download,
  FileText,
  Pin,
  PinOff,
} from 'lucide-react'
import type { Document } from '@shared/documents'
import { useT } from '../i18n'

/** The full set of per-document row actions. Shared by the flat table row
 *  (DocumentRow) and the folder-tree leaf (DocumentTree) so the ⋯ menu has a
 *  single definition. */
export type DocumentActions = {
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

type Props = { doc: Document } & DocumentActions

/** The ⋯ overflow button and its dropdown. Self-contained: owns its open/close
 *  state and outside-click dismissal. The dropdown is absolutely positioned
 *  against this wrapper (`.library__actions`), so callers don't need to provide
 *  a positioned ancestor. */
export function DocumentActionsMenu({
  doc,
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
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click — without this the menu would persist when the user
  // clicks into another row.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  return (
    <div className="library__actions" ref={menuRef}>
      <button
        className="library__row-menu-btn"
        onClick={() => setMenu((v) => !v)}
        aria-label={t('library.actions')}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {menu && (
        <div className="library__row-menu">
          <button
            onClick={() => {
              setMenu(false)
              onRead(doc)
            }}
          >
            <BookOpen size={14} aria-hidden="true" />
            {t('library.read')}
          </button>
          <button
            onClick={() => {
              setMenu(false)
              onSummarize(doc)
            }}
          >
            <FileText size={14} aria-hidden="true" />
            {t('library.summarize')}
          </button>
          <button
            onClick={() => {
              setMenu(false)
              onTogglePin(doc)
            }}
          >
            {doc.pinned ? (
              <>
                <PinOff size={14} aria-hidden="true" />
                {t('library.unpin')}
              </>
            ) : (
              <>
                <Pin size={14} aria-hidden="true" />
                {t('library.pin')}
              </>
            )}
          </button>
          <button
            onClick={() => {
              setMenu(false)
              onExport(doc)
            }}
          >
            <Download size={14} aria-hidden="true" />
            {t('library.export')}
          </button>
          <button
            onClick={() => {
              setMenu(false)
              onReveal(doc.id)
            }}
          >
            <FolderOpen size={14} aria-hidden="true" />
            {t('library.revealInFolder')}
          </button>
          <button
            onClick={() => {
              setMenu(false)
              onOpenExternal(doc.id)
            }}
          >
            <ExternalLink size={14} aria-hidden="true" />
            {t('library.openExternal')}
          </button>
          <button
            onClick={() => {
              setMenu(false)
              onRefresh(doc.id)
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t('library.refresh')}
          </button>
          <button
            onClick={() => {
              setMenu(false)
              onReplace(doc.id)
            }}
          >
            <Replace size={14} aria-hidden="true" />
            {t('library.replaceFile')}
          </button>
          <button
            onClick={() => {
              setMenu(false)
              onReindex(doc.id)
            }}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {t('library.reindex')}
          </button>
          <button
            className="library__row-menu-danger"
            onClick={() => {
              setMenu(false)
              onDelete(doc.id)
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

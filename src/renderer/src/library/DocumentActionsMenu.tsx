import { useEffect, useId, useRef, useState } from 'react'
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
import { isGeneratedDocumentSource } from '@shared/documentSource'
import { useT } from '../i18n'
import { ConfirmModal } from '../chat/ConfirmModal'

/** The full set of per-document row actions. Shared by the flat table row
 *  (DocumentRow) and the folder-tree leaf (DocumentTree) so the ⋯ menu has a
 *  single definition. */
export type DocumentActions = {
  onDelete: (id: number) => void | Promise<void>
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
  const hasOriginalFile = !isGeneratedDocumentSource(doc.sourcePath)
  const [menu, setMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const lastOnOpen = useRef(false)
  const deletePending = useRef(false)
  const menuId = useId()

  // Close on outside click — without this the menu would persist when the user
  // clicks into another row.
  useEffect(() => {
    if (!menu) return
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    buttons?.[lastOnOpen.current ? buttons.length - 1 : 0]?.focus()
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  function closeMenu(): void {
    setMenu(false)
    triggerRef.current?.focus()
  }

  return (
    <div className="library__actions" ref={menuRef}>
      <button
        type="button"
        ref={triggerRef}
        className="library__row-menu-btn"
        disabled={deleting}
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-controls={menu ? menuId : undefined}
        onClick={() => {
          lastOnOpen.current = false
          setMenu((v) => !v)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          lastOnOpen.current = event.key === 'ArrowUp'
          setMenu(true)
        }}
        aria-label={t('library.actions')}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {menu && (
        <div
          className="library__row-menu"
          id={menuId}
          role="menu"
          aria-label={doc.title}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
              }
              closeMenu()
              return
            }
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
            )
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
            const next =
              event.key === 'ArrowDown'
                ? (current + 1) % buttons.length
                : event.key === 'ArrowUp'
                  ? (current + buttons.length - 1) % buttons.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : null
            if (next !== null) {
              event.preventDefault()
              buttons[next]?.focus()
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              closeMenu()
              onRead(doc)
            }}
          >
            <BookOpen size={14} aria-hidden="true" />
            {t('library.read')}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              closeMenu()
              onSummarize(doc)
            }}
          >
            <FileText size={14} aria-hidden="true" />
            {t('library.summarize')}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              closeMenu()
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
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              closeMenu()
              onExport(doc)
            }}
          >
            <Download size={14} aria-hidden="true" />
            {t('library.export')}
          </button>
          {hasOriginalFile && (
            <>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  closeMenu()
                  onReveal(doc.id)
                }}
              >
                <FolderOpen size={14} aria-hidden="true" />
                {t('library.revealInFolder')}
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  closeMenu()
                  onOpenExternal(doc.id)
                }}
              >
                <ExternalLink size={14} aria-hidden="true" />
                {t('library.openExternal')}
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  closeMenu()
                  onRefresh(doc.id)
                }}
              >
                <RefreshCw size={14} aria-hidden="true" />
                {t('library.refresh')}
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              closeMenu()
              onReplace(doc.id)
            }}
          >
            <Replace size={14} aria-hidden="true" />
            {t('library.replaceFile')}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              closeMenu()
              onReindex(doc.id)
            }}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {t('library.reindex')}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="library__row-menu-danger"
            onClick={() => {
              closeMenu()
              setConfirmDelete(true)
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            {t('common.delete')}
          </button>
        </div>
      )}
      {deleteError && <p role="alert">{deleteError}</p>}
      {confirmDelete && (
        <ConfirmModal
          title={t('library.deleteTitle')}
          body={t('library.deleteBody', { title: doc.title })}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            if (deletePending.current) return
            deletePending.current = true
            setConfirmDelete(false)
            setDeleting(true)
            setDeleteError(null)
            void Promise.resolve()
              .then(() => onDelete(doc.id))
              .catch((error: unknown) => {
                setDeleteError(t('library.deleteFailed', { message: String(error) }))
              })
              .finally(() => {
                deletePending.current = false
                setDeleting(false)
              })
          }}
        />
      )}
    </div>
  )
}

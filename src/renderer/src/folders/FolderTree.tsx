import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react'
import type { Document } from '@shared/documents'
import { useT, type TFn } from '../i18n'
import type { FolderNode, FolderTreeNode } from './folderTreeModel'
import './folders.css'

/** Tri-state of a folder relative to the chat scope (sidebar only). */
export type FolderScopeState = 'none' | 'partial' | 'all'

type Props = {
  nodes: FolderTreeNode[]
  expanded: ReadonlySet<string>
  onToggleExpand: (key: string) => void
  onCreateFolder: (name: string, parentId: number | null) => void
  onRenameFolder: (id: number, name: string) => void
  onDeleteFolder: (id: number) => void
  onMoveDocument: (documentId: number, folderId: number | null) => void
  /** Renders the body of a file row (after indentation + drag wrapper). Lets the
   *  sidebar show a scope-toggle button and the library a full actions row. */
  renderFile: (doc: Document, depth: number) => ReactNode
  /** Optional chat-scope integration (sidebar): folder tri-state + toggle. */
  folderScopeState?: (folderId: number) => FolderScopeState
  onToggleFolderScope?: (folderId: number) => void
  /** Label for the top-level "new folder" button; omit to hide it. */
  newFolderLabel?: string
  /** Compact density for the narrow chat sidebar: drops the per-folder file
   *  count and folds the row's inline actions into a single ⋮ kebab menu (also
   *  reachable via right-click), so the folder name stays readable. The Library
   *  (wide) leaves this off and keeps the inline actions + count. */
  compact?: boolean
}

const INDENT = 14
const PAD = 6
// Horizontal centre of a chevron at indent level 0, so a guide line sits under
// the ancestor chevrons (chevron is 14px wide, starting at PAD + level*INDENT).
const GUIDE_CENTER = 7

/** VS-Code-style indentation guides for compact (sidebar) rows: one thin
 *  vertical line per ancestor level, absolutely positioned so it never disturbs
 *  the row's flex layout. The row must be `position: relative`. */
function IndentGuides({ depth }: { depth: number }): JSX.Element | null {
  if (depth <= 0) return null
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          className="folder-tree__guide"
          aria-hidden="true"
          style={{ left: PAD + i * INDENT + GUIDE_CENTER }}
        />
      ))}
    </>
  )
}

type Ctx = {
  expanded: ReadonlySet<string>
  toggleExpand: (key: string) => void
  beginCreate: (parentId: number | null) => void
  creatingParent: number | null | undefined
  creatingDraft: string
  setCreatingDraft: (s: string) => void
  commitCreate: () => void
  cancelCreate: () => void
  renamingId: number | null
  renameDraft: string
  setRenameDraft: (s: string) => void
  beginRename: (id: number, current: string) => void
  commitRename: () => void
  cancelRename: () => void
  requestDelete: (node: FolderNode) => void
  draggingDocIdRef: { current: number | null }
  setDraggingDocId: (id: number | null) => void
  dropFolderId: number | null
  setDropFolderId: (id: number | null) => void
  onMoveDocument: (documentId: number, folderId: number | null) => void
  renderFile: (doc: Document, depth: number) => ReactNode
  folderScopeState?: (folderId: number) => FolderScopeState
  onToggleFolderScope?: (folderId: number) => void
  compact: boolean
  t: TFn
}

export function FolderTree(props: Props): JSX.Element {
  const t = useT()
  const [creatingParent, setCreatingParent] = useState<number | null | undefined>(undefined)
  const [creatingDraft, setCreatingDraft] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  // The dragged document id lives in a ref, not state: onDragOver must read it
  // synchronously to decide whether to preventDefault (= become a valid drop
  // target). A state read can lag a render behind the native dragstart, so some
  // rows wouldn't accept the drop and the file appeared "stuck". A ref is always
  // current, so every folder row is a drop target the instant a drag begins.
  const draggingDocIdRef = useRef<number | null>(null)
  const setDraggingDocId = (id: number | null): void => {
    draggingDocIdRef.current = id
  }
  const [dropFolderId, setDropFolderId] = useState<number | null>(null)
  // Distinct highlight for "drop onto the empty root area = unfile".
  const [dropRoot, setDropRoot] = useState(false)

  const beginCreate = (parentId: number | null): void => {
    setCreatingParent(parentId)
    setCreatingDraft('')
    // Expand the parent so the inline input is visible under it.
    if (parentId != null && !props.expanded.has(`folder:${parentId}`)) {
      props.onToggleExpand(`folder:${parentId}`)
    }
  }
  const commitCreate = (): void => {
    const name = creatingDraft.trim()
    const parent = creatingParent
    setCreatingParent(undefined)
    setCreatingDraft('')
    if (name.length > 0 && parent !== undefined) props.onCreateFolder(name, parent)
  }
  const cancelCreate = (): void => {
    setCreatingParent(undefined)
    setCreatingDraft('')
  }

  const beginRename = (id: number, current: string): void => {
    setRenamingId(id)
    setRenameDraft(current)
  }
  const commitRename = (): void => {
    const id = renamingId
    const name = renameDraft.trim()
    setRenamingId(null)
    if (id != null && name.length > 0) props.onRenameFolder(id, name)
  }
  const cancelRename = (): void => setRenamingId(null)

  const requestDelete = (node: FolderNode): void => {
    const hasContent = node.fileCount > 0 || node.children.some((c) => c.kind === 'folder')
    if (hasContent && !window.confirm(t('folders.deleteConfirm', { name: node.name }))) return
    props.onDeleteFolder(node.folderId)
  }

  const ctx: Ctx = {
    expanded: props.expanded,
    toggleExpand: props.onToggleExpand,
    beginCreate,
    creatingParent,
    creatingDraft,
    setCreatingDraft,
    commitCreate,
    cancelCreate,
    renamingId,
    renameDraft,
    setRenameDraft,
    beginRename,
    commitRename,
    cancelRename,
    requestDelete,
    draggingDocIdRef,
    setDraggingDocId,
    dropFolderId,
    setDropFolderId,
    onMoveDocument: props.onMoveDocument,
    renderFile: props.renderFile,
    ...(props.folderScopeState ? { folderScopeState: props.folderScopeState } : {}),
    ...(props.onToggleFolderScope ? { onToggleFolderScope: props.onToggleFolderScope } : {}),
    compact: props.compact ?? false,
    t,
  }

  return (
    <div
      className={`folder-tree${props.compact ? ' folder-tree--compact' : ''}${dropRoot ? ' folder-tree--drop-root' : ''}`}
      onDragOver={(e) => {
        if (draggingDocIdRef.current != null) {
          e.preventDefault()
          setDropRoot(true)
        }
      }}
      onDragLeave={() => setDropRoot(false)}
      onDrop={(e) => {
        e.preventDefault()
        const docId = draggingDocIdRef.current
        if (docId != null) props.onMoveDocument(docId, null)
        setDraggingDocId(null)
        setDropFolderId(null)
        setDropRoot(false)
      }}
    >
      {props.newFolderLabel && (
        <button
          type="button"
          className="folder-tree__new"
          onClick={() => beginCreate(null)}
          title={props.newFolderLabel}
        >
          <FolderPlus size={14} aria-hidden="true" />
          {props.newFolderLabel}
        </button>
      )}
      {creatingParent === null && <FolderNameInput ctx={ctx} depth={0} />}
      {props.compact ? (
        // A content track sized to its widest row (min-width: max-content) so
        // every row shares that width — the hover/selection background spans the
        // full scrolled width, and the parent (.folder-tree--compact) scrolls
        // horizontally for long names / deep nesting instead of truncating.
        <div className="folder-tree__rows">
          {props.nodes.map((node) => (
            <TreeRow key={node.key} node={node} depth={0} ctx={ctx} />
          ))}
        </div>
      ) : (
        props.nodes.map((node) => <TreeRow key={node.key} node={node} depth={0} ctx={ctx} />)
      )}
    </div>
  )
}

function TreeRow({
  node,
  depth,
  ctx,
}: {
  node: FolderTreeNode
  depth: number
  ctx: Ctx
}): JSX.Element {
  // Kebab / right-click menu anchor for compact rows (sidebar). `align` decides
  // which edge of the menu pins to `x`: 'right' for the kebab (so it opens
  // leftward and never spills past the panel), 'left' for the cursor on
  // right-click. Unused on file rows, but the hook stays unconditional — a
  // node's kind is stable for the life of its row, so order never shifts.
  const [menu, setMenu] = useState<{ x: number; y: number; align: 'left' | 'right' } | null>(null)

  if (node.kind === 'file') {
    return (
      <div
        className="folder-tree__file"
        // Files indent one level past their folder (depth + 1 step) so the file
        // sits under the folder NAME, not its icon — the expected nested look.
        style={{ paddingLeft: depth * INDENT + PAD + INDENT }}
        draggable
        onDragStart={(e) => {
          ctx.setDraggingDocId(node.doc.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', String(node.doc.id))
        }}
        onDragEnd={() => {
          ctx.setDraggingDocId(null)
          ctx.setDropFolderId(null)
        }}
      >
        {ctx.compact && <IndentGuides depth={depth} />}
        {ctx.renderFile(node.doc, depth)}
      </div>
    )
  }

  const open = ctx.expanded.has(node.key)
  const isDropTarget = ctx.dropFolderId === node.folderId
  const scope = ctx.folderScopeState?.(node.folderId)

  return (
    <>
      <div
        className={`folder-tree__folder${isDropTarget ? ' folder-tree__folder--drop' : ''}`}
        style={{ paddingLeft: depth * INDENT + PAD }}
        role="treeitem"
        aria-expanded={open}
        onClick={() => ctx.toggleExpand(node.key)}
        onContextMenu={
          ctx.compact
            ? (e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, align: 'left' })
              }
            : undefined
        }
        onDragOver={(e) => {
          if (ctx.draggingDocIdRef.current != null) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            ctx.setDropFolderId(node.folderId)
          }
        }}
        onDragLeave={() => {
          if (ctx.dropFolderId === node.folderId) ctx.setDropFolderId(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const docId = ctx.draggingDocIdRef.current
          if (docId != null) ctx.onMoveDocument(docId, node.folderId)
          ctx.setDraggingDocId(null)
          ctx.setDropFolderId(null)
        }}
      >
        {ctx.compact && <IndentGuides depth={depth} />}
        {/* Compact rows drop the chevron — the whole row toggles on click and
            the open/closed folder icon shows the state, so the separate twisty
            is redundant. The wide library keeps it. */}
        {!ctx.compact &&
          (open ? (
            <ChevronDown size={14} aria-hidden="true" className="folder-tree__chevron" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" className="folder-tree__chevron" />
          ))}
        {ctx.onToggleFolderScope && (
          <input
            type="checkbox"
            className="folder-tree__scope"
            checked={scope === 'all'}
            ref={(el) => {
              if (el) el.indeterminate = scope === 'partial'
            }}
            onClick={(e) => e.stopPropagation()}
            onChange={() => ctx.onToggleFolderScope?.(node.folderId)}
            aria-label={ctx.t('folders.scopeFolder')}
            title={ctx.t('folders.scopeFolder')}
          />
        )}
        {open ? (
          <FolderOpen size={15} aria-hidden="true" className="folder-tree__foldericon" />
        ) : (
          <Folder size={15} aria-hidden="true" className="folder-tree__foldericon" />
        )}
        {ctx.renamingId === node.folderId ? (
          <FolderNameInput ctx={ctx} depth={depth} rename />
        ) : (
          <span className="folder-tree__name" title={node.name}>
            {node.name}
          </span>
        )}
        {/* Compact (sidebar) rows have no inline actions — folder actions are
            reached by right-click (onContextMenu above), keeping the row clean
            and the name fully readable. The wide library keeps the count +
            hover action buttons. */}
        {!ctx.compact && (
          <>
            <span className="folder-tree__count">{node.fileCount}</span>
            <span className="folder-tree__actions">
              <button
                type="button"
                className="folder-tree__action"
                onClick={(e) => {
                  e.stopPropagation()
                  ctx.beginCreate(node.folderId)
                }}
                aria-label={ctx.t('folders.newSubfolder')}
                title={ctx.t('folders.newSubfolder')}
              >
                <FolderPlus size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="folder-tree__action"
                onClick={(e) => {
                  e.stopPropagation()
                  ctx.beginRename(node.folderId, node.name)
                }}
                aria-label={ctx.t('folders.rename')}
                title={ctx.t('folders.rename')}
              >
                <Pencil size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="folder-tree__action folder-tree__action--danger"
                onClick={(e) => {
                  e.stopPropagation()
                  ctx.requestDelete(node)
                }}
                aria-label={ctx.t('folders.delete')}
                title={ctx.t('folders.delete')}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </span>
          </>
        )}
      </div>
      {menu && (
        <FolderMenu
          x={menu.x}
          y={menu.y}
          align={menu.align}
          onClose={() => setMenu(null)}
          onNewSubfolder={() => {
            setMenu(null)
            ctx.beginCreate(node.folderId)
          }}
          onRename={() => {
            setMenu(null)
            ctx.beginRename(node.folderId, node.name)
          }}
          onDelete={() => {
            setMenu(null)
            ctx.requestDelete(node)
          }}
          t={ctx.t}
        />
      )}
      {open && (
        <>
          {ctx.creatingParent === node.folderId && <FolderNameInput ctx={ctx} depth={depth + 1} />}
          {node.children.map((child) => (
            <TreeRow key={child.key} node={child} depth={depth + 1} ctx={ctx} />
          ))}
        </>
      )}
    </>
  )
}

/** Inline text input for creating or renaming a folder. Enter commits, Escape
 *  cancels, blur commits (matching the workspace-rename inputs in the Sidebar). */
function FolderNameInput({
  ctx,
  depth,
  rename = false,
}: {
  ctx: Ctx
  depth: number
  rename?: boolean
}): JSX.Element {
  const value = rename ? ctx.renameDraft : ctx.creatingDraft
  const setValue = rename ? ctx.setRenameDraft : ctx.setCreatingDraft
  const commit = rename ? ctx.commitRename : ctx.commitCreate
  const cancel = rename ? ctx.cancelRename : ctx.cancelCreate
  return (
    <input
      className="folder-tree__input"
      style={rename ? undefined : { marginLeft: depth * INDENT + PAD }}
      value={value}
      autoFocus
      placeholder={ctx.t('folders.namePlaceholder')}
      aria-label={ctx.t('folders.namePlaceholder')}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
    />
  )
}

const MENU_WIDTH = 184

/** Per-folder actions popover (compact rows). Portalled to <body> and
 *  position:fixed so the narrow, overflow-clipped sidebar can't crop it.
 *  Dismisses on outside press, Escape, or any scroll (a fixed menu would
 *  otherwise detach from its row). */
function FolderMenu({
  x,
  y,
  align,
  onClose,
  onNewSubfolder,
  onRename,
  onDelete,
  t,
}: {
  x: number
  y: number
  align: 'left' | 'right'
  onClose: () => void
  onNewSubfolder: () => void
  onRename: () => void
  onDelete: () => void
  t: TFn
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    // Capture-phase so a scroll inside the sidebar (not just window) closes it.
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const rawLeft = align === 'right' ? x - MENU_WIDTH : x
  const left = Math.max(8, Math.min(rawLeft, window.innerWidth - MENU_WIDTH - 8))
  // Rough height clamp so a row near the viewport bottom flips the menu up.
  const top = Math.min(y + 4, window.innerHeight - 132)

  return createPortal(
    <div
      ref={ref}
      className="folder-menu"
      style={{ left, top, width: MENU_WIDTH }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" role="menuitem" className="folder-menu__item" onClick={onNewSubfolder}>
        <FolderPlus size={14} aria-hidden="true" />
        {t('folders.newSubfolder')}
      </button>
      <button type="button" role="menuitem" className="folder-menu__item" onClick={onRename}>
        <Pencil size={14} aria-hidden="true" />
        {t('folders.rename')}
      </button>
      <button
        type="button"
        role="menuitem"
        className="folder-menu__item folder-menu__item--danger"
        onClick={onDelete}
      >
        <Trash2 size={14} aria-hidden="true" />
        {t('folders.delete')}
      </button>
    </div>,
    document.body,
  )
}

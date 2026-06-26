import { useState, type ReactNode } from 'react'
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
}

const INDENT = 14
const PAD = 6

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
  draggingDocId: number | null
  setDraggingDocId: (id: number | null) => void
  dropFolderId: number | null
  setDropFolderId: (id: number | null) => void
  onMoveDocument: (documentId: number, folderId: number | null) => void
  renderFile: (doc: Document, depth: number) => ReactNode
  folderScopeState?: (folderId: number) => FolderScopeState
  onToggleFolderScope?: (folderId: number) => void
  t: TFn
}

export function FolderTree(props: Props): JSX.Element {
  const t = useT()
  const [creatingParent, setCreatingParent] = useState<number | null | undefined>(undefined)
  const [creatingDraft, setCreatingDraft] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [draggingDocId, setDraggingDocId] = useState<number | null>(null)
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
    draggingDocId,
    setDraggingDocId,
    dropFolderId,
    setDropFolderId,
    onMoveDocument: props.onMoveDocument,
    renderFile: props.renderFile,
    ...(props.folderScopeState ? { folderScopeState: props.folderScopeState } : {}),
    ...(props.onToggleFolderScope ? { onToggleFolderScope: props.onToggleFolderScope } : {}),
    t,
  }

  return (
    <div
      className={`folder-tree${dropRoot ? ' folder-tree--drop-root' : ''}`}
      onDragOver={(e) => {
        if (draggingDocId != null) {
          e.preventDefault()
          setDropRoot(true)
        }
      }}
      onDragLeave={() => setDropRoot(false)}
      onDrop={(e) => {
        e.preventDefault()
        if (draggingDocId != null) props.onMoveDocument(draggingDocId, null)
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
      {props.nodes.map((node) => (
        <TreeRow key={node.key} node={node} depth={0} ctx={ctx} />
      ))}
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
  if (node.kind === 'file') {
    return (
      <div
        className="folder-tree__file"
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
        onDragOver={(e) => {
          if (ctx.draggingDocId != null) {
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
          if (ctx.draggingDocId != null) ctx.onMoveDocument(ctx.draggingDocId, node.folderId)
          ctx.setDraggingDocId(null)
          ctx.setDropFolderId(null)
        }}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" className="folder-tree__chevron" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" className="folder-tree__chevron" />
        )}
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
          <span className="folder-tree__name">{node.name}</span>
        )}
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
      </div>
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

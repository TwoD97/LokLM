import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
  Star,
  Code2,
  Unlock,
  Info,
  X,
} from 'lucide-react'
import type { Document, Folder, FolderAssignment, Workspace } from '@shared/documents'
import { useT } from '../i18n'
import { DocIcon } from '../ui/DocIcon'
import { useModalFocus } from '../ui/useModalFocus'
import { FolderTree, type FolderScopeState } from '../folders/FolderTree'
import {
  buildFolderTree,
  collectDescendantDocIds,
  topLevelFolderKeys,
} from '../folders/folderTreeModel'

import { isModuleVisible, type AppView as ViewKind } from '@shared/settings'
import { useSettings } from '../settings/useSettings'
import { MODULE_OPTIONS } from '../settings/moduleOptions'

type Props = {
  expanded: boolean
  pinned: boolean
  workspaces: Workspace[]
  activeWorkspaceId: number | null
  activeView: ViewKind
  onWorkspaceSelect: (id: number) => void
  onCreateWorkspace: (name: string, encrypted: boolean) => void
  onRenameWorkspace: (id: number, name: string) => void
  onRequestDeleteWorkspace: (ws: Workspace) => void
  defaultWorkspaceId: number | null
  onSetDefaultWorkspace: (id: number) => void
  onViewChange: (v: ViewKind) => void
  onTogglePin: () => void
  chatViewActive: boolean
  workspaceDocs: Document[]
  activeDocumentIds: number[]
  onToggleDocument: (docId: number) => void
  onClearScope: () => void
  // User-created folders for the active workspace (chat-scope organization).
  folders: Folder[]
  folderAssignments: FolderAssignment[]
  onCreateFolder: (name: string, parentId: number | null) => void
  onRenameFolder: (id: number, name: string) => void
  onDeleteFolder: (id: number) => void
  onMoveDocumentToFolder: (documentId: number, folderId: number | null) => void
  onToggleFolderScope: (folderId: number) => void
}

/** Help modal explaining how to organise workspaces for the best answers.
 *  Closes on backdrop click, the close button, or Escape. */
function WorkspaceInfoModal({ onClose }: { onClose: () => void }): JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref, true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="ws-info-modal__backdrop" onClick={onClose}>
      <div
        className="ws-info-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t('shell.workspaceInfoTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ws-info-modal__header">
          <h3 className="ws-info-modal__title">{t('shell.workspaceInfoTitle')}</h3>
          <button
            type="button"
            className="ws-info-modal__close"
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="ws-info-modal__intro">{t('shell.workspaceInfoIntro')}</p>
        <ul className="ws-info-modal__list">
          <li>{t('shell.workspaceInfoTip1')}</li>
          <li>{t('shell.workspaceInfoTip2')}</li>
          <li>{t('shell.workspaceInfoTip3')}</li>
        </ul>
      </div>
    </div>
  )
}

export function Sidebar({
  expanded,
  pinned,
  workspaces,
  activeWorkspaceId,
  activeView,
  onWorkspaceSelect,
  onCreateWorkspace,
  onRenameWorkspace,
  onRequestDeleteWorkspace,
  defaultWorkspaceId,
  onSetDefaultWorkspace,
  onViewChange,
  onTogglePin,
  chatViewActive,
  workspaceDocs,
  activeDocumentIds,
  onToggleDocument,
  onClearScope,
  folders,
  folderAssignments,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveDocumentToFolder,
  onToggleFolderScope,
}: Props): JSX.Element {
  const t = useT()
  const { settings } = useSettings()
  const [draft, setDraft] = useState('')
  // New-workspace encryption choice (fixed at creation). Default on; users opt
  // out for large, non-sensitive corpora to skip the decrypt-on-open wait.
  const [newWsEncrypted, setNewWsEncrypted] = useState(true)
  // Toggles the "how to manage workspaces for best results" help panel.
  const [infoOpen, setInfoOpen] = useState(false)
  // id of the workspace whose name is being edited inline, plus its draft text.
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

  // Folder tree for the chat doc-scope picker, built from folders + assignments
  // + the workspace's documents (unfiled docs surface at the root).
  const tree = useMemo(
    () => buildFolderTree(folders, folderAssignments, workspaceDocs),
    [folders, folderAssignments, workspaceDocs],
  )
  const topKeys = useMemo(() => topLevelFolderKeys(tree), [tree])
  // Expansion state, with top-level folders auto-opened the first time they
  // appear (folders/docs arrive async). seenRef stops a user-collapsed folder
  // from springing back open on the next refresh.
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const seenRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    seenRef.current = new Set()
    setExpandedFolders(new Set())
  }, [activeWorkspaceId])
  useEffect(() => {
    setExpandedFolders((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const k of topKeys) {
        if (!seenRef.current.has(k)) {
          seenRef.current.add(k)
          next.add(k)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [topKeys])
  const toggleFolderExpand = useCallback((key: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const folderScopeState = useCallback(
    (folderId: number): FolderScopeState => {
      const ids = collectDescendantDocIds(folderId, folders, folderAssignments)
      if (ids.length === 0) return 'none'
      const selected = ids.filter((id) => activeDocumentIds.includes(id)).length
      if (selected === 0) return 'none'
      return selected === ids.length ? 'all' : 'partial'
    },
    [folders, folderAssignments, activeDocumentIds],
  )

  const commitRename = (id: number): void => {
    const trimmed = editDraft.trim()
    setEditingId(null)
    if (trimmed.length > 0) onRenameWorkspace(id, trimmed)
  }

  // Stale-id filter: a document may have been deleted while still referenced
  // by the conversation row. Only count and render ids that still resolve.
  const visibleDocIds = new Set(workspaceDocs.map((d) => d.id))
  const selectedCount = activeDocumentIds.filter((id) => visibleDocIds.has(id)).length

  // Switching workspace is confined to the Library view. Everywhere else only
  // the active workspace is listed — its row still drives the chat doc-picker,
  // but the others are hidden, so to change workspace the user returns to the
  // Library. This also keeps a mid-chat switch (which resets the conversation /
  // scope) from happening by accident.
  const inLibrary = activeView === 'library'
  const visibleWorkspaces = inLibrary
    ? workspaces
    : workspaces.filter((w) => w.id === activeWorkspaceId)

  return (
    <aside className="app-shell__sidebar">
      <div className="sidebar__top">
        {expanded && <span className="sidebar__brand">LokLM</span>}
        <button
          type="button"
          className="sidebar__toggle"
          onClick={onTogglePin}
          aria-label={t(pinned ? 'ux.collapseSidebar' : 'ux.expandSidebar')}
          aria-expanded={expanded}
        >
          {pinned ? (
            <PanelLeftClose size={19} aria-hidden="true" />
          ) : (
            <PanelLeftOpen size={19} aria-hidden="true" />
          )}
        </button>
      </div>
      <nav className="sidebar__rail" aria-label={t('ux.navigation')}>
        {MODULE_OPTIONS.filter(({ id }) => isModuleVisible(settings?.basic.modules, id)).map(
          ({ id, key, Icon }) => (
            <button
              key={id}
              className={`sidebar__rail-btn ${activeView === id ? 'sidebar__rail-btn--active' : ''}`}
              onClick={() => onViewChange(id)}
              aria-current={activeView === id ? 'page' : undefined}
              aria-label={t(key)}
              title={t(key)}
            >
              <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
              {expanded && <span>{t(key)}</span>}
            </button>
          ),
        )}
      </nav>
      {expanded && (inLibrary || chatViewActive) && (
        <div className="sidebar__expanded">
          <div className="sidebar__expanded-header">
            <div className="sidebar__section-heading">
              <span className="sidebar__section-label">
                {inLibrary ? t('shell.workspaces') : t('shell.workspace')}
              </span>
              <button
                type="button"
                className={`sidebar__info-btn ${infoOpen ? 'sidebar__info-btn--active' : ''}`}
                onClick={() => setInfoOpen((v) => !v)}
                aria-label={t('shell.workspaceInfo')}
                aria-expanded={infoOpen}
                title={t('shell.workspaceInfo')}
              >
                <Info size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          {infoOpen && <WorkspaceInfoModal onClose={() => setInfoOpen(false)} />}
          {visibleWorkspaces.map((w) => {
            const isActive = w.id === activeWorkspaceId

            // Chat: the (single) active workspace is a plain title with its
            // document-scope tree always open beneath it at full width — no
            // dropdown, no card. Switching / managing workspaces lives in Library.
            if (isActive && chatViewActive) {
              return (
                <div key={w.id} className="sidebar__ws-chat">
                  <div className="sidebar__ws-title">
                    <span className="sidebar__ws-title-name" title={w.name}>
                      {w.name}
                    </span>
                    {w.type === 'codebase' && (
                      <Code2
                        size={13}
                        aria-label={t('shell.codebaseWorkspace')}
                        className="sidebar__ws-type-badge"
                      />
                    )}
                    {w.encryptionLevel === 'none' && (
                      <Unlock
                        size={13}
                        aria-label={t('shell.unencryptedWorkspace')}
                        className="sidebar__ws-type-badge"
                      />
                    )}
                  </div>
                  <div className="sidebar__doc-scope">
                    <div className="sidebar__doc-scope-header">
                      <span className="sidebar__doc-scope-label">
                        {selectedCount > 0
                          ? t('shell.scopeFiles', {
                              count: selectedCount,
                              noun:
                                selectedCount === 1
                                  ? t('shell.scopeFileSingular')
                                  : t('shell.scopeFilePlural'),
                            })
                          : t('shell.scopeAllDocuments')}
                      </span>
                      {selectedCount > 0 && (
                        <button
                          type="button"
                          className="sidebar__doc-scope-clear"
                          onClick={onClearScope}
                          aria-label={t('shell.clearScope')}
                        >
                          {t('shell.clear')}
                        </button>
                      )}
                    </div>
                    {folders.length === 0 && workspaceDocs.length === 0 ? (
                      <div className="sidebar__doc-scope-empty">{t('shell.noDocumentsYet')}</div>
                    ) : (
                      <FolderTree
                        nodes={tree}
                        expanded={expandedFolders}
                        onToggleExpand={toggleFolderExpand}
                        onCreateFolder={onCreateFolder}
                        onRenameFolder={onRenameFolder}
                        onDeleteFolder={onDeleteFolder}
                        onMoveDocument={onMoveDocumentToFolder}
                        folderScopeState={folderScopeState}
                        onToggleFolderScope={onToggleFolderScope}
                        newFolderLabel={t('folders.new')}
                        compact
                        renderFile={(d) => {
                          const selected = activeDocumentIds.includes(d.id)
                          // A div (role=button), not a <button>: a real button
                          // swallows the draggable parent's drag gesture in
                          // Chromium, so files couldn't be dragged into folders.
                          return (
                            <div
                              role="button"
                              tabIndex={0}
                              className={`sidebar__doc-btn-inner ${selected ? 'sidebar__doc-btn-inner--active' : ''}`}
                              onClick={() => onToggleDocument(d.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  onToggleDocument(d.id)
                                }
                              }}
                              aria-pressed={selected}
                              title={d.title}
                            >
                              <DocIcon source={d.sourcePath} size={14} />
                              <span className="sidebar__doc-btn-label">{d.title}</span>
                            </div>
                          )
                        }}
                      />
                    )}
                  </div>
                </div>
              )
            }

            // Library: interactive workspace row (select / rename / star / delete).
            return (
              <div key={w.id}>
                {editingId === w.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      commitRename(w.id)
                    }}
                  >
                    <input
                      className="sidebar__ws-edit-input"
                      value={editDraft}
                      autoFocus
                      onChange={(e) => setEditDraft(e.target.value)}
                      onBlur={() => commitRename(w.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      aria-label={t('shell.renameWorkspace')}
                    />
                  </form>
                ) : (
                  <div className="sidebar__ws-row">
                    <button
                      className={`sidebar__nav-btn ${isActive ? 'sidebar__nav-btn--active' : ''}`}
                      onClick={() => onWorkspaceSelect(w.id)}
                    >
                      <span className="sidebar__nav-btn-label">{w.name}</span>
                      {w.type === 'codebase' && (
                        <Code2
                          size={13}
                          aria-label={t('shell.codebaseWorkspace')}
                          className="sidebar__ws-type-badge"
                        />
                      )}
                      {w.encryptionLevel === 'none' && (
                        <Unlock
                          size={13}
                          aria-label={t('shell.unencryptedWorkspace')}
                          className="sidebar__ws-type-badge"
                        />
                      )}
                    </button>
                    <span className="sidebar__ws-actions">
                      <button
                        type="button"
                        className="sidebar__ws-action"
                        aria-label={t('shell.setDefaultWorkspace')}
                        aria-pressed={w.id === defaultWorkspaceId}
                        title={
                          w.id === defaultWorkspaceId
                            ? t('shell.defaultWorkspace')
                            : t('shell.setDefaultWorkspace')
                        }
                        onClick={(e) => {
                          e.stopPropagation()
                          onSetDefaultWorkspace(w.id)
                        }}
                      >
                        <Star
                          size={13}
                          aria-hidden="true"
                          fill={w.id === defaultWorkspaceId ? 'currentColor' : 'none'}
                        />
                      </button>
                      <button
                        type="button"
                        className="sidebar__ws-action"
                        aria-label={t('shell.renameWorkspace')}
                        title={t('shell.renameWorkspace')}
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingId(w.id)
                          setEditDraft(w.name)
                        }}
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="sidebar__ws-action"
                        aria-label={t('shell.deleteWorkspace')}
                        title={t('shell.deleteWorkspace')}
                        onClick={(e) => {
                          e.stopPropagation()
                          onRequestDeleteWorkspace(w)
                        }}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                )}
              </div>
            )
          })}
          {inLibrary && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const trimmed = draft.trim()
                if (trimmed.length === 0) return
                onCreateWorkspace(trimmed, newWsEncrypted)
                setDraft('')
                setNewWsEncrypted(true)
              }}
              className="sidebar__new-ws-form"
            >
              <input
                className="sidebar__new-ws-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('shell.newWorkspace')}
                aria-label={t('shell.newWorkspace')}
              />
              {draft.trim().length > 0 && (
                <>
                  <label className="sidebar__new-ws-encrypt">
                    <input
                      type="checkbox"
                      checked={newWsEncrypted}
                      onChange={(e) => setNewWsEncrypted(e.target.checked)}
                    />
                    <span>{t('shell.encryptWorkspace')}</span>
                  </label>
                  <button type="submit" className="sidebar__create">
                    {t('ux.createWorkspace')}
                  </button>
                  <p className="sidebar__new-ws-hint">
                    {newWsEncrypted
                      ? t('shell.encryptWorkspaceOnHint')
                      : t('shell.encryptWorkspaceOffHint')}
                  </p>
                </>
              )}
            </form>
          )}
        </div>
      )}
    </aside>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePinnedSidebar(): [boolean, () => void] {
  const [pinned, setPinned] = useState<boolean>(() => {
    try {
      return localStorage.getItem('loklm:sidebar:pinned') !== '0'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('loklm:sidebar:pinned', pinned ? '1' : '0')
    } catch {
      /* ignore quota errors */
    }
  }, [pinned])
  return [pinned, () => setPinned((v) => !v)]
}

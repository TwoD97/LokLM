import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Library,
  MessageSquare,
  FileText,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  Languages,
  Mic,
  PenLine,
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
import { FolderTree, type FolderScopeState } from '../folders/FolderTree'
import {
  buildFolderTree,
  collectDescendantDocIds,
  topLevelFolderKeys,
} from '../folders/folderTreeModel'

type ViewKind = 'library' | 'chat' | 'quiz' | 'transcription' | 'translation' | 'writing'

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
  onPeek: (peek: boolean) => void
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
  onPeek,
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
  const [draft, setDraft] = useState('')
  // New-workspace encryption choice (fixed at creation). Default on; users opt
  // out for large, non-sensitive corpora to skip the decrypt-on-open wait.
  const [newWsEncrypted, setNewWsEncrypted] = useState(true)
  const [docPickerOpen, setDocPickerOpen] = useState(true)
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

  return (
    <aside
      className="app-shell__sidebar"
      onMouseEnter={() => !pinned && onPeek(true)}
      onMouseLeave={() => !pinned && onPeek(false)}
    >
      <div className="sidebar__rail">
        <button
          className={`sidebar__rail-btn ${activeView === 'library' ? 'sidebar__rail-btn--active' : ''}`}
          onClick={() => onViewChange('library')}
          aria-label={t('shell.navLibrary')}
          title={t('shell.navLibrary')}
        >
          <Library size={22} strokeWidth={2.25} color="currentColor" aria-hidden="true" />
        </button>
        <button
          className={`sidebar__rail-btn ${activeView === 'chat' ? 'sidebar__rail-btn--active' : ''}`}
          onClick={() => onViewChange('chat')}
          aria-label={t('shell.navChat')}
          title={t('shell.navChat')}
        >
          <MessageSquare size={22} strokeWidth={2.25} color="currentColor" aria-hidden="true" />
        </button>
        <button
          className={`sidebar__rail-btn ${activeView === 'quiz' ? 'sidebar__rail-btn--active' : ''}`}
          onClick={() => onViewChange('quiz')}
          aria-label={t('shell.navQuiz')}
          title={t('shell.navQuiz')}
        >
          <GraduationCap size={22} strokeWidth={2.25} color="currentColor" aria-hidden="true" />
        </button>
        <button
          className={`sidebar__rail-btn ${activeView === 'transcription' ? 'sidebar__rail-btn--active' : ''}`}
          onClick={() => onViewChange('transcription')}
          aria-label={t('shell.navTranscription')}
          title={t('shell.navTranscription')}
        >
          <Mic size={22} strokeWidth={2.25} color="currentColor" aria-hidden="true" />
        </button>
        <button
          className={`sidebar__rail-btn ${activeView === 'translation' ? 'sidebar__rail-btn--active' : ''}`}
          onClick={() => onViewChange('translation')}
          aria-label={t('shell.navTranslation')}
          title={t('shell.navTranslation')}
        >
          <Languages size={22} strokeWidth={2.25} color="currentColor" aria-hidden="true" />
        </button>
        <button
          className={`sidebar__rail-btn ${activeView === 'writing' ? 'sidebar__rail-btn--active' : ''}`}
          onClick={() => onViewChange('writing')}
          aria-label={t('shell.navWriting')}
          title={t('shell.navWriting')}
        >
          <PenLine size={22} strokeWidth={2.25} color="currentColor" aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="sidebar__expanded">
          <div className="sidebar__expanded-header">
            <div className="sidebar__section-heading">
              <span className="sidebar__section-label">{t('shell.workspaces')}</span>
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
            <button
              className="sidebar__rail-btn"
              onClick={onTogglePin}
              aria-label={pinned ? t('shell.unpinSidebar') : t('shell.pinSidebar')}
              title={pinned ? t('shell.unpinSidebar') : t('shell.pinSidebar')}
            >
              {pinned ? (
                <PanelLeftClose size={16} aria-hidden="true" />
              ) : (
                <PanelLeftOpen size={16} aria-hidden="true" />
              )}
            </button>
          </div>
          {infoOpen && <WorkspaceInfoModal onClose={() => setInfoOpen(false)} />}
          {workspaces.map((w) => {
            const isActive = w.id === activeWorkspaceId
            const isDropdown = isActive && chatViewActive
            const showDocs = isDropdown && docPickerOpen
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
                      className={`sidebar__nav-btn ${isActive ? 'sidebar__nav-btn--active' : ''} ${isDropdown ? 'sidebar__nav-btn--dropdown' : ''}`}
                      onClick={() => {
                        if (isDropdown) {
                          setDocPickerOpen((v) => !v)
                        } else {
                          onWorkspaceSelect(w.id)
                          setDocPickerOpen(true)
                        }
                      }}
                      aria-expanded={isDropdown ? docPickerOpen : undefined}
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
                      {isDropdown &&
                        (docPickerOpen ? (
                          <ChevronDown size={14} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={14} aria-hidden="true" />
                        ))}
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
                {showDocs && (
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
                        renderFile={(d) => {
                          const selected = activeDocumentIds.includes(d.id)
                          return (
                            <button
                              type="button"
                              className={`sidebar__doc-btn-inner ${selected ? 'sidebar__doc-btn-inner--active' : ''}`}
                              onClick={() => onToggleDocument(d.id)}
                              aria-pressed={selected}
                              title={d.title}
                            >
                              <FileText size={14} aria-hidden="true" />
                              <span className="sidebar__doc-btn-label">{d.title}</span>
                            </button>
                          )
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
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
                <p className="sidebar__new-ws-hint">
                  {newWsEncrypted
                    ? t('shell.encryptWorkspaceOnHint')
                    : t('shell.encryptWorkspaceOffHint')}
                </p>
              </>
            )}
          </form>
        </div>
      )}
    </aside>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePinnedSidebar(): [boolean, () => void] {
  const [pinned, setPinned] = useState<boolean>(() => {
    try {
      return localStorage.getItem('loklm:sidebar:pinned') === '1'
    } catch {
      return false
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

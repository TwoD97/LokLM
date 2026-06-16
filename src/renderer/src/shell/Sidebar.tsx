import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import type { Document, Workspace } from '@shared/documents'
import { useT } from '../i18n'

type ViewKind = 'library' | 'chat' | 'quiz' | 'transcription' | 'translation' | 'writing'

type Props = {
  expanded: boolean
  pinned: boolean
  workspaces: Workspace[]
  activeWorkspaceId: number | null
  activeView: ViewKind
  onWorkspaceSelect: (id: number) => void
  onCreateWorkspace: (name: string) => void
  onRenameWorkspace: (id: number, name: string) => void
  onRequestDeleteWorkspace: (ws: Workspace) => void
  onViewChange: (v: ViewKind) => void
  onTogglePin: () => void
  onPeek: (peek: boolean) => void
  chatViewActive: boolean
  workspaceDocs: Document[]
  activeDocumentIds: number[]
  onToggleDocument: (docId: number) => void
  onClearScope: () => void
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
  onViewChange,
  onTogglePin,
  onPeek,
  chatViewActive,
  workspaceDocs,
  activeDocumentIds,
  onToggleDocument,
  onClearScope,
}: Props): JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState('')
  const [docPickerOpen, setDocPickerOpen] = useState(true)
  // id of the workspace whose name is being edited inline, plus its draft text.
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

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
            <span className="sidebar__section-label">{t('shell.workspaces')}</span>
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
                    {workspaceDocs.length === 0 ? (
                      <div className="sidebar__doc-scope-empty">{t('shell.noDocumentsYet')}</div>
                    ) : (
                      workspaceDocs.map((d) => {
                        const selected = activeDocumentIds.includes(d.id)
                        return (
                          <button
                            key={d.id}
                            type="button"
                            className={`sidebar__nav-btn sidebar__doc-btn ${selected ? 'sidebar__nav-btn--active' : ''}`}
                            onClick={() => onToggleDocument(d.id)}
                            aria-pressed={selected}
                            title={d.title}
                          >
                            <FileText size={14} aria-hidden="true" />
                            <span className="sidebar__doc-btn-label">{d.title}</span>
                          </button>
                        )
                      })
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
              onCreateWorkspace(trimmed)
              setDraft('')
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

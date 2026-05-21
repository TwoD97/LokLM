import { useState, useEffect } from 'react'
import {
  Library,
  MessageSquare,
  FileText,
  ChevronDown,
  ChevronRight,
  GraduationCap,
} from 'lucide-react'
import type { Document, Workspace } from '@shared/documents'

type ViewKind = 'library' | 'chat' | 'quiz'

type Props = {
  expanded: boolean
  pinned: boolean
  workspaces: Workspace[]
  activeWorkspaceId: number | null
  activeView: ViewKind
  onWorkspaceSelect: (id: number) => void
  onCreateWorkspace: (name: string) => void
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
  onViewChange,
  onTogglePin,
  onPeek,
  chatViewActive,
  workspaceDocs,
  activeDocumentIds,
  onToggleDocument,
  onClearScope,
}: Props): JSX.Element {
  const [draft, setDraft] = useState('')
  const [docPickerOpen, setDocPickerOpen] = useState(true)

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
          aria-label="Library"
          title="Library"
        >
          <Library size={22} strokeWidth={2.25} color="#e6edf3" aria-hidden="true" />
        </button>
        <button
          className={`sidebar__rail-btn ${activeView === 'chat' ? 'sidebar__rail-btn--active' : ''}`}
          onClick={() => onViewChange('chat')}
          aria-label="Chat"
          title="Chat"
        >
          <MessageSquare size={22} strokeWidth={2.25} color="#e6edf3" aria-hidden="true" />
        </button>
        <button
          className={`sidebar__rail-btn ${activeView === 'quiz' ? 'sidebar__rail-btn--active' : ''}`}
          onClick={() => onViewChange('quiz')}
          aria-label="Quiz"
          title="Quiz"
        >
          <GraduationCap size={22} strokeWidth={2.25} color="#e6edf3" aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="sidebar__expanded">
          <div className="sidebar__expanded-header">
            <span className="sidebar__section-label" style={{ margin: 0 }}>
              Workspaces
            </span>
            <button
              className="sidebar__rail-btn"
              onClick={onTogglePin}
              aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
              title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
            >
              {pinned ? '«' : '»'}
            </button>
          </div>
          {workspaces.map((w) => {
            const isActive = w.id === activeWorkspaceId
            const isDropdown = isActive && chatViewActive
            const showDocs = isDropdown && docPickerOpen
            return (
              <div key={w.id}>
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
                {showDocs && (
                  <div className="sidebar__doc-scope">
                    <div className="sidebar__doc-scope-header">
                      <span className="sidebar__doc-scope-label">
                        {selectedCount > 0
                          ? `Scope: ${selectedCount} file${selectedCount === 1 ? '' : 's'}`
                          : 'Scope: All documents'}
                      </span>
                      {selectedCount > 0 && (
                        <button
                          type="button"
                          className="sidebar__doc-scope-clear"
                          onClick={onClearScope}
                          aria-label="Clear document scope"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {workspaceDocs.length === 0 ? (
                      <div className="sidebar__doc-scope-empty">No documents yet</div>
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
            style={{ marginTop: 8 }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="+ New workspace"
              style={{
                width: '100%',
                padding: '6px 8px',
                borderRadius: 6,
                background: '#0f1a2a',
                color: 'inherit',
                border: '1px solid #243a55',
                boxSizing: 'border-box',
              }}
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

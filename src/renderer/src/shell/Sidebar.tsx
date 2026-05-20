import { useState, useEffect } from 'react'
import type { Workspace } from '@shared/documents'

type ViewKind = 'library' | 'chat'

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
}: Props): JSX.Element {
  const [draft, setDraft] = useState('')

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
          📚
        </button>
        <button
          className={`sidebar__rail-btn ${activeView === 'chat' ? 'sidebar__rail-btn--active' : ''}`}
          onClick={() => onViewChange('chat')}
          aria-label="Chat"
          title="Chat"
        >
          💬
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
          {workspaces.map((w) => (
            <button
              key={w.id}
              className={`sidebar__nav-btn ${w.id === activeWorkspaceId ? 'sidebar__nav-btn--active' : ''}`}
              onClick={() => onWorkspaceSelect(w.id)}
            >
              {w.name}
            </button>
          ))}
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

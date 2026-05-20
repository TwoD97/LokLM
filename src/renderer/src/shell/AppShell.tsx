import { useCallback, useEffect, useState } from 'react'
import type { Workspace } from '@shared/documents'
import { Sidebar, usePinnedSidebar } from './Sidebar'
import { LibraryView } from '../library/LibraryView'
import { ChatView } from '../chat/ChatView'
import './shell.css'

type ViewKind = 'library' | 'chat'

export function AppShell(): JSX.Element {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null)
  const [activeView, setActiveView] = useState<ViewKind>('library')
  const [pinned, togglePin] = usePinnedSidebar()
  const [peeking, setPeeking] = useState(false)
  const expanded = pinned || peeking

  const refreshWorkspaces = useCallback(async () => {
    const ws = await window.api.workspaces.list()
    setWorkspaces(ws)
    setActiveWorkspaceId((current) => current ?? (ws.length > 0 ? ws[0]!.id : null))
  }, [])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  const onCreateWorkspace = useCallback(
    async (name: string) => {
      const ws = await window.api.workspaces.create(name)
      await refreshWorkspaces()
      setActiveWorkspaceId(ws.id)
    },
    [refreshWorkspaces],
  )

  return (
    <div className={`app-shell ${expanded ? 'app-shell--expanded' : ''}`}>
      <Sidebar
        expanded={expanded}
        pinned={pinned}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activeView={activeView}
        onWorkspaceSelect={setActiveWorkspaceId}
        onCreateWorkspace={(name) => void onCreateWorkspace(name)}
        onViewChange={setActiveView}
        onTogglePin={togglePin}
        onPeek={setPeeking}
      />
      <main className="app-shell__main">
        {activeWorkspaceId == null && (
          <div style={{ padding: 40, opacity: 0.6 }}>Create or select a workspace first.</div>
        )}
        {activeView === 'library' && activeWorkspaceId != null && (
          <LibraryView
            workspaceId={activeWorkspaceId}
            workspaceName={workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? ''}
          />
        )}
        {activeView === 'chat' && activeWorkspaceId != null && (
          <ChatView workspaceId={activeWorkspaceId} />
        )}
      </main>
    </div>
  )
}

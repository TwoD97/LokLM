import { useCallback, useEffect, useState } from 'react'
import type { Document, Workspace } from '@shared/documents'
import { Sidebar, usePinnedSidebar } from './Sidebar'
import { LibraryView } from '../library/LibraryView'
import { ChatView } from '../chat/ChatView'
import { QuizView } from '../quiz/QuizView'
import { useT } from '../i18n'
import './shell.css'

type ViewKind = 'library' | 'chat' | 'quiz'

export function AppShell(): JSX.Element {
  const t = useT()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null)
  const [activeView, setActiveView] = useState<ViewKind>('library')
  const [pinned, togglePin] = usePinnedSidebar()
  const [peeking, setPeeking] = useState(false)
  const expanded = pinned || peeking

  // Chat-scope state lifted here so the Sidebar can render the per-conversation
  // document picker. ChatView is a controlled consumer that reports
  // conversation changes back via onConversationChange.
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null)
  const [activeDocumentIds, setActiveDocumentIds] = useState<number[]>([])
  const [workspaceDocs, setWorkspaceDocs] = useState<Document[]>([])

  const refreshWorkspaces = useCallback(async () => {
    const ws = await window.api.workspaces.list()
    setWorkspaces(ws)
    setActiveWorkspaceId((current) => current ?? (ws.length > 0 ? ws[0]!.id : null))
  }, [])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  // Load docs for the active workspace; refresh on view switch back to chat
  // (covers deletions that happened in the Library) and on index-done events
  // (covers fresh imports).
  useEffect(() => {
    if (activeWorkspaceId == null) {
      setWorkspaceDocs([])
      return
    }
    let cancelled = false
    void window.api.documents.list(activeWorkspaceId).then((docs) => {
      if (!cancelled) setWorkspaceDocs(docs)
    })
    const off = window.api.documents.onIndexProgress((p) => {
      if (p.phase !== 'done') return
      void window.api.documents.list(activeWorkspaceId).then((docs) => {
        if (!cancelled) setWorkspaceDocs(docs)
      })
    })
    return () => {
      cancelled = true
      off()
    }
  }, [activeWorkspaceId, activeView])

  const onCreateWorkspace = useCallback(
    async (name: string) => {
      const ws = await window.api.workspaces.create(name)
      await refreshWorkspaces()
      setActiveWorkspaceId(ws.id)
    },
    [refreshWorkspaces],
  )

  const onWorkspaceSelect = useCallback((id: number) => {
    setActiveWorkspaceId(id)
    setCurrentConversationId(null)
    setActiveDocumentIds([])
  }, [])

  const onConversationChange = useCallback((id: number | null, ids: number[]) => {
    setCurrentConversationId(id)
    setActiveDocumentIds(ids)
  }, [])

  const onToggleDocument = useCallback(
    async (docId: number) => {
      const next = activeDocumentIds.includes(docId)
        ? activeDocumentIds.filter((x) => x !== docId)
        : [...activeDocumentIds, docId]
      setActiveDocumentIds(next)
      if (currentConversationId != null) {
        await window.api.conversations.setActiveDocumentIds(currentConversationId, next)
      }
    },
    [activeDocumentIds, currentConversationId],
  )

  const onClearScope = useCallback(async () => {
    setActiveDocumentIds([])
    if (currentConversationId != null) {
      await window.api.conversations.setActiveDocumentIds(currentConversationId, [])
    }
  }, [currentConversationId])

  return (
    <div className={`app-shell ${expanded ? 'app-shell--expanded' : ''}`}>
      <Sidebar
        expanded={expanded}
        pinned={pinned}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activeView={activeView}
        onWorkspaceSelect={onWorkspaceSelect}
        onCreateWorkspace={(name) => void onCreateWorkspace(name)}
        onViewChange={setActiveView}
        onTogglePin={togglePin}
        onPeek={setPeeking}
        chatViewActive={activeView === 'chat'}
        workspaceDocs={workspaceDocs}
        activeDocumentIds={activeDocumentIds}
        onToggleDocument={(id) => void onToggleDocument(id)}
        onClearScope={() => void onClearScope()}
      />
      <main className="app-shell__main">
        {activeWorkspaceId == null && (
          <div className="app-shell__empty">{t('shell.selectWorkspaceFirst')}</div>
        )}
        {activeView === 'library' && activeWorkspaceId != null && (
          <LibraryView
            workspaceId={activeWorkspaceId}
            workspaceName={workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? ''}
          />
        )}
        {activeView === 'chat' && activeWorkspaceId != null && (
          <ChatView
            workspaceId={activeWorkspaceId}
            currentConversationId={currentConversationId}
            activeDocumentIds={activeDocumentIds}
            onConversationChange={onConversationChange}
          />
        )}
        {activeView === 'quiz' && activeWorkspaceId != null && (
          <QuizView
            key={activeWorkspaceId}
            workspaceId={activeWorkspaceId}
            documents={workspaceDocs}
          />
        )}
      </main>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import type { Document, Workspace } from '@shared/documents'
import { Sidebar, usePinnedSidebar } from './Sidebar'
import { useFolders } from '../folders/useFolders'
import { collectDescendantDocIds } from '../folders/folderTreeModel'
import { LibraryView } from '../library/LibraryView'
import { ChatView } from '../chat/ChatView'
import { QuizView } from '../quiz/QuizView'
import { TranscriptionView } from '../transcription/TranscriptionView'
import { TranslationView } from '../translation/TranslationView'
import { WritingView } from '../writing/WritingView'
import { ConfirmModal } from '../chat/ConfirmModal'
import { useT } from '../i18n'
import './shell.css'

type ViewKind = 'library' | 'chat' | 'quiz' | 'transcription' | 'translation' | 'writing'

export function AppShell(): JSX.Element {
  const t = useT()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null)
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState<number | null>(null)
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
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState<Workspace | null>(null)

  // User-created folders for the active workspace — drives the sidebar's folder
  // tree and folder-level chat scoping. Same hook the LibraryView uses, so both
  // surfaces stay in sync (the "unify" decision).
  const folders = useFolders(activeWorkspaceId)

  const refreshWorkspaces = useCallback(async () => {
    const ws = await window.api.workspaces.list()
    setWorkspaces(ws)
    // ADR-0005: on first load, honour the configured default workspace; fall
    // back to the first workspace. Once a workspace is active, leave it alone.
    const def = await window.api.workspaces.getDefault().catch(() => null)
    setDefaultWorkspaceId(def)
    setActiveWorkspaceId((current) => {
      if (current != null) return current
      if (def != null && ws.some((w) => w.id === def)) return def
      return ws.length > 0 ? ws[0]!.id : null
    })
  }, [])

  const handleSetDefaultWorkspace = useCallback(async (id: number) => {
    // Toggle: clicking the current default clears it.
    setDefaultWorkspaceId((current) => {
      const next = current === id ? null : id
      void window.api.workspaces.setDefault(next).catch(() => undefined)
      return next
    })
  }, [])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  // ADR-0005: activating a workspace opens its encrypted SQLite store and
  // materialises its LanceDB vectors in main, and makes it the ACTIVE workspace
  // the per-id data ops (documents:get, conversations, quizzes) resolve against.
  // Fire it on every workspace switch, before the views below fetch id-keyed
  // data, so they hit the right store.
  useEffect(() => {
    if (activeWorkspaceId == null) return
    void window.api.workspaces.activate(activeWorkspaceId).catch(() => undefined)
  }, [activeWorkspaceId])

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

  // The Library has its own useFolders instance, so folders organized there
  // won't be in this (sidebar) instance until it refetches. Re-pull on entering
  // chat so the scope tree reflects recent organizing without a workspace switch.
  const refreshFolders = folders.refresh
  useEffect(() => {
    if (activeView === 'chat') void refreshFolders()
  }, [activeView, refreshFolders])

  const onCreateWorkspace = useCallback(
    async (name: string, encrypted: boolean) => {
      const ws = await window.api.workspaces.create(name, encrypted)
      await refreshWorkspaces()
      setActiveWorkspaceId(ws.id)
      // Reset the conversation/scope state, exactly like onWorkspaceSelect.
      // Without this, currentConversationId stays pointing at a conversation
      // from the PREVIOUS workspace; the first chat message then routes
      // chat:stream(newWorkspaceId, staleConversationId) and appendMessage
      // throws "conversation N is not in this workspace store" (each workspace
      // has its own conversations store / id space, ADR-0005).
      setCurrentConversationId(null)
      setActiveDocumentIds([])
    },
    [refreshWorkspaces],
  )

  const onWorkspaceSelect = useCallback((id: number) => {
    setActiveWorkspaceId(id)
    setCurrentConversationId(null)
    setActiveDocumentIds([])
  }, [])

  const onRenameWorkspace = useCallback(
    async (id: number, name: string) => {
      const trimmed = name.trim()
      if (trimmed.length === 0) return
      await window.api.workspaces.rename(id, trimmed)
      await refreshWorkspaces()
    },
    [refreshWorkspaces],
  )

  // Cascade-deletes the workspace and all its content in main. If the active
  // workspace is the one removed, fall back to the first remaining one (or the
  // empty state) and drop any now-orphaned chat scope.
  const onDeleteWorkspace = useCallback(
    async (id: number) => {
      await window.api.workspaces.delete(id)
      setConfirmDeleteWorkspace(null)
      const ws = await window.api.workspaces.list()
      setWorkspaces(ws)
      if (activeWorkspaceId === id) {
        setCurrentConversationId(null)
        setActiveDocumentIds([])
        setActiveWorkspaceId(ws.length > 0 ? ws[0]!.id : null)
      }
    },
    [activeWorkspaceId],
  )

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

  // Toggle every document inside a folder (recursively) into/out of chat scope.
  // "All selected" → remove them all; otherwise add the missing ones. This is
  // the bulk version of onToggleDocument and the high-value folder/chat link.
  const onToggleFolderScope = useCallback(
    async (folderId: number) => {
      const ids = collectDescendantDocIds(folderId, folders.folders, folders.assignments)
      if (ids.length === 0) return
      const allSelected = ids.every((id) => activeDocumentIds.includes(id))
      const next = allSelected
        ? activeDocumentIds.filter((id) => !ids.includes(id))
        : Array.from(new Set([...activeDocumentIds, ...ids]))
      setActiveDocumentIds(next)
      if (currentConversationId != null) {
        await window.api.conversations.setActiveDocumentIds(currentConversationId, next)
      }
    },
    [folders.folders, folders.assignments, activeDocumentIds, currentConversationId],
  )

  return (
    <div className={`app-shell ${expanded ? 'app-shell--expanded' : ''}`}>
      <Sidebar
        expanded={expanded}
        pinned={pinned}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activeView={activeView}
        onWorkspaceSelect={onWorkspaceSelect}
        onCreateWorkspace={(name, encrypted) => void onCreateWorkspace(name, encrypted)}
        onRenameWorkspace={(id, name) => void onRenameWorkspace(id, name)}
        onRequestDeleteWorkspace={setConfirmDeleteWorkspace}
        defaultWorkspaceId={defaultWorkspaceId}
        onSetDefaultWorkspace={(id) => void handleSetDefaultWorkspace(id)}
        onViewChange={setActiveView}
        onTogglePin={togglePin}
        onPeek={setPeeking}
        chatViewActive={activeView === 'chat'}
        workspaceDocs={workspaceDocs}
        activeDocumentIds={activeDocumentIds}
        onToggleDocument={(id) => void onToggleDocument(id)}
        onClearScope={() => void onClearScope()}
        folders={folders.folders}
        folderAssignments={folders.assignments}
        onCreateFolder={(name, parentId) => void folders.createFolder(name, parentId)}
        onRenameFolder={(id, name) => void folders.renameFolder(id, name)}
        onDeleteFolder={(id) => void folders.deleteFolder(id)}
        onMoveDocumentToFolder={(docId, folderId) => void folders.moveDocument(docId, folderId)}
        onToggleFolderScope={(id) => void onToggleFolderScope(id)}
      />
      <main className="app-shell__main">
        {activeWorkspaceId == null &&
          activeView !== 'transcription' &&
          activeView !== 'translation' &&
          activeView !== 'writing' && (
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
            documents={workspaceDocs}
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
        {activeView === 'transcription' && <TranscriptionView workspaceId={activeWorkspaceId} />}
        {activeView === 'translation' && <TranslationView />}
        {activeView === 'writing' && <WritingView />}
      </main>
      {confirmDeleteWorkspace && (
        <ConfirmModal
          title={t('shell.deleteWorkspaceTitle')}
          body={t('shell.deleteWorkspaceBody', { name: confirmDeleteWorkspace.name })}
          onConfirm={() => void onDeleteWorkspace(confirmDeleteWorkspace.id)}
          onCancel={() => setConfirmDeleteWorkspace(null)}
        />
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
  // True while a workspace is being opened (its encrypted store decrypted /
  // vector set materialised). Drives the full-area loading screen on switch.
  const [activating, setActivating] = useState(false)
  const [activeView, setActiveView] = useState<ViewKind>('library')
  const [pinned, togglePin] = usePinnedSidebar()
  const [peeking, setPeeking] = useState(false)
  // The expanded "Workspaces" panel only does anything where workspace
  // selection / document scoping lives: Library (workspace CRUD + switching)
  // and Chat (the per-conversation doc-scope picker). Quiz surfaces its source
  // workspace inside its own view, and transcription/translation/writing are
  // workspace-independent — so on those tabs the panel is dead weight. Collapse
  // to just the icon rail there (pin/peek are inert) instead of sliding out a
  // redundant panel of a single non-actionable workspace row.
  const showWorkspacePanel = activeView === 'library' || activeView === 'chat'
  const expanded = (pinned || peeking) && showWorkspacePanel

  // Chat-scope state lifted here so the Sidebar can render the per-conversation
  // document picker. ChatView is a controlled consumer that reports
  // conversation changes back via onConversationChange.
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null)
  const [activeDocumentIds, setActiveDocumentIds] = useState<number[]>([])
  const [workspaceDocs, setWorkspaceDocs] = useState<Document[]>([])
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState<Workspace | null>(null)

  // Library search query + table page lifted here (AppShell stays mounted) so
  // they survive the Library view unmounting on a tab switch — glancing at
  // another tab no longer drops the user back to page 1 with a cleared search.
  // Reset on workspace switch below, matching the previous per-workspace reset.
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryPage, setLibraryPage] = useState(0)
  useEffect(() => {
    setLibraryQuery('')
    setLibraryPage(0)
  }, [activeWorkspaceId])

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
  //
  // The decrypt-on-open (materialising the vector store) is the slow part for
  // big / encrypted workspaces, so the main area shows a loading screen until
  // `activate` resolves. A short delay before showing it keeps small / fast (or
  // unencrypted) switches from flashing a spinner.
  useEffect(() => {
    if (activeWorkspaceId == null) {
      setActivating(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      if (!cancelled) setActivating(true)
    }, 150)
    void window.api.workspaces
      .activate(activeWorkspaceId)
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer)
        if (!cancelled) setActivating(false)
      })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
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

  // workspaceName is user data, rendered verbatim (in the LibraryView header and
  // the switch loading screen).
  const activeWorkspaceName = workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? ''

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
        {activating && (
          <div className="app-shell__switching" role="status" aria-live="polite">
            <div className="app-shell__switching-spinner" aria-hidden="true" />
            <p className="app-shell__switching-title">
              {t('shell.switchingWorkspace', { name: activeWorkspaceName })}
            </p>
            <p className="app-shell__switching-hint">{t('shell.switchingWorkspaceHint')}</p>
          </div>
        )}
        {!activating && (
          <>
            {activeWorkspaceId == null &&
              activeView !== 'transcription' &&
              activeView !== 'translation' &&
              activeView !== 'writing' && (
                <div className="app-shell__empty">{t('shell.selectWorkspaceFirst')}</div>
              )}
            {activeView === 'library' && activeWorkspaceId != null && (
              <LibraryView
                workspaceId={activeWorkspaceId}
                workspaceName={activeWorkspaceName}
                searchQuery={libraryQuery}
                onSearchQueryChange={setLibraryQuery}
                page={libraryPage}
                onPageChange={setLibraryPage}
              />
            )}
            {/* Chat is kept mounted across tab switches too, so a half-typed
                draft, scroll position, and an in-flight streamed answer survive
                — the stream keeps feeding the hidden view instead of the model
                generating to completion for a torn-down UI. Workspace-scoped, so
                it stays inside the activating gate and self-resets on workspace
                change (no key needed); the null-guard mirrors the other views. */}
            <KeepAlive active={activeView === 'chat'}>
              {activeWorkspaceId != null && (
                <ChatView
                  workspaceId={activeWorkspaceId}
                  currentConversationId={currentConversationId}
                  activeDocumentIds={activeDocumentIds}
                  documents={workspaceDocs}
                  onConversationChange={onConversationChange}
                />
              )}
            </KeepAlive>
            {/* Quiz and transcription are workspace-scoped, so they live inside
                the activating gate (the quiz is keyed on the workspace and
                resets with it). They stay mounted across *tab* switches so an
                in-flight generation / transcription and its result survive — a
                quiz keeps generating rather than reverting to "Starting…".
                KeepAlive renders nothing until first shown. */}
            <KeepAlive active={activeView === 'quiz'}>
              {activeWorkspaceId != null && (
                <QuizView
                  key={activeWorkspaceId}
                  workspaceId={activeWorkspaceId}
                  workspaceName={activeWorkspaceName}
                  documents={workspaceDocs}
                  active={activeView === 'quiz'}
                />
              )}
            </KeepAlive>
            <KeepAlive active={activeView === 'transcription'}>
              <TranscriptionView
                workspaceId={activeWorkspaceId}
                active={activeView === 'transcription'}
              />
            </KeepAlive>
          </>
        )}
        {/* Translation and writing are workspace-INDEPENDENT, so they live
            OUTSIDE the activating gate: a workspace switch briefly shows the
            switching spinner and unmounts the gated block, and that must not
            wipe an in-progress translation / rewrite. Kept mounted-but-hidden,
            their state survives both tab and workspace switches. */}
        <KeepAlive active={!activating && activeView === 'translation'}>
          <TranslationView />
        </KeepAlive>
        <KeepAlive active={!activating && activeView === 'writing'}>
          <WritingView />
        </KeepAlive>
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

// Tab keep-alive. Once a view has been shown it stays mounted; while another tab
// is active it's hidden with `display:none` instead of being unmounted, so its
// React state (and any live IPC subscription — e.g. a quiz's generation event
// stream) survives a tab switch and keeps updating in the background. Renders
// nothing until first activated, so a never-opened tab costs nothing. The active
// wrapper uses `display:contents` (see shell.css), making it layout-transparent:
// the child view lays out exactly as a direct child of `.app-shell__main`, so
// the `height:100%` fill each view's CSS relies on still resolves.
function KeepAlive({
  active,
  children,
}: {
  active: boolean
  children: ReactNode
}): JSX.Element | null {
  const activatedRef = useRef(false)
  if (active) activatedRef.current = true
  if (!activatedRef.current) return null
  return <div className={active ? 'app-shell__view' : 'app-shell__view--hidden'}>{children}</div>
}

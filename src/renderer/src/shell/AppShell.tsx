import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from 'react'
import type { Document, Workspace } from '@shared/documents'
import { Sidebar, usePinnedSidebar } from './Sidebar'
import { useFolders } from '../folders/useFolders'
import { collectDescendantDocIds } from '../folders/folderTreeModel'
import { ConfirmModal } from '../chat/ConfirmModal'
import { useT } from '../i18n'
import './shell.css'
import { ModelActivityOverlay } from '../generation/ModelActivityOverlay'

import { isModuleVisible, type AppView as ViewKind } from '@shared/settings'
import { useSettings } from '../settings/useSettings'
import { ErrorBoundary } from '../ErrorBoundary'
const LibraryView = lazy(() =>
  import('../library/LibraryView').then((module) => ({ default: module.LibraryView })),
)
const ChatView = lazy(() =>
  import('../chat/ChatView').then((module) => ({ default: module.ChatView })),
)
const QuizView = lazy(() =>
  import('../quiz/QuizView').then((module) => ({ default: module.QuizView })),
)
const TranscriptionView = lazy(() =>
  import('../transcription/TranscriptionView').then((module) => ({
    default: module.TranscriptionView,
  })),
)
const TranslationView = lazy(() =>
  import('../translation/TranslationView').then((module) => ({ default: module.TranslationView })),
)
const WritingView = lazy(() =>
  import('../writing/WritingView').then((module) => ({ default: module.WritingView })),
)
const OrganizerView = lazy(() =>
  import('../organizer/OrganizerView').then((module) => ({ default: module.OrganizerView })),
)

export function AppShell(): JSX.Element {
  const t = useT()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selection, setSelection] = useState<{ id: number | null; revision: number }>({
    id: null,
    revision: 0,
  })
  const activeWorkspaceId = selection.id
  const setActiveWorkspaceId = useCallback((next: SetStateAction<number | null>) => {
    setSelection((current) => {
      const id = typeof next === 'function' ? next(current.id) : next
      return id === current.id ? current : { id, revision: current.revision + 1 }
    })
  }, [])
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState<number | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [workspaceMutation, setWorkspaceMutation] = useState(false)
  const workspaceMutationPending = useRef(false)
  const [workspaceError, setWorkspaceError] = useState<{ message: string; reload: boolean } | null>(
    null,
  )
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<number | null>(null)
  const workspaceRead = useRef(0)
  const [activatedRevision, setActivatedRevision] = useState<number | null>(null)
  const [activationError, setActivationError] = useState<{
    revision: number
    message: string
  } | null>(null)
  const activationQueue = useRef<Promise<void>>(Promise.resolve())
  // Gate immediately in render, including A → B → A while B is still opening.
  const activating =
    activeWorkspaceId != null &&
    (activatedRevision !== selection.revision || deletingWorkspaceId === activeWorkspaceId)
  const [activeView, setActiveView] = useState<ViewKind>('library')
  const { settings } = useSettings()
  const initialViewApplied = useRef(false)
  const lastOrganizerView = useRef<'calendar' | 'notes' | 'todos'>('calendar')
  const organizerActive =
    activeView === 'calendar' || activeView === 'notes' || activeView === 'todos'
  if (organizerActive) lastOrganizerView.current = activeView
  useEffect(() => {
    if (!settings) return
    if (!initialViewApplied.current) {
      initialViewApplied.current = true
      const start = settings.basic.startView ?? 'library'
      setActiveView(isModuleVisible(settings.basic.modules, start) ? start : 'library')
    } else if (!isModuleVisible(settings.basic.modules, activeView)) {
      setActiveView('library')
    }
  }, [settings, activeView])
  const [pinned, togglePin] = usePinnedSidebar()
  // Navigation stays in place across views. Only an explicit user action
  // changes its width, so moving the pointer never shifts the working area.
  const expanded = pinned

  // Chat-scope state lifted here so the Sidebar can render the per-conversation
  // document picker. ChatView is a controlled consumer that reports
  // conversation changes back via onConversationChange.
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null)
  const [activeDocumentIds, setActiveDocumentIds] = useState<number[]>([])
  const [workspaceDocs, setWorkspaceDocs] = useState<Document[]>([])
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [documentRetry, setDocumentRetry] = useState(0)
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
  const folders = useFolders(activating ? null : activeWorkspaceId)

  const refreshWorkspaces = useCallback(async () => {
    const request = ++workspaceRead.current
    setWorkspaceLoading(true)
    try {
      const [ws, def] = await Promise.all([
        window.api.workspaces.list(),
        window.api.workspaces.getDefault(),
      ])
      if (request !== workspaceRead.current) return
      setWorkspaces(ws)
      // ADR-0005: on first load, honour the configured default workspace; fall
      // back to the first workspace. Once a workspace is active, leave it alone.
      setDefaultWorkspaceId(def)
      setWorkspaceError(null)
      setActiveWorkspaceId((current) => {
        if (current != null) return current
        if (def != null && ws.some((w) => w.id === def)) return def
        return ws.length > 0 ? ws[0]!.id : null
      })
    } catch (cause) {
      if (request === workspaceRead.current)
        setWorkspaceError({ message: String(cause), reload: true })
    } finally {
      if (request === workspaceRead.current) setWorkspaceLoading(false)
    }
  }, [setActiveWorkspaceId])

  const mutateWorkspace = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    if (workspaceMutationPending.current) return false
    workspaceMutationPending.current = true
    workspaceRead.current++
    setWorkspaceMutation(true)
    setWorkspaceError(null)
    try {
      await action()
      return true
    } catch (cause) {
      setWorkspaceError({ message: String(cause), reload: false })
      return false
    } finally {
      workspaceMutationPending.current = false
      setWorkspaceMutation(false)
    }
  }, [])

  const handleSetDefaultWorkspace = useCallback(
    (id: number) =>
      mutateWorkspace(async () => {
        const next = defaultWorkspaceId === id ? null : id
        await window.api.workspaces.setDefault(next)
        setDefaultWorkspaceId(next)
      }),
    [defaultWorkspaceId, mutateWorkspace],
  )

  useEffect(() => {
    void refreshWorkspaces()
    return () => {
      // Invalidate requests, including the most recent request at unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      workspaceRead.current++
    }
  }, [refreshWorkspaces])

  // ADR-0005: activating a workspace opens its encrypted SQLite store and
  // materialises its LanceDB vectors in main, and makes it the ACTIVE workspace
  // the per-id data ops (documents:get, conversations, quizzes) resolve against.
  // Fire it on every workspace switch, before the views below fetch id-keyed
  // data, so they hit the right store.
  //
  // Activation changes main's active store. Serialize requests so an older
  // completion cannot switch that store back after the latest view is ready.
  useEffect(() => {
    if (selection.id == null) return
    let cancelled = false
    const activate = async (): Promise<void> => {
      if (cancelled) return
      try {
        await window.api.workspaces.activate(selection.id!)
        if (!cancelled) {
          setActivatedRevision(selection.revision)
          setActivationError(null)
        }
      } catch (error) {
        if (!cancelled)
          setActivationError({
            revision: selection.revision,
            message: error instanceof Error ? error.message : String(error),
          })
      }
    }
    activationQueue.current = activationQueue.current.then(activate, activate)
    return () => {
      cancelled = true
    }
  }, [selection])

  // Load docs for the active workspace; refresh on view switch back to chat
  // (covers deletions that happened in the Library) and on index-done events
  // (covers fresh imports).
  useEffect(() => {
    if (activeWorkspaceId == null || activating) {
      setWorkspaceDocs([])
      setDocumentError(null)
      return
    }
    let cancelled = false
    let request = 0
    const read = (): void => {
      const current = ++request
      void window.api.documents
        .list(activeWorkspaceId)
        .then((docs) => {
          if (!cancelled && current === request) {
            setWorkspaceDocs(docs)
            setDocumentError(null)
          }
        })
        .catch((error: unknown) => {
          if (!cancelled && current === request)
            setDocumentError(error instanceof Error ? error.message : String(error))
        })
    }
    read()
    const off = window.api.documents.onIndexProgress((p) => {
      if (p.phase !== 'done' || p.workspaceId !== activeWorkspaceId) return
      read()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [activeWorkspaceId, activeView, activating, documentRetry])

  // The Library has its own useFolders instance, so folders organized there
  // won't be in this (sidebar) instance until it refetches. Re-pull on entering
  // chat so the scope tree reflects recent organizing without a workspace switch.
  const refreshFolders = folders.refresh
  useEffect(() => {
    if (activeView === 'chat') void refreshFolders().catch(() => {})
  }, [activeView, refreshFolders])

  const onCreateWorkspace = useCallback(
    (name: string, encrypted: boolean) =>
      mutateWorkspace(async () => {
        const ws = await window.api.workspaces.create(name, encrypted)
        setWorkspaces((current) => [...current.filter((entry) => entry.id !== ws.id), ws])
        setActiveWorkspaceId(ws.id)
        // Reset the conversation/scope state, exactly like onWorkspaceSelect.
        // Without this, currentConversationId stays pointing at a conversation
        // from the PREVIOUS workspace; the first chat message then routes
        // chat:stream(newWorkspaceId, staleConversationId) and appendMessage
        // throws "conversation N is not in this workspace store" (each workspace
        // has its own conversations store / id space, ADR-0005).
        setCurrentConversationId(null)
        setActiveDocumentIds([])
      }),
    [mutateWorkspace, setActiveWorkspaceId],
  )

  const onWorkspaceSelect = useCallback(
    (id: number) => {
      if (id === activeWorkspaceId) return
      setActiveWorkspaceId(id)
      setCurrentConversationId(null)
      setActiveDocumentIds([])
    },
    [activeWorkspaceId, setActiveWorkspaceId],
  )

  const onRenameWorkspace = useCallback(
    async (id: number, name: string): Promise<boolean> => {
      const trimmed = name.trim()
      if (trimmed.length === 0) return false
      return mutateWorkspace(async () => {
        await window.api.workspaces.rename(id, trimmed)
        setWorkspaces((current) =>
          current.map((ws) => (ws.id === id ? { ...ws, name: trimmed } : ws)),
        )
      })
    },
    [mutateWorkspace],
  )

  // Cascade-deletes the workspace and all its content in main. If the active
  // workspace is the one removed, fall back to the first remaining one (or the
  // empty state) and drop any now-orphaned chat scope.
  const onDeleteWorkspace = useCallback(
    (id: number) =>
      mutateWorkspace(async () => {
        setConfirmDeleteWorkspace(null)
        setDeletingWorkspaceId(id)
        try {
          await window.api.workspaces.delete(id)
          const ws = workspaces.filter((entry) => entry.id !== id)
          setWorkspaces(ws)
          if (defaultWorkspaceId === id) setDefaultWorkspaceId(null)
          if (activeWorkspaceId === id) {
            setCurrentConversationId(null)
            setActiveDocumentIds([])
            setActiveWorkspaceId(ws.length > 0 ? ws[0]!.id : null)
          }
        } catch (cause) {
          if (activeWorkspaceId === id)
            setSelection((current) => ({ ...current, revision: current.revision + 1 }))
          throw cause
        } finally {
          setDeletingWorkspaceId(null)
        }
      }),
    [activeWorkspaceId, defaultWorkspaceId, workspaces, setActiveWorkspaceId, mutateWorkspace],
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
      <a className="skip-link" href="#workspace-content">
        {t('ux.skipContent')}
      </a>
      <Sidebar
        expanded={expanded}
        pinned={pinned}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activeView={activeView}
        onWorkspaceSelect={onWorkspaceSelect}
        onCreateWorkspace={onCreateWorkspace}
        onRenameWorkspace={onRenameWorkspace}
        workspaceBusy={workspaceLoading || workspaceMutation}
        workspaceError={workspaceError?.message}
        onRetryWorkspaces={workspaceError?.reload ? () => void refreshWorkspaces() : undefined}
        onRequestDeleteWorkspace={setConfirmDeleteWorkspace}
        defaultWorkspaceId={defaultWorkspaceId}
        onSetDefaultWorkspace={(id) => void handleSetDefaultWorkspace(id)}
        onViewChange={setActiveView}
        onTogglePin={togglePin}
        chatViewActive={activeView === 'chat' && !activating}
        workspaceDocs={activating ? [] : workspaceDocs}
        activeDocumentIds={activeDocumentIds}
        onToggleDocument={(id) => void onToggleDocument(id)}
        onClearScope={() => void onClearScope()}
        folders={folders.folders}
        folderError={folders.error}
        onRetryFolders={() => void folders.refresh().catch(() => {})}
        documentError={documentError}
        onRetryDocuments={() => setDocumentRetry((current) => current + 1)}
        folderAssignments={folders.assignments}
        onCreateFolder={(name, parentId) => void folders.createFolder(name, parentId)}
        onRenameFolder={(id, name) => void folders.renameFolder(id, name)}
        onDeleteFolder={(id) => void folders.deleteFolder(id)}
        onMoveDocumentToFolder={(docId, folderId) => void folders.moveDocument(docId, folderId)}
        onToggleFolderScope={(id) => void onToggleFolderScope(id)}
      />
      <main id="workspace-content" tabIndex={-1} className="app-shell__main">
        {activating &&
          !organizerActive &&
          activeView !== 'translation' &&
          activeView !== 'writing' &&
          (activationError?.revision === selection.revision ? (
            <div className="app-shell__switching" role="alert">
              <p className="app-shell__switching-title">
                {t('shell.workspaceOpenFailed', { name: activeWorkspaceName })}
              </p>
              <p className="app-shell__switching-hint">{activationError.message}</p>
              <button
                type="button"
                onClick={() =>
                  setSelection((current) => ({ ...current, revision: current.revision + 1 }))
                }
              >
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <div className="app-shell__switching" role="status" aria-live="polite">
              <div className="app-shell__switching-spinner" aria-hidden="true" />
              <p className="app-shell__switching-title">
                {t(
                  deletingWorkspaceId === activeWorkspaceId
                    ? 'shell.deletingWorkspace'
                    : 'shell.switchingWorkspace',
                  { name: activeWorkspaceName },
                )}
              </p>
              {deletingWorkspaceId !== activeWorkspaceId && (
                <p className="app-shell__switching-hint">{t('shell.switchingWorkspaceHint')}</p>
              )}
            </div>
          ))}
        {!activating && (
          <>
            {activeWorkspaceId == null &&
              activeView !== 'transcription' &&
              activeView !== 'translation' &&
              activeView !== 'writing' &&
              !organizerActive && (
                <div className="app-shell__empty">{t('shell.selectWorkspaceFirst')}</div>
              )}
            {activeView === 'library' && activeWorkspaceId != null && (
              <ViewBoundary>
                <LibraryView
                  workspaceId={activeWorkspaceId}
                  workspaceName={activeWorkspaceName}
                  searchQuery={libraryQuery}
                  onSearchQueryChange={setLibraryQuery}
                  page={libraryPage}
                  onPageChange={setLibraryPage}
                />
              </ViewBoundary>
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
        <KeepAlive active={activeView === 'translation'}>
          <TranslationView />
        </KeepAlive>
        <KeepAlive active={activeView === 'writing'}>
          <WritingView />
        </KeepAlive>
        <KeepAlive active={organizerActive}>
          <OrganizerView view={lastOrganizerView.current} />
        </KeepAlive>
      </main>
      <ModelActivityOverlay />
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
  return (
    <div className={active ? 'app-shell__view' : 'app-shell__view--hidden'}>
      <ViewBoundary>{children}</ViewBoundary>
    </div>
  )
}

function ViewBoundary({ children }: { children: ReactNode }): JSX.Element {
  const t = useT()
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="app-shell__switching" role="status">
            <p>{t('common.loading')}</p>
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

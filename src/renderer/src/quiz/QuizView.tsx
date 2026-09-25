import { useCallback, useEffect, useRef, useState } from 'react'
import type { Document } from '@shared/documents'
import type { QuizDeckSummary, QuizDeckWithQuestions } from '@shared/quiz'
import { QuizListView, reduceProgress, type QuizProgress } from './QuizListView'
import { QuizRunner } from './QuizRunner'
import { CreateQuizDialog } from './CreateQuizDialog'
import { MergeQuizDialog } from './MergeQuizDialog'
import { useGeneration } from '../generation/GenerationContext'
import { useT } from '../i18n'
import { ConfirmModal } from '../chat/ConfirmModal'
import './quiz.css'

type Screen =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'merge' }
  | { kind: 'runner'; deckId: number }
  | { kind: 'results'; deckId: number }

type Props = {
  workspaceId: number
  /** Active workspace name. Surfaced in the list header so the user can see
   *  which workspace the quizzes draw from — the sidebar no longer shows it on
   *  this tab (the "Workspaces" panel is Library/Chat-only now). */
  workspaceName: string
  documents: Document[]
  /** False while the quiz tab is kept mounted but hidden behind another tab.
   *  Forwarded to QuizRunner/QuestionCard so their global (window) keydown
   *  listeners don't bind while hidden and steal keys from the visible view. */
  active?: boolean
}

// Top-level Quiz feature router. Mirrors how ChatView owns conversation state
// internally — QuizView owns deck list state, runner state, and the create
// dialog. Mounting is workspace-scoped (AppShell remounts on workspace switch).
export function QuizView({
  workspaceId,
  workspaceName,
  documents,
  active = true,
}: Props): JSX.Element {
  const t = useT()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteDeck, setDeleteDeck] = useState<QuizDeckSummary | null>(null)
  const [pendingDecks, setPendingDecks] = useState<Set<number>>(new Set())
  const pendingRef = useRef(new Set<number>())
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const [decks, setDecks] = useState<QuizDeckSummary[]>([])
  // streamId → off() handle, kept in state so we can clean up on unmount and
  // on deck deletion. Maps to the active onGenerateEvent subscription.
  const [streamHandles, setStreamHandles] = useState<Map<number, () => void>>(new Map())
  // deckId → streamId of its in-flight generation, so a Cancel button can abort
  // the right stream. Dropped when the stream settles (done/error).
  const [streamIds, setStreamIds] = useState<Map<number, string>>(new Map())
  // deckId → live generation progress, derived from the event stream and fed to
  // QuizListView so each generating deck shows a step label + progress bar.
  const [progress, setProgress] = useState<Map<number, QuizProgress>>(new Map())
  // Mirror the live off() handles into a ref so the unmount cleanup below can
  // tear them all down WITHOUT re-running on every Map change. Keying the
  // cleanup on the state would run the *previous* cleanup each time a new stream
  // is added — killing a still-generating deck's subscription the moment another
  // deck starts (its progress bar would then freeze until the recovery poll).
  const streamHandlesRef = useRef(streamHandles)
  streamHandlesRef.current = streamHandles
  // deckId → end() handle for its generation-registry job, so the TitleBar
  // Activity indicator clears when a deck's generation stream settles.
  const endGenRef = useRef<Map<number, () => void>>(new Map())
  const { begin: beginGeneration } = useGeneration()

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.quiz.listDecks(workspaceId)
      setDecks(list)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Recovery poll: a deck generates in the main process independent of this
  // view. If we weren't mounted for its live event stream (navigated away and
  // back) or it was reconciled to 'failed' by the post-unlock sweep, the only
  // way the list learns the outcome is to re-fetch. Poll while anything is
  // still 'generating'; stops as soon as none are.
  const anyGenerating = decks.some((d) => d.status === 'generating')
  useEffect(() => {
    if (!anyGenerating) return
    const id = setInterval(() => void refresh(), 4000)
    return () => clearInterval(id)
  }, [anyGenerating, refresh])

  // (Resetting `screen` to 'list' on workspace switch is handled by AppShell
  // remounting QuizView via key={activeWorkspaceId} — a fresh mount starts at
  // the initial 'list' screen, so no in-component reset effect is needed.)

  // Cleanup all active stream subscriptions on unmount only (empty deps + ref,
  // so adding/removing a stream mid-session doesn't tear down the others).
  useEffect(() => {
    // endGenRef is a stable ref (only mutated, never reassigned), so capturing
    // .current once at mount is the same Map for the view's lifetime — and keeps
    // the linter happy about reading a ref in a cleanup closure.
    const endGenJobs = endGenRef.current
    return () => {
      for (const off of streamHandlesRef.current.values()) off()
      // Clear any open Activity-indicator jobs so a workspace-switch remount
      // doesn't leave a stale "Building quiz" entry behind.
      for (const end of endGenJobs.values()) end()
      endGenJobs.clear()
    }
  }, [])

  const startGeneration = useCallback(
    (deckId: number) => {
      if (endGenRef.current.has(deckId)) return
      setError(null)
      const streamId = crypto.randomUUID()
      endGenRef.current.set(deckId, beginGeneration('quiz'))
      let finished = false
      const finish = (): void => {
        if (finished) return
        finished = true
        endGenRef.current.get(deckId)?.()
        endGenRef.current.delete(deckId)
        streamHandlesRef.current.get(deckId)?.()
        streamHandlesRef.current.delete(deckId)
        setStreamHandles((prev) => {
          const next = new Map(prev)
          next.delete(deckId)
          return next
        })
        setStreamIds((prev) => {
          const next = new Map(prev)
          next.delete(deckId)
          return next
        })
        setProgress((prev) => {
          const next = new Map(prev)
          next.delete(deckId)
          return next
        })
        void refresh()
      }
      const off = window.api.quiz.onGenerateEvent(streamId, (ev) => {
        if (ev.type === 'done' || ev.type === 'error') {
          finish()
        } else {
          setProgress((prev) => {
            const next = reduceProgress(prev.get(deckId), ev, Date.now())
            return next ? new Map(prev).set(deckId, next) : prev
          })
        }
      })
      streamHandlesRef.current.set(deckId, off)
      setStreamHandles((prev) => new Map(prev).set(deckId, off))
      setStreamIds((prev) => new Map(prev).set(deckId, streamId))
      void window.api.quiz.generate(streamId, deckId).catch((err: unknown) => {
        setError(String(err))
        finish()
      })
    },
    [refresh, beginGeneration],
  )

  // Abort an in-flight generation. The backend flips the deck to
  // 'failed'/'cancelled' (retryable) and emits an 'error' event, which the
  // subscription above turns into a refresh + subscription cleanup.
  const cancelGeneration = useCallback(
    (deckId: number) => {
      const streamId = streamIds.get(deckId)
      if (streamId)
        void window.api.quiz.cancelGenerate(streamId).catch((err: unknown) => setError(String(err)))
    },
    [streamIds],
  )

  const mutateDeck = async (deckId: number, action: () => Promise<unknown>): Promise<void> => {
    if (pendingRef.current.has(deckId)) return
    pendingRef.current.add(deckId)
    setPendingDecks(new Set(pendingRef.current))
    setError(null)
    try {
      await action()
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      pendingRef.current.delete(deckId)
      setPendingDecks(new Set(pendingRef.current))
    }
  }

  if (screen.kind === 'create') {
    return (
      <CreateQuizDialog
        workspaceId={workspaceId}
        documents={documents}
        onCancel={() => setScreen({ kind: 'list' })}
        onCreated={(deck) => {
          startGeneration(deck.id)
          void refresh()
          setScreen({ kind: 'list' })
        }}
      />
    )
  }

  if (screen.kind === 'merge') {
    return (
      <MergeQuizDialog
        workspaceId={workspaceId}
        decks={decks.filter((d) => d.status === 'ready')}
        onCancel={() => setScreen({ kind: 'list' })}
        onMerged={() => {
          void refresh()
          setScreen({ kind: 'list' })
        }}
      />
    )
  }

  if (screen.kind === 'runner') {
    return (
      <QuizRunner
        deckId={screen.deckId}
        active={active}
        onClose={() => {
          void refresh()
          setScreen({ kind: 'list' })
        }}
      />
    )
  }

  return (
    <>
      {error && (
        <div className="quiz-workflow-error" role="alert">
          <span>
            {t('quiz.list.actionFailed')} {error}
          </span>
          <button
            className="quiz-btn"
            onClick={() => {
              setError(null)
              void refresh()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      )}
      <QuizListView
        decks={decks}
        loading={loading}
        failed={error !== null}
        pendingDecks={pendingDecks}
        workspaceName={workspaceName}
        progress={progress}
        onCreate={() => setScreen({ kind: 'create' })}
        onMerge={() => setScreen({ kind: 'merge' })}
        onStart={(deckId) => setScreen({ kind: 'runner', deckId })}
        onDelete={(deckId) => setDeleteDeck(decks.find((deck) => deck.id === deckId) ?? null)}
        onRetry={(deckId) =>
          void mutateDeck(deckId, async () => {
            await window.api.quiz.regenerateDeck(deckId)
            startGeneration(deckId)
          })
        }
        onCancel={cancelGeneration}
      />
      {deleteDeck && (
        <ConfirmModal
          title={t('quiz.list.deleteDeck')}
          body={t('quiz.list.deleteConfirm', { name: deleteDeck.name })}
          onCancel={() => setDeleteDeck(null)}
          onConfirm={() => {
            const id = deleteDeck.id
            setDeleteDeck(null)
            void mutateDeck(id, () => window.api.quiz.deleteDeck(id))
          }}
        />
      )}
    </>
  )
}

// Re-export so AppShell can use the same shape lookup
export type QuizGetDeck = (deckId: number) => Promise<QuizDeckWithQuestions>

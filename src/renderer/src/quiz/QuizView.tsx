import { useCallback, useEffect, useState } from 'react'
import type { Document } from '@shared/documents'
import type { QuizDeckSummary, QuizDeckWithQuestions } from '@shared/quiz'
import { QuizListView, type QuizProgress } from './QuizListView'
import { QuizRunner } from './QuizRunner'
import { CreateQuizDialog } from './CreateQuizDialog'
import './quiz.css'

type Screen =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'runner'; deckId: number }
  | { kind: 'results'; deckId: number }

type Props = {
  workspaceId: number
  documents: Document[]
}

// Top-level Quiz feature router. Mirrors how ChatView owns conversation state
// internally — QuizView owns deck list state, runner state, and the create
// dialog. Mounting is workspace-scoped (AppShell remounts on workspace switch).
export function QuizView({ workspaceId, documents }: Props): JSX.Element {
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

  const refresh = useCallback(async () => {
    const list = await window.api.quiz.listDecks(workspaceId)
    setDecks(list)
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Reset to list whenever the workspace switches. The runner/create flows
  // are workspace-scoped and shouldn't persist across switches.
  useEffect(() => {
    setScreen({ kind: 'list' })
  }, [workspaceId])

  // Cleanup all active stream subscriptions on unmount.
  useEffect(() => {
    return () => {
      for (const off of streamHandles.values()) off()
    }
  }, [streamHandles])

  const startGeneration = useCallback(
    (deckId: number) => {
      const streamId = crypto.randomUUID()
      const off = window.api.quiz.onGenerateEvent(streamId, (ev) => {
        if (ev.type === 'done' || ev.type === 'error') {
          void refresh()
          // Drop the live progress entry — the deck card flips to ready/failed
          // on refresh and shouldn't keep a stale bar.
          setProgress((prev) => {
            const next = new Map(prev)
            next.delete(deckId)
            return next
          })
          // After the stream settles we can drop the subscription.
          setStreamHandles((prev) => {
            const next = new Map(prev)
            const handle = next.get(deckId)
            if (handle) handle()
            next.delete(deckId)
            return next
          })
          setStreamIds((prev) => {
            const next = new Map(prev)
            next.delete(deckId)
            return next
          })
        } else if (ev.type === 'stage') {
          setProgress((prev) => new Map(prev).set(deckId, { stage: ev.stage }))
        } else if (ev.type === 'doc-themes') {
          setProgress((prev) =>
            new Map(prev).set(deckId, {
              stage: 'extracting-themes',
              docIndex: ev.docIndex,
              docTotal: ev.docTotal,
            }),
          )
        } else if (ev.type === 'question') {
          setProgress((prev) =>
            new Map(prev).set(deckId, {
              stage: 'generating-questions',
              ordinal: ev.ordinal,
              total: ev.total,
            }),
          )
        }
      })
      setStreamHandles((prev) => new Map(prev).set(deckId, off))
      setStreamIds((prev) => new Map(prev).set(deckId, streamId))
      void window.api.quiz.generate(streamId, deckId)
    },
    [refresh],
  )

  // Abort an in-flight generation. The backend flips the deck to
  // 'failed'/'cancelled' (retryable) and emits an 'error' event, which the
  // subscription above turns into a refresh + subscription cleanup.
  const cancelGeneration = useCallback(
    (deckId: number) => {
      const streamId = streamIds.get(deckId)
      if (streamId) void window.api.quiz.cancelGenerate(streamId)
    },
    [streamIds],
  )

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

  if (screen.kind === 'runner') {
    return (
      <QuizRunner
        deckId={screen.deckId}
        onClose={() => {
          void refresh()
          setScreen({ kind: 'list' })
        }}
      />
    )
  }

  return (
    <QuizListView
      decks={decks}
      progress={progress}
      onCreate={() => setScreen({ kind: 'create' })}
      onStart={(deckId) => setScreen({ kind: 'runner', deckId })}
      onDelete={async (deckId) => {
        await window.api.quiz.deleteDeck(deckId)
        await refresh()
      }}
      onRetry={async (deckId) => {
        await window.api.quiz.regenerateDeck(deckId)
        startGeneration(deckId)
        await refresh()
      }}
      onCancel={cancelGeneration}
    />
  )
}

// Re-export so AppShell can use the same shape lookup
export type QuizGetDeck = (deckId: number) => Promise<QuizDeckWithQuestions>

import { useCallback, useEffect, useState } from 'react'
import type { Document } from '@shared/documents'
import type { QuizDeckSummary, QuizDeckWithQuestions } from '@shared/quiz'
import { QuizListView } from './QuizListView'
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
          // After the stream settles we can drop the subscription.
          setStreamHandles((prev) => {
            const next = new Map(prev)
            const handle = next.get(deckId)
            if (handle) handle()
            next.delete(deckId)
            return next
          })
        } else if (ev.type === 'question') {
          // Question-level progress doesn't need a refresh — the list view
          // shows stage label from a separate state we don't track here.
          // A targeted refresh on done is enough for accuracy.
        }
      })
      setStreamHandles((prev) => new Map(prev).set(deckId, off))
      void window.api.quiz.generate(streamId, deckId)
    },
    [refresh],
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
    />
  )
}

// Re-export so AppShell can use the same shape lookup
export type QuizGetDeck = (deckId: number) => Promise<QuizDeckWithQuestions>

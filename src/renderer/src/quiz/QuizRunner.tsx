import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QuizAttempt, QuizDeckWithQuestions, QuizQuestion } from '@shared/quiz'
import { QuestionCard } from './QuestionCard'
import { QuizResults } from './QuizResults'
import { SourceViewer } from '../chat/SourceViewer'
import { ErrorBoundary } from '../ErrorBoundary'

type Props = {
  deckId: number
  onClose: () => void
}

type RunnerState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'running'
      data: QuizDeckWithQuestions
      attempt: QuizAttempt
      order: QuizQuestion[]
      cursor: number
      selectedByQuestionId: Map<number, number>
      revealed: boolean
    }
  | { kind: 'finished'; attempt: QuizAttempt; data: QuizDeckWithQuestions; order: QuizQuestion[] }

// Fisher–Yates seeded by the attempt id so the shuffle is deterministic within
// an attempt (re-renders don't reshuffle) but varies across attempts.
function shuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice()
  let s = seed | 0
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) | 0
    return (s >>> 0) / 0xffffffff
  }
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a
}

export function QuizRunner({ deckId, onClose }: Props): JSX.Element {
  const [state, setState] = useState<RunnerState>({ kind: 'loading' })
  const [sourceChunkId, setSourceChunkId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const data = await window.api.quiz.getDeck(deckId)
        const attempt = await window.api.quiz.startAttempt(deckId)
        if (cancelled) return
        const order = shuffle(data.questions, attempt.id)
        setState({
          kind: 'running',
          data,
          attempt,
          order,
          cursor: 0,
          selectedByQuestionId: new Map(),
          revealed: false,
        })
      } catch (err) {
        if (cancelled) return
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [deckId])

  const onSelect = useCallback((idx: number) => {
    setState((prev) => {
      if (prev.kind !== 'running' || prev.revealed) return prev
      const q = prev.order[prev.cursor]
      if (!q) return prev
      const next = new Map(prev.selectedByQuestionId)
      next.set(q.id, idx)
      return { ...prev, selectedByQuestionId: next, revealed: true }
    })
  }, [])

  const advance = useCallback(() => {
    setState((prev) => {
      if (prev.kind !== 'running') return prev
      if (prev.cursor + 1 >= prev.order.length) {
        // Trigger finish from a side effect below — we can't await here.
        return { ...prev, cursor: prev.order.length }
      }
      return { ...prev, cursor: prev.cursor + 1, revealed: false }
    })
  }, [])

  // Auto-finish when cursor reaches order.length.
  const finishedRef = useRef(false)
  useEffect(() => {
    if (state.kind !== 'running') return
    if (state.cursor < state.order.length) return
    if (finishedRef.current) return
    finishedRef.current = true
    const submit = async (): Promise<void> => {
      const answers = state.order.map((q) => ({
        questionId: q.id,
        selectedIndex: state.selectedByQuestionId.get(q.id) ?? -1,
      }))
      // -1 sentinel for unanswered (e.g. user advanced without picking — not
      // possible with current UX, but defensive). Send 0 to satisfy the
      // validation on the server, marked wrong via correctness check there.
      const payload = answers.map((a) => ({
        questionId: a.questionId,
        selectedIndex: a.selectedIndex < 0 ? 0 : a.selectedIndex,
      }))
      const attempt = await window.api.quiz.finishAttempt(state.attempt.id, payload)
      setState({ kind: 'finished', attempt, data: state.data, order: state.order })
    }
    void submit()
  }, [state])

  // Enter advances after reveal.
  useEffect(() => {
    if (state.kind !== 'running' || !state.revealed) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        advance()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [state, advance])

  const onCite = useCallback((chunkId: number) => setSourceChunkId(chunkId), [])

  if (state.kind === 'loading') {
    return (
      <section className="quiz-runner">
        <p>Loading…</p>
      </section>
    )
  }
  if (state.kind === 'error') {
    return (
      <section className="quiz-runner">
        <p className="quiz-create__error">{state.message}</p>
        <button type="button" className="quiz-btn" onClick={onClose}>
          Back
        </button>
      </section>
    )
  }
  if (state.kind === 'finished') {
    return (
      <QuizResults
        deck={state.data.deck}
        attempt={state.attempt}
        questions={state.order}
        selectedByQuestionId={
          new Map(state.attempt.answers.map((a) => [a.questionId, a.selectedIndex]))
        }
        onClose={onClose}
      />
    )
  }

  // After the last 'Finish' click, advance() bumps cursor to order.length;
  // the submit useEffect fires the IPC + flips state to 'finished'. Render a
  // placeholder for that gap so we don't deref state.order[order.length].
  if (state.cursor >= state.order.length) {
    return (
      <section className="quiz-runner">
        <p className="quiz-runner__progress">Scoring…</p>
      </section>
    )
  }

  const question = state.order[state.cursor]!
  return (
    <section className="quiz-runner">
      <header className="quiz-runner__header">
        <div>
          <h2>{state.data.deck.name}</h2>
          <p className="quiz-runner__progress">
            Question {state.cursor + 1} / {state.order.length}
          </p>
        </div>
        <Stopwatch startedAt={state.attempt.startedAt} />
        <button type="button" className="quiz-btn" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="quiz-runner__body">
        <RunnerContent
          question={question}
          selectedIndex={state.selectedByQuestionId.get(question.id) ?? null}
          revealed={state.revealed}
          onSelect={onSelect}
          onCite={onCite}
        />
        {state.revealed && (
          <div className="quiz-runner__footer">
            <button type="button" className="quiz-btn quiz-btn--primary" onClick={advance}>
              {state.cursor + 1 >= state.order.length ? 'Finish' : 'Next'}
            </button>
          </div>
        )}
      </div>
      {sourceChunkId != null && (
        <div
          className="quiz-source-modal"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSourceChunkId(null)
          }}
        >
          <div className="quiz-source-modal__panel">
            <ErrorBoundary label="Source preview" onError={() => setSourceChunkId(null)}>
              <SourceViewer
                chunkId={sourceChunkId}
                documentTitle={null}
                onClose={() => setSourceChunkId(null)}
              />
            </ErrorBoundary>
          </div>
        </div>
      )}
    </section>
  )
}

// Memoless wrapper — the question/cursor key forces a fresh QuestionCard mount
// per advance so the keyboard listener inside doesn't bleed across questions.
function RunnerContent({
  question,
  selectedIndex,
  revealed,
  onSelect,
  onCite,
}: {
  question: QuizQuestion
  selectedIndex: number | null
  revealed: boolean
  onSelect: (i: number) => void
  onCite: (c: number) => void
}): JSX.Element {
  return (
    <QuestionCard
      key={question.id}
      question={question}
      selectedIndex={selectedIndex}
      revealed={revealed}
      onSelect={onSelect}
      onCite={onCite}
    />
  )
}

function Stopwatch({ startedAt }: { startedAt: number }): JSX.Element {
  const startedMs = useMemo(() => startedAt * 1000, [startedAt])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsed = Math.max(0, Math.floor((now - startedMs) / 1000))
  const mm = Math.floor(elapsed / 60)
  const ss = elapsed % 60
  return (
    <span className="quiz-runner__time" aria-label="Elapsed time">
      {mm}:{ss.toString().padStart(2, '0')}
    </span>
  )
}

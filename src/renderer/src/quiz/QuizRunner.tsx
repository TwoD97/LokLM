import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QuizAttempt, QuizDeckWithQuestions, QuizQuestion } from '@shared/quiz'
import { QuestionCard } from './QuestionCard'
import { QuizResults } from './QuizResults'
import { SourceViewer } from '../chat/SourceViewer'
import { ErrorBoundary } from '../ErrorBoundary'
import { useT, type TFn } from '../i18n'

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
      /** Per-question option permutation: optionPerms.get(questionId)[displayIdx]
       *  = originalIdx. Built once at attempt start and re-applied across
       *  re-renders so option order stays stable within one attempt. Retaking
       *  the same deck produces a different permutation. */
      optionPerms: Map<number, number[]>
      cursor: number
      /** Stored in DISPLAY coordinates while the quiz runs. Translated to
       *  ORIGINAL via optionPerms at finishAttempt submit so the backend can
       *  score against the persisted correct_index. */
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

function permutation(length: number, seed: number): number[] {
  return shuffle(
    Array.from({ length }, (_, i) => i),
    seed,
  )
}

export function QuizRunner({ deckId, onClose }: Props): JSX.Element {
  const t = useT()
  const [state, setState] = useState<RunnerState>({ kind: 'loading' })
  const [source, setSource] = useState<{ chunkId: number; explanation: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const data = await window.api.quiz.getDeck(deckId)
        const attempt = await window.api.quiz.startAttempt(deckId)
        if (cancelled) return
        const order = shuffle(data.questions, attempt.id)
        // Seed each option permutation with (attempt.id * 31 + question.id)
        // so a re-take of the same deck reshuffles options too, while a
        // re-render mid-attempt keeps them stable.
        const optionPerms = new Map<number, number[]>()
        for (const q of data.questions) {
          optionPerms.set(q.id, permutation(q.options.length, attempt.id * 31 + q.id))
        }
        setState({
          kind: 'running',
          data,
          attempt,
          order,
          optionPerms,
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
      // Map each question's display-coord selection back to the original
      // option index via its perm so the backend can score against the
      // persisted correct_index. -1 (unanswered) becomes 0 — the server will
      // mark it wrong unless the correct answer happens to live at index 0,
      // which is fine since the current UX prevents unanswered submissions.
      const payload = state.order.map((q) => {
        const displayIdx = state.selectedByQuestionId.get(q.id) ?? -1
        const perm = state.optionPerms.get(q.id) ?? q.options.map((_, i) => i)
        const originalIdx = displayIdx < 0 ? 0 : (perm[displayIdx] ?? 0)
        return { questionId: q.id, selectedIndex: originalIdx }
      })
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

  const onCite = useCallback(
    ({ chunkId, explanation }: { chunkId: number; explanation: string }) => {
      setSource({ chunkId, explanation })
    },
    [],
  )

  if (state.kind === 'loading') {
    return (
      <section className="quiz-runner">
        <p>{t('common.loading')}</p>
      </section>
    )
  }
  if (state.kind === 'error') {
    return (
      <section className="quiz-runner">
        <p className="quiz-create__error">{state.message}</p>
        <button type="button" className="quiz-btn" onClick={onClose}>
          {t('common.back')}
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
        <p className="quiz-runner__progress">{t('quiz.runner.scoring')}</p>
      </section>
    )
  }

  const question = state.order[state.cursor]!
  const perm = state.optionPerms.get(question.id) ?? question.options.map((_, i) => i)
  const displayQuestion: QuizQuestion = {
    ...question,
    options: perm.map((origIdx) => question.options[origIdx]!),
    correctIndex: perm.indexOf(question.correctIndex),
  }
  return (
    <section className="quiz-runner">
      <header className="quiz-runner__header">
        <div>
          <h2>{state.data.deck.name}</h2>
          <p className="quiz-runner__progress">
            {t('quiz.runner.progress', {
              current: state.cursor + 1,
              total: state.order.length,
            })}
          </p>
        </div>
        <Stopwatch startedAt={state.attempt.startedAt} t={t} />
        <button type="button" className="quiz-btn" onClick={onClose}>
          {t('common.close')}
        </button>
      </header>
      <div className="quiz-runner__body">
        <RunnerContent
          question={displayQuestion}
          selectedIndex={state.selectedByQuestionId.get(question.id) ?? null}
          revealed={state.revealed}
          onSelect={onSelect}
          onCite={onCite}
        />
        {state.revealed && (
          <div className="quiz-runner__footer">
            <button type="button" className="quiz-btn quiz-btn--primary" onClick={advance}>
              {state.cursor + 1 >= state.order.length ? t('quiz.runner.finish') : t('common.next')}
            </button>
          </div>
        )}
      </div>
      {source != null && (
        // SourceViewer renders its own backdrop + role=dialog modal — no extra
        // wrapper here.
        <ErrorBoundary label="Source preview" onError={() => setSource(null)}>
          <SourceViewer
            chunkId={source.chunkId}
            messageText={source.explanation}
            documentTitle={null}
            onClose={() => setSource(null)}
          />
        </ErrorBoundary>
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
  onCite: (args: { chunkId: number; explanation: string }) => void
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

function Stopwatch({ startedAt, t }: { startedAt: number; t: TFn }): JSX.Element {
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
    <span className="quiz-runner__time" aria-label={t('quiz.runner.elapsedTime')}>
      {mm}:{ss.toString().padStart(2, '0')}
    </span>
  )
}

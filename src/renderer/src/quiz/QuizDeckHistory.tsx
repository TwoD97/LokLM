import { useEffect, useState } from 'react'
import type { QuizAttempt } from '@shared/quiz'

type Props = {
  deckId: number
  /** Total questions in the deck — used to render the % for each attempt. */
  questionCount: number
}

// Lazily fetches the attempt history for one deck and renders a compact list.
// Mounted by the deck card only when the user expands the history, so we don't
// pay the IPC cost for every deck on every list render.
export function QuizDeckHistory({ deckId, questionCount }: Props): JSX.Element {
  const [attempts, setAttempts] = useState<QuizAttempt[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.quiz
      .listAttempts(deckId)
      .then((list) => {
        if (!cancelled) setAttempts(list.filter((a) => a.finishedAt != null))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [deckId])

  if (error) return <p className="quiz-history__empty">{error}</p>
  if (attempts === null) return <p className="quiz-history__empty">Loading history…</p>
  if (attempts.length === 0) return <p className="quiz-history__empty">No attempts yet.</p>

  return (
    <ul className="quiz-history">
      {attempts.map((a) => (
        <AttemptRow key={a.id} attempt={a} questionCount={questionCount} />
      ))}
    </ul>
  )
}

function AttemptRow({
  attempt,
  questionCount,
}: {
  attempt: QuizAttempt
  questionCount: number
}): JSX.Element {
  const score = attempt.score ?? 0
  const pct = questionCount > 0 ? Math.round((score / questionCount) * 100) : 0
  const tone = scoreTone(pct)
  return (
    <li className={`quiz-history__row quiz-history__row--${tone}`}>
      <span className="quiz-history__date">
        {formatDate(attempt.finishedAt ?? attempt.startedAt)}
      </span>
      <span className="quiz-history__score">
        {score} / {questionCount}
      </span>
      <span className="quiz-history__pct">{pct}%</span>
      <span className="quiz-history__duration">
        {formatDuration(attempt.startedAt, attempt.finishedAt)}
      </span>
    </li>
  )
}

export function scoreTone(pct: number): 'good' | 'mid' | 'low' {
  if (pct >= 80) return 'good'
  if (pct >= 50) return 'mid'
  return 'low'
}

function formatDate(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

function formatDuration(startedAt: number, finishedAt: number | null): string {
  if (finishedAt == null) return '—'
  const secs = Math.max(0, finishedAt - startedAt)
  const mm = Math.floor(secs / 60)
  const ss = secs % 60
  return `${mm}:${ss.toString().padStart(2, '0')}`
}

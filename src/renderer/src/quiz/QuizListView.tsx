import { useState } from 'react'
import {
  Plus,
  Play,
  RotateCcw,
  Trash2,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  History,
} from 'lucide-react'
import type { QuizDeckSummary } from '@shared/quiz'
import { QuizDeckHistory, scoreTone } from './QuizDeckHistory'

type Props = {
  decks: QuizDeckSummary[]
  onCreate: () => void
  onStart: (deckId: number) => void
  onDelete: (deckId: number) => void
  onRetry: (deckId: number) => void
}

export function QuizListView({ decks, onCreate, onStart, onDelete, onRetry }: Props): JSX.Element {
  // Per-deck expansion state — kept here rather than inside the card so the
  // history component remounts (and re-fetches) when the user re-opens.
  const [openHistory, setOpenHistory] = useState<Set<number>>(new Set())
  const toggleHistory = (id: number): void => {
    setOpenHistory((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="quiz-list">
      <header className="quiz-list__header">
        <h2>Quizzes</h2>
        <button type="button" className="quiz-btn quiz-btn--primary" onClick={onCreate}>
          <Plus size={16} strokeWidth={2.5} />
          New Quiz
        </button>
      </header>
      {decks.length === 0 ? (
        <p className="quiz-list__empty">
          No quizzes yet. Create one to start learning from your documents.
        </p>
      ) : (
        <ul className="quiz-list__items">
          {decks.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              historyOpen={openHistory.has(deck.id)}
              onToggleHistory={() => toggleHistory(deck.id)}
              onStart={() => onStart(deck.id)}
              onDelete={() => onDelete(deck.id)}
              onRetry={() => onRetry(deck.id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function DeckCard({
  deck,
  historyOpen,
  onToggleHistory,
  onStart,
  onDelete,
  onRetry,
}: {
  deck: QuizDeckSummary
  historyOpen: boolean
  onToggleHistory: () => void
  onStart: () => void
  onDelete: () => void
  onRetry: () => void
}): JSX.Element {
  const tone =
    deck.lastScore != null && deck.questionCount > 0
      ? scoreTone(Math.round((deck.lastScore / deck.questionCount) * 100))
      : null

  return (
    <li className={`quiz-card quiz-card--${deck.status}${tone ? ` quiz-card--tone-${tone}` : ''}`}>
      <div className="quiz-card__head">
        <h3 className="quiz-card__name">{deck.name}</h3>
        <StatusBadge status={deck.status} />
      </div>
      <div className="quiz-card__meta">
        <span className="quiz-card__meta-chip">{deck.questionCount} questions</span>
        <span className="quiz-card__meta-chip">
          {deck.documentIds.length} file{deck.documentIds.length === 1 ? '' : 's'}
        </span>
        <span className="quiz-card__meta-chip">{deck.language.toUpperCase()}</span>
      </div>
      {deck.lastScore != null && (
        <ScoreStrip
          score={deck.lastScore}
          total={deck.questionCount}
          attempts={deck.attemptCount}
        />
      )}
      {deck.status === 'failed' && deck.error && <p className="quiz-card__error">{deck.error}</p>}
      <div className="quiz-card__actions">
        {deck.attemptCount > 0 && (
          <button
            type="button"
            className="quiz-btn quiz-btn--ghost"
            onClick={onToggleHistory}
            aria-expanded={historyOpen}
            aria-label={historyOpen ? 'Hide history' : 'Show history'}
          >
            <History size={14} strokeWidth={2.5} />
            History
            {historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        <div className="quiz-card__actions-spacer" />
        {deck.status === 'ready' && (
          <button type="button" className="quiz-btn quiz-btn--primary" onClick={onStart}>
            <Play size={14} strokeWidth={2.5} />
            Start
          </button>
        )}
        {deck.status === 'failed' && (
          <button type="button" className="quiz-btn" onClick={onRetry}>
            <RotateCcw size={14} strokeWidth={2.5} />
            Retry
          </button>
        )}
        <button
          type="button"
          className="quiz-btn quiz-btn--danger"
          onClick={onDelete}
          aria-label="Delete deck"
          title="Delete deck"
        >
          <Trash2 size={14} strokeWidth={2.5} />
        </button>
      </div>
      {historyOpen && (
        <div className="quiz-card__history-wrap">
          <QuizDeckHistory deckId={deck.id} questionCount={deck.questionCount} />
        </div>
      )}
    </li>
  )
}

function ScoreStrip({
  score,
  total,
  attempts,
}: {
  score: number
  total: number
  attempts: number
}): JSX.Element {
  const pct = total > 0 ? Math.round((score / total) * 100) : 0
  const tone = scoreTone(pct)
  return (
    <div className="quiz-card__score-strip">
      <div className="quiz-card__score-bar">
        <div
          className={`quiz-card__score-bar-fill quiz-card__score-bar-fill--${tone}`}
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      <span className={`quiz-card__score-num quiz-card__score-num--${tone}`}>
        {score} / {total}
      </span>
      <span className="quiz-card__score-attempts">
        {attempts} attempt{attempts === 1 ? '' : 's'}
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: 'generating' | 'ready' | 'failed' }): JSX.Element {
  if (status === 'generating') {
    return (
      <span className="quiz-badge quiz-badge--generating">
        <Loader2 size={12} className="quiz-spin" /> Generating…
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="quiz-badge quiz-badge--failed">
        <AlertTriangle size={12} /> Failed
      </span>
    )
  }
  return <span className="quiz-badge quiz-badge--ready">Ready</span>
}

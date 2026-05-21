import { Plus, Play, RotateCcw, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import type { QuizDeckSummary } from '@shared/quiz'

type Props = {
  decks: QuizDeckSummary[]
  onCreate: () => void
  onStart: (deckId: number) => void
  onDelete: (deckId: number) => void
  onRetry: (deckId: number) => void
}

export function QuizListView({ decks, onCreate, onStart, onDelete, onRetry }: Props): JSX.Element {
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
            <li key={deck.id} className="quiz-card">
              <div className="quiz-card__head">
                <h3 className="quiz-card__name">{deck.name}</h3>
                <StatusBadge status={deck.status} />
              </div>
              <div className="quiz-card__meta">
                <span>
                  {deck.questionCount} Q · {deck.documentIds.length} file
                  {deck.documentIds.length === 1 ? '' : 's'} · {deck.language.toUpperCase()}
                </span>
                {deck.lastScore != null && (
                  <span className="quiz-card__score">
                    last: {deck.lastScore}/{deck.questionCount} · {deck.attemptCount} attempt
                    {deck.attemptCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              {deck.status === 'failed' && deck.error && (
                <p className="quiz-card__error">{deck.error}</p>
              )}
              <div className="quiz-card__actions">
                {deck.status === 'ready' && (
                  <button
                    type="button"
                    className="quiz-btn quiz-btn--primary"
                    onClick={() => onStart(deck.id)}
                  >
                    <Play size={14} strokeWidth={2.5} />
                    Start
                  </button>
                )}
                {deck.status === 'failed' && (
                  <button type="button" className="quiz-btn" onClick={() => onRetry(deck.id)}>
                    <RotateCcw size={14} strokeWidth={2.5} />
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  className="quiz-btn quiz-btn--danger"
                  onClick={() => onDelete(deck.id)}
                  aria-label="Delete deck"
                  title="Delete deck"
                >
                  <Trash2 size={14} strokeWidth={2.5} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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

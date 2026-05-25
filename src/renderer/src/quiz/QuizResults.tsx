import type { QuizAttempt, QuizDeck, QuizQuestion } from '@shared/quiz'
import { QuizDeckHistory, scoreTone } from './QuizDeckHistory'
import { useT } from '../i18n'

type Props = {
  deck: QuizDeck
  attempt: QuizAttempt
  questions: QuizQuestion[]
  selectedByQuestionId: Map<number, number>
  onClose: () => void
}

function formatDuration(startedAt: number, finishedAt: number | null): string {
  if (finishedAt == null) return '—'
  const secs = Math.max(0, finishedAt - startedAt)
  const mm = Math.floor(secs / 60)
  const ss = secs % 60
  return `${mm}:${ss.toString().padStart(2, '0')}`
}

export function QuizResults({
  deck,
  attempt,
  questions,
  selectedByQuestionId,
  onClose,
}: Props): JSX.Element {
  const t = useT()
  const total = questions.length
  const score = attempt.score ?? 0
  const pct = total > 0 ? Math.round((score / total) * 100) : 0
  const tone = scoreTone(pct)
  return (
    <section className="quiz-runner">
      <header className="quiz-runner__header">
        <div>
          <h2>{deck.name}</h2>
          <p className="quiz-runner__progress">{t('quiz.results.heading')}</p>
        </div>
        <button type="button" className="quiz-btn" onClick={onClose}>
          {t('quiz.results.backToList')}
        </button>
      </header>
      <div className={`quiz-results__summary quiz-results__summary--${tone}`}>
        <div className="quiz-results__score">
          <span className="quiz-results__score-num">
            {score} / {total}
          </span>
          <span className="quiz-results__score-pct">{pct}%</span>
        </div>
        <p className="quiz-results__time">
          {t('quiz.results.completedIn', {
            duration: formatDuration(attempt.startedAt, attempt.finishedAt),
          })}
        </p>
      </div>
      <section className="quiz-results__history-section">
        <h3 className="quiz-results__history-title">{t('quiz.results.yourAttempts')}</h3>
        <QuizDeckHistory deckId={deck.id} questionCount={total} />
      </section>
      <ol className="quiz-results__list">
        {questions.map((q, i) => {
          const picked = selectedByQuestionId.get(q.id)
          const correct = picked === q.correctIndex
          return (
            <li key={q.id} className={`quiz-results__row ${correct ? 'is-correct' : 'is-wrong'}`}>
              <span className="quiz-results__row-num">{i + 1}.</span>
              <div className="quiz-results__row-body">
                <p className="quiz-results__row-stem">{q.stem}</p>
                <p className="quiz-results__row-detail">
                  {correct
                    ? t('quiz.results.correct')
                    : t('quiz.results.yourAnswer', {
                        answer: q.options[picked ?? -1] ?? '—',
                      })}
                  {!correct && (
                    <>
                      {' · '}
                      {t('quiz.results.correctAnswer', {
                        answer: q.options[q.correctIndex] ?? '—',
                      })}
                    </>
                  )}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

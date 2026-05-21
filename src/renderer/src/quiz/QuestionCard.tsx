import { useEffect } from 'react'
import type { QuizQuestion } from '@shared/quiz'

type Props = {
  question: QuizQuestion
  selectedIndex: number | null
  /** Once a question is revealed, the parent freezes the selection and shows
   *  the explanation. The 'Next' button (in the runner) advances. */
  revealed: boolean
  onSelect: (index: number) => void
  /** Click handler for the citation chip. Receives the primary source chunk
   *  id; runner forwards to SourceViewer. */
  onCite: (chunkId: number) => void
}

// Reveals correct/wrong styling once `revealed` flips true. Keyboard 1–4
// picks an option while unanswered; once revealed, keys are ignored (Enter is
// handled by the parent runner).
export function QuestionCard({
  question,
  selectedIndex,
  revealed,
  onSelect,
  onCite,
}: Props): JSX.Element {
  useEffect(() => {
    if (revealed) return
    const handler = (e: KeyboardEvent): void => {
      const idx = ['1', '2', '3', '4'].indexOf(e.key)
      if (idx >= 0) {
        onSelect(idx)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [revealed, onSelect])

  return (
    <article className="quiz-card-q">
      <p className="quiz-card-q__stem">{question.stem}</p>
      <ul className="quiz-card-q__opts">
        {question.options.map((opt, i) => {
          const isPicked = selectedIndex === i
          const isCorrect = i === question.correctIndex
          let state = 'idle'
          if (revealed) {
            if (isCorrect) state = 'correct'
            else if (isPicked) state = 'wrong'
            else state = 'dimmed'
          } else if (isPicked) {
            state = 'picked'
          }
          return (
            <li key={i}>
              <button
                type="button"
                className={`quiz-opt quiz-opt--${state}`}
                onClick={() => !revealed && onSelect(i)}
                disabled={revealed}
              >
                <span className="quiz-opt__key">{i + 1}</span>
                <span className="quiz-opt__text">{opt}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {revealed && (
        <div className="quiz-card-q__reveal">
          <p className="quiz-card-q__explanation">{question.explanation}</p>
          {question.sourceChunkIds.length > 0 && (
            <button
              type="button"
              className="quiz-citation"
              onClick={() => onCite(question.sourceChunkIds[0]!)}
            >
              View source
            </button>
          )}
        </div>
      )}
    </article>
  )
}

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QuizResults } from './QuizResults'
import type { QuizAttempt, QuizDeck, QuizQuestion } from '@shared/quiz'

const NOW = Math.floor(Date.now() / 1000)

function makeDeck(): QuizDeck {
  return {
    id: 7,
    workspaceId: 1,
    name: 'Stats 101',
    documentIds: [1],
    questionCount: 2,
    status: 'ready',
    error: null,
    language: 'en',
    createdAt: NOW,
  }
}

const QUESTIONS: QuizQuestion[] = [
  {
    id: 1,
    deckId: 7,
    ordinal: 0,
    stem: 'What is the median?',
    options: ['mean', 'middle value', 'mode', 'range'],
    correctIndex: 1,
    explanation: 'Sort and take the middle.',
    sourceChunkIds: [42],
    themeTitle: 'Descriptive stats',
  },
  {
    id: 2,
    deckId: 7,
    ordinal: 1,
    stem: 'What is the mean?',
    options: ['median', 'sum / count', 'mode', 'variance'],
    correctIndex: 1,
    explanation: 'Average value.',
    sourceChunkIds: [43],
    themeTitle: 'Descriptive stats',
  },
]

function makeAttempt(score: number, durationSeconds = 270): QuizAttempt {
  return {
    id: 99,
    deckId: 7,
    startedAt: NOW - durationSeconds,
    finishedAt: NOW,
    score,
    answers: [],
  }
}

describe('QuizResults', () => {
  it('renders the score numerator, total, and percentage', () => {
    // Stub the history fetch — QuizResults embeds QuizDeckHistory.
    vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([])
    render(
      <QuizResults
        deck={makeDeck()}
        attempt={makeAttempt(2)}
        questions={QUESTIONS}
        selectedByQuestionId={
          new Map([
            [1, 1],
            [2, 1],
          ])
        }
        onClose={() => undefined}
      />,
    )
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('renders the duration as mm:ss', () => {
    vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([])
    render(
      <QuizResults
        deck={makeDeck()}
        attempt={makeAttempt(1, 270)} // 4:30
        questions={QUESTIONS}
        selectedByQuestionId={
          new Map([
            [1, 1],
            [2, 0],
          ])
        }
        onClose={() => undefined}
      />,
    )
    expect(screen.getByText(/Completed in 4:30/)).toBeInTheDocument()
  })

  it('applies the tone-coloured summary class based on score percentage', () => {
    vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([])
    const { container } = render(
      <QuizResults
        deck={makeDeck()}
        attempt={makeAttempt(2)}
        questions={QUESTIONS}
        selectedByQuestionId={
          new Map([
            [1, 1],
            [2, 1],
          ])
        }
        onClose={() => undefined}
      />,
    )
    expect(container.querySelector('.quiz-results__summary--good')).not.toBeNull()
  })

  it('marks each question correct or wrong based on selectedByQuestionId', () => {
    vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([])
    const { container } = render(
      <QuizResults
        deck={makeDeck()}
        attempt={makeAttempt(1)}
        questions={QUESTIONS}
        selectedByQuestionId={
          new Map([
            [1, 1], // correct
            [2, 0], // wrong (correctIndex is 1)
          ])
        }
        onClose={() => undefined}
      />,
    )
    const rows = container.querySelectorAll('.quiz-results__row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.classList.contains('is-correct')).toBe(true)
    expect(rows[1]!.classList.contains('is-wrong')).toBe(true)
  })

  it('shows the user answer + correct answer in the review detail for wrong questions', () => {
    vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([])
    render(
      <QuizResults
        deck={makeDeck()}
        attempt={makeAttempt(1)}
        questions={QUESTIONS}
        selectedByQuestionId={
          new Map([
            [1, 1],
            [2, 0],
          ])
        } // q2 wrong: picked 'median' instead of 'sum / count'
        onClose={() => undefined}
      />,
    )
    expect(screen.getByText(/Your answer: median/)).toBeInTheDocument()
    expect(screen.getByText(/Correct: sum \/ count/)).toBeInTheDocument()
  })

  it('clicking "Back to list" invokes onClose', () => {
    vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([])
    const onClose = vi.fn()
    render(
      <QuizResults
        deck={makeDeck()}
        attempt={makeAttempt(2)}
        questions={QUESTIONS}
        selectedByQuestionId={
          new Map([
            [1, 1],
            [2, 1],
          ])
        }
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('Back to list'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('embeds the attempt history section and fetches via listAttempts', async () => {
    const spy = vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([])
    render(
      <QuizResults
        deck={makeDeck()}
        attempt={makeAttempt(2)}
        questions={QUESTIONS}
        selectedByQuestionId={
          new Map([
            [1, 1],
            [2, 1],
          ])
        }
        onClose={() => undefined}
      />,
    )
    expect(screen.getByText('Your attempts')).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalledWith(7))
  })
})

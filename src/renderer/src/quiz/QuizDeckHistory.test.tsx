import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QuizDeckHistory } from './QuizDeckHistory'
import type { QuizAttempt } from '@shared/quiz'

const NOW = Math.floor(Date.now() / 1000)

function attempt(
  id: number,
  opts: { score: number | null; finishedAt: number | null; startedAt?: number },
): QuizAttempt {
  return {
    id,
    deckId: 1,
    startedAt: opts.startedAt ?? NOW - 600,
    finishedAt: opts.finishedAt,
    score: opts.score,
    answers: [],
  }
}

describe('QuizDeckHistory', () => {
  it('shows the loading placeholder until the fetch resolves', () => {
    // Hold the promise so the loading state stays visible.
    vi.spyOn(window.api.quiz, 'listAttempts').mockReturnValue(new Promise(() => undefined))
    render(<QuizDeckHistory deckId={1} questionCount={10} />)
    expect(screen.getByText(/Loading history…/i)).toBeInTheDocument()
  })

  it('shows the empty-state placeholder when no finished attempts exist', async () => {
    vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([])
    render(<QuizDeckHistory deckId={1} questionCount={10} />)
    expect(await screen.findByText(/No attempts yet/i)).toBeInTheDocument()
  })

  it('filters out in-flight (unfinished) attempts', async () => {
    vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([
      attempt(1, { score: null, finishedAt: null }),
    ])
    render(<QuizDeckHistory deckId={1} questionCount={10} />)
    // Only unfinished attempts → renders the empty state.
    expect(await screen.findByText(/No attempts yet/i)).toBeInTheDocument()
  })

  it('renders one row per finished attempt with score, %, and duration', async () => {
    vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([
      attempt(1, { score: 8, finishedAt: NOW, startedAt: NOW - 272 }), // 4:32, 80%
      attempt(2, { score: 5, finishedAt: NOW - 86400, startedAt: NOW - 86400 - 360 }), // 6:00, 50%
    ])
    render(<QuizDeckHistory deckId={1} questionCount={10} />)
    expect(await screen.findByText('8 / 10')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByText('4:32')).toBeInTheDocument()
    expect(screen.getByText('5 / 10')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('6:00')).toBeInTheDocument()
  })

  it('applies the score-tone class to each row', async () => {
    vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([
      attempt(1, { score: 9, finishedAt: NOW }), // 90% → good
      attempt(2, { score: 6, finishedAt: NOW }), // 60% → mid
      attempt(3, { score: 2, finishedAt: NOW }), // 20% → low
    ])
    const { container } = render(<QuizDeckHistory deckId={1} questionCount={10} />)
    await waitFor(() => expect(container.querySelectorAll('.quiz-history__row')).toHaveLength(3))
    const rows = container.querySelectorAll('.quiz-history__row')
    expect(rows[0]!.classList.contains('quiz-history__row--good')).toBe(true)
    expect(rows[1]!.classList.contains('quiz-history__row--mid')).toBe(true)
    expect(rows[2]!.classList.contains('quiz-history__row--low')).toBe(true)
  })

  it('surfaces fetch errors inline', async () => {
    vi.spyOn(window.api.quiz, 'listAttempts').mockRejectedValue(new Error('listAttempts failed'))
    render(<QuizDeckHistory deckId={1} questionCount={10} />)
    expect(await screen.findByText(/listAttempts failed/i)).toBeInTheDocument()
  })
})

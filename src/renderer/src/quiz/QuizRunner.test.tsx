import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QuizRunner } from './QuizRunner'
import type { QuizAttempt, QuizDeckWithQuestions, QuizQuestion } from '@shared/quiz'

const NOW = Math.floor(Date.now() / 1000)

// Distinctive per-question option text so tests can click by text and stay
// robust against the runner's per-attempt option shuffle. The correctIndex
// always points at "<prefix>-correct"; the runner's option permutation moves
// that string to some display position, and clicking by text routes through
// the permutation back to the original index for the finishAttempt payload.
function makeQuestion(id: number, correctIndex: number, stem = `Q${id}`): QuizQuestion {
  const prefix = `q${id}`
  const labels = [`${prefix}-w`, `${prefix}-x`, `${prefix}-y`, `${prefix}-z`]
  labels[correctIndex] = `${prefix}-correct`
  return {
    id,
    deckId: 1,
    ordinal: id - 1,
    stem,
    options: labels,
    correctIndex,
    explanation: `Explanation ${id}`,
    sourceChunkIds: [100 + id],
    themeTitle: 'Theme',
  }
}

function makeDeck(questions: QuizQuestion[]): QuizDeckWithQuestions {
  return {
    deck: {
      id: 1,
      workspaceId: 1,
      name: 'Test Deck',
      documentIds: [1],
      questionCount: questions.length,
      status: 'ready',
      error: null,
      language: 'en',
      createdAt: NOW,
    },
    questions,
  }
}

// The runner shuffles questions via Fisher–Yates seeded on attempt.id. For
// 2 elements, attempt.id = 1000000 produces no swap (verified: the seeded
// rand() yields >= 0.5, so j = 1 and the only iteration self-swaps a[1]),
// keeping the test's [Q1, Q2] order intact. Any test that doesn't care about
// order can use any id.
function makeAttempt(id = 1000000): QuizAttempt {
  return {
    id,
    deckId: 1,
    startedAt: NOW,
    finishedAt: null,
    score: null,
    answers: [],
  }
}

function setupApiSpies(opts: {
  questions: QuizQuestion[]
  /** Hold the finishAttempt promise so we can observe the 'Scoring…' state. */
  pendingFinish?: boolean
  finishScore?: number
}) {
  const deck = makeDeck(opts.questions)
  vi.spyOn(window.api.quiz, 'getDeck').mockResolvedValue(deck)
  vi.spyOn(window.api.quiz, 'startAttempt').mockResolvedValue(makeAttempt())

  let resolveFinish: (value?: void) => void = () => undefined
  const finishGate = opts.pendingFinish
    ? new Promise<void>((res) => {
        resolveFinish = res
      })
    : Promise.resolve()
  const finishSpy = vi
    .spyOn(window.api.quiz, 'finishAttempt')
    .mockImplementation(async (attemptId, answers) => {
      await finishGate
      const score =
        opts.finishScore ??
        answers.reduce((acc, a, i) => {
          const q = opts.questions[i]
          if (!q) return acc
          return acc + (a.selectedIndex === q.correctIndex ? 1 : 0)
        }, 0)
      return {
        id: attemptId,
        deckId: 1,
        startedAt: NOW - 30,
        finishedAt: NOW,
        score,
        answers: answers.map((a) => {
          const q = opts.questions.find((qq) => qq.id === a.questionId)!
          return {
            questionId: a.questionId,
            selectedIndex: a.selectedIndex,
            correct: a.selectedIndex === q.correctIndex,
          }
        }),
      }
    })
  return { resolveFinish, finishSpy }
}

describe('QuizRunner', () => {
  // Each test installs its own vi.spyOn — they cumulatively wrap the
  // setupTests.ts stub and the latest mockResolvedValue wins. Avoid
  // vi.restoreAllMocks() between tests in this file: it interacts badly with
  // the jsdom + React setup here (next render dies on "useState is null").

  it('renders the first question after loading the deck', async () => {
    setupApiSpies({ questions: [makeQuestion(1, 1, 'First?')] })
    render(<QuizRunner deckId={1} onClose={() => undefined} />)
    expect(await screen.findByText('First?')).toBeInTheDocument()
    expect(screen.getByText('Question 1 / 1')).toBeInTheDocument()
  })

  it('clicking an option reveals the answer and shows Next/Finish', async () => {
    setupApiSpies({ questions: [makeQuestion(1, 1), makeQuestion(2, 0)] })
    render(<QuizRunner deckId={1} onClose={() => undefined} />)
    await screen.findByText('Q1')

    // Click the correct answer by its distinctive text — robust against the
    // option-order shuffle.
    fireEvent.click(screen.getByText('q1-correct'))
    expect(screen.getByText('Explanation 1')).toBeInTheDocument()
    expect(screen.getByText('Next')).toBeInTheDocument()
  })

  it('renders the stopwatch with mm:ss formatting', async () => {
    setupApiSpies({ questions: [makeQuestion(1, 0)] })
    render(<QuizRunner deckId={1} onClose={() => undefined} />)
    await screen.findByText('Q1')
    const timer = await screen.findByLabelText(/elapsed time/i)
    expect(timer.textContent).toMatch(/^\d+:\d{2}$/)
  })

  it('shows "Scoring…" between the last Finish click and the results screen', async () => {
    const { resolveFinish } = setupApiSpies({
      questions: [makeQuestion(1, 1, 'Only Q')],
      pendingFinish: true,
    })
    render(<QuizRunner deckId={1} onClose={() => undefined} />)
    await screen.findByText('Only Q')
    fireEvent.click(screen.getByText('q1-correct'))
    fireEvent.click(screen.getByText('Finish'))
    // While finishAttempt is pending, the guard placeholder is what saves the
    // app from the "Cannot read .id of undefined" crash. This is the regression
    // test for that bug.
    expect(await screen.findByText('Scoring…')).toBeInTheDocument()
    // Now let the IPC settle and confirm results appear.
    await act(async () => {
      resolveFinish()
    })
    expect(await screen.findByText('Results')).toBeInTheDocument()
  })

  it('after the final Finish click, calls finishAttempt with the correct payload and shows results', async () => {
    const questions = [makeQuestion(1, 1, 'Q1'), makeQuestion(2, 2, 'Q2')]
    const { finishSpy } = setupApiSpies({ questions })
    render(<QuizRunner deckId={1} onClose={() => undefined} />)
    await screen.findByText('Q1')

    // Q1: pick the right answer by text.
    fireEvent.click(screen.getByText('q1-correct'))
    fireEvent.click(screen.getByText('Next'))

    // Q2: deliberately pick a wrong option (`q2-w` is at original index 0,
    // but Q2.correctIndex is 2 → `q2-correct`).
    await screen.findByText('Q2')
    fireEvent.click(screen.getByText('q2-w'))
    fireEvent.click(screen.getByText('Finish'))

    await waitFor(() => expect(finishSpy).toHaveBeenCalledTimes(1))
    // The runner translates display indices back to ORIGINAL indices via the
    // per-question permutation. Expected payload: Q1 → 1 (correctIndex), Q2 → 0
    // (q2-w is original index 0). Order by question id since shuffle reorders.
    const [, payload] = finishSpy.mock.calls[0]!
    expect(payload).toHaveLength(2)
    const byQ = new Map(payload.map((p) => [p.questionId, p.selectedIndex]))
    expect(byQ.get(1)).toBe(1)
    expect(byQ.get(2)).toBe(0)

    // Score reflects 1 correct of 2.
    expect(await screen.findByText('Results')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('clicking the citation chip mounts the source-viewer modal', async () => {
    setupApiSpies({ questions: [makeQuestion(1, 1)] })
    // SourceViewer fetches via getChunkWithContext; the setupTests stub already
    // resolves to []. The modal still mounts, which is what we're asserting.
    render(<QuizRunner deckId={1} onClose={() => undefined} />)
    await screen.findByText('Q1')
    fireEvent.click(screen.getByText('q1-correct'))
    fireEvent.click(screen.getByText('View source'))
    // role=dialog is the modal wrapper added by the runner.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('shows the error screen when getDeck rejects', async () => {
    vi.spyOn(window.api.quiz, 'getDeck').mockRejectedValue(new Error('boom'))
    render(<QuizRunner deckId={1} onClose={() => undefined} />)
    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(screen.getByText('Back')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QuizListView, reduceProgress, formatDuration, type QuizProgress } from './QuizListView'
import type { QuizDeckSummary } from '@shared/quiz'

const NOW = Math.floor(Date.now() / 1000)

function makeDeck(
  overrides: Partial<QuizDeckSummary> & Pick<QuizDeckSummary, 'id' | 'status'>,
): QuizDeckSummary {
  return {
    workspaceId: 1,
    name: 'Sample',
    documentIds: [1],
    questionCount: 10,
    error: null,
    language: 'en',
    createdAt: NOW,
    attemptCount: 0,
    lastScore: null,
    lastFinishedAt: null,
    ...overrides,
  }
}

describe('QuizListView', () => {
  it('shows the empty state when there are no decks', () => {
    render(
      <QuizListView
        decks={[]}
        onCreate={() => undefined}
        onStart={() => undefined}
        onDelete={() => undefined}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText(/No quizzes yet/i)).toBeInTheDocument()
  })

  it('renders ready decks with a Start button', () => {
    const onStart = vi.fn()
    render(
      <QuizListView
        decks={[makeDeck({ id: 1, status: 'ready', name: 'Ready Deck' })]}
        onCreate={() => undefined}
        onStart={onStart}
        onDelete={() => undefined}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText('Ready Deck')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Start'))
    expect(onStart).toHaveBeenCalledWith(1)
  })

  it('renders generating decks with the generating badge and no Start button', () => {
    render(
      <QuizListView
        decks={[makeDeck({ id: 1, status: 'generating', name: 'In Progress' })]}
        onCreate={() => undefined}
        onStart={() => undefined}
        onDelete={() => undefined}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText(/Generating/i)).toBeInTheDocument()
    expect(screen.queryByText('Start')).not.toBeInTheDocument()
  })

  it('renders failed decks with Retry and the error message', () => {
    const onRetry = vi.fn()
    render(
      <QuizListView
        decks={[
          makeDeck({
            id: 1,
            status: 'failed',
            name: 'Bad Deck',
            error: 'no themes extracted from selected documents',
          }),
        ]}
        onCreate={() => undefined}
        onStart={() => undefined}
        onDelete={() => undefined}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText(/no themes extracted/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Retry'))
    expect(onRetry).toHaveBeenCalledWith(1)
  })

  it('surfaces last attempt score when one exists', () => {
    render(
      <QuizListView
        decks={[
          makeDeck({
            id: 1,
            status: 'ready',
            questionCount: 10,
            attemptCount: 3,
            lastScore: 7,
            lastFinishedAt: NOW,
          }),
        ]}
        onCreate={() => undefined}
        onStart={() => undefined}
        onDelete={() => undefined}
        onRetry={() => undefined}
      />,
    )
    // Score strip is the new home for last-score: "7 / 10" + "3 attempts".
    expect(screen.getByText('7 / 10')).toBeInTheDocument()
    expect(screen.getByText('3 attempts')).toBeInTheDocument()
  })

  it('renders pluralisation correctly for a single attempt + single file', () => {
    render(
      <QuizListView
        decks={[
          makeDeck({
            id: 1,
            status: 'ready',
            documentIds: [1],
            attemptCount: 1,
            lastScore: 5,
            lastFinishedAt: NOW,
          }),
        ]}
        onCreate={() => undefined}
        onStart={() => undefined}
        onDelete={() => undefined}
        onRetry={() => undefined}
      />,
    )
    // File-count chip is its own element; attempt-count lives in the score strip.
    expect(screen.getByText('1 file')).toBeInTheDocument()
    expect(screen.getByText('1 attempt')).toBeInTheDocument()
  })

  it('Delete button invokes onDelete', () => {
    const onDelete = vi.fn()
    render(
      <QuizListView
        decks={[makeDeck({ id: 5, status: 'ready' })]}
        onCreate={() => undefined}
        onStart={() => undefined}
        onDelete={onDelete}
        onRetry={() => undefined}
      />,
    )
    fireEvent.click(screen.getByLabelText('Delete deck'))
    expect(onDelete).toHaveBeenCalledWith(5)
  })

  it('History toggle is hidden when no attempts exist and revealed otherwise', async () => {
    render(
      <QuizListView
        decks={[
          makeDeck({ id: 1, status: 'ready', attemptCount: 0 }),
          makeDeck({
            id: 2,
            status: 'ready',
            attemptCount: 2,
            lastScore: 8,
            lastFinishedAt: NOW,
          }),
        ]}
        onCreate={() => undefined}
        onStart={() => undefined}
        onDelete={() => undefined}
        onRetry={() => undefined}
      />,
    )
    // Exactly one History button (the deck with attemptCount > 0).
    const historyBtns = screen.queryAllByRole('button', { name: /show history/i })
    expect(historyBtns).toHaveLength(1)
  })

  it('clicking History fetches and renders the attempt list', async () => {
    const listAttemptsSpy = vi.spyOn(window.api.quiz, 'listAttempts').mockResolvedValue([
      {
        id: 1,
        deckId: 1,
        startedAt: NOW - 600,
        finishedAt: NOW - 300,
        score: 7,
        answers: [],
      },
      {
        id: 2,
        deckId: 1,
        startedAt: NOW - 7200,
        finishedAt: NOW - 7000,
        score: 4,
        answers: [],
      },
    ])
    render(
      <QuizListView
        decks={[
          makeDeck({
            id: 1,
            status: 'ready',
            questionCount: 10,
            attemptCount: 2,
            lastScore: 7,
            lastFinishedAt: NOW,
          }),
        ]}
        onCreate={() => undefined}
        onStart={() => undefined}
        onDelete={() => undefined}
        onRetry={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /show history/i }))
    await waitFor(() => expect(listAttemptsSpy).toHaveBeenCalledWith(1))
    // Both attempts render with their original score (each row also shows %).
    expect(await screen.findByText('70%')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('New Quiz button invokes onCreate', () => {
    const onCreate = vi.fn()
    render(
      <QuizListView
        decks={[]}
        onCreate={onCreate}
        onStart={() => undefined}
        onDelete={() => undefined}
        onRetry={() => undefined}
      />,
    )
    fireEvent.click(screen.getByText('New Quiz'))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('renders the theme name + x/y detail during question generation', () => {
    const t0 = Date.now() - 47_000
    const progress: QuizProgress = {
      stage: 'generating-questions',
      themeTitle: 'Photosynthesis',
      themeIndex: 2,
      themeTotal: 4,
      ordinal: 6,
      total: 10,
      startedAt: t0,
      timeline: [{ phase: 'generating-questions', startedAt: t0 }],
    }
    render(
      <QuizListView
        decks={[makeDeck({ id: 1, status: 'generating' })]}
        progress={new Map([[1, progress]])}
        onCreate={() => undefined}
        onStart={() => undefined}
        onDelete={() => undefined}
        onRetry={() => undefined}
      />,
    )
    // Detail line shows the active step label, theme position + title, and x/y.
    // "Writing questions" renders twice (header label + timeline row) — that's
    // expected: the active phase appears in both the headline and the timeline.
    expect(screen.getAllByText(/Writing questions/).length).toBeGreaterThan(0)
    expect(screen.getByText(/theme 2\/4 "Photosynthesis"/)).toBeInTheDocument()
    expect(screen.getByText(/6 \/ 10/)).toBeInTheDocument()
  })

  it('renders a multi-phase timeline with per-phase durations', () => {
    const now = Date.now()
    const progress: QuizProgress = {
      stage: 'generating-questions',
      themeTitle: 'Cells',
      themeIndex: 1,
      themeTotal: 2,
      ordinal: 1,
      total: 10,
      docCount: 4,
      startedAt: now - 47_000,
      timeline: [
        { phase: 'extracting-themes', startedAt: now - 47_000, endedAt: now - 35_000 },
        { phase: 'merging-themes', startedAt: now - 35_000, endedAt: now - 32_000 },
        { phase: 'generating-questions', startedAt: now - 32_000 },
      ],
    }
    render(
      <QuizListView
        decks={[makeDeck({ id: 1, status: 'generating' })]}
        progress={new Map([[1, progress]])}
        onCreate={() => undefined}
        onStart={() => undefined}
        onDelete={() => undefined}
        onRetry={() => undefined}
      />,
    )
    // Three timeline rows with the doc-count, merge, and active writing phase.
    expect(screen.getByText(/Reading documents \(4 docs\)/)).toBeInTheDocument()
    expect(screen.getByText('12s')).toBeInTheDocument() // extracting duration
    expect(screen.getByText('3s')).toBeInTheDocument() // merge duration
    // Active phase shows a live, growing duration with the trailing ellipsis.
    expect(screen.getByText(/32s …/)).toBeInTheDocument()
  })

  it('reduceProgress closes the prior phase and opens the next on a stage change', () => {
    const t0 = 1000
    const afterStage = reduceProgress(undefined, { type: 'stage', stage: 'extracting-themes' }, t0)!
    expect(afterStage.startedAt).toBe(t0)
    expect(afterStage.timeline).toEqual([{ phase: 'extracting-themes', startedAt: t0 }])

    const t1 = 5000
    const afterTheme = reduceProgress(
      afterStage,
      { type: 'theme', themeIndex: 1, themeTotal: 3, themeTitle: 'Photosynthesis' },
      t1,
    )!
    expect(afterTheme.stage).toBe('generating-questions')
    expect(afterTheme.themeTitle).toBe('Photosynthesis')
    // First phase is closed at t1; the new phase is open.
    expect(afterTheme.timeline).toEqual([
      { phase: 'extracting-themes', startedAt: t0, endedAt: t1 },
      { phase: 'generating-questions', startedAt: t1 },
    ])
    // startedAt is preserved across events (live-timer base).
    expect(afterTheme.startedAt).toBe(t0)
  })

  it('formatDuration switches from Ns to m:ss at one minute', () => {
    expect(formatDuration(12_000)).toBe('12s')
    expect(formatDuration(59_000)).toBe('59s')
    expect(formatDuration(72_000)).toBe('1:12')
  })
})

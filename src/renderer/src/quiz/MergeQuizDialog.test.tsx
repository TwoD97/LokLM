import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MergeQuizDialog } from './MergeQuizDialog'
import type { QuizDeck, QuizDeckSummary } from '@shared/quiz'

const NOW = Math.floor(Date.now() / 1000)

function makeDeck(id: number, name: string, questionCount = 5): QuizDeckSummary {
  return {
    id,
    workspaceId: 1,
    name,
    documentIds: [id],
    questionCount,
    status: 'ready',
    error: null,
    language: 'en',
    createdAt: NOW,
    attemptCount: 0,
    lastScore: null,
    lastFinishedAt: null,
  }
}

function makeMerged(name: string): QuizDeck {
  return {
    id: 99,
    workspaceId: 1,
    name,
    documentIds: [1, 2],
    questionCount: 13,
    status: 'ready',
    error: null,
    language: 'en',
    createdAt: NOW,
  }
}

describe('MergeQuizDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps Merge disabled until a name and at least two decks are chosen', () => {
    render(
      <MergeQuizDialog
        workspaceId={1}
        decks={[makeDeck(1, 'A'), makeDeck(2, 'B'), makeDeck(3, 'C')]}
        onCancel={() => undefined}
        onMerged={() => undefined}
      />,
    )
    const merge = screen.getByText('Merge').closest('button')!
    expect(merge.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Combined' } })
    // Each deck row's label reads "<name> <n> questions", so match by role+name.
    fireEvent.click(screen.getByRole('checkbox', { name: /^A\b/ }))
    // One deck is not enough.
    expect(merge.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /^B\b/ }))
    expect(merge.disabled).toBe(false)
  })

  it('shows the live question total for the selected decks', () => {
    render(
      <MergeQuizDialog
        workspaceId={1}
        decks={[makeDeck(1, 'A', 5), makeDeck(2, 'B', 8)]}
        onCancel={() => undefined}
        onMerged={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /^A\b/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^B\b/ }))
    expect(screen.getByText('13 questions total')).toBeInTheDocument()
  })

  it('merges with the chosen name, deck ids and shuffle flag', async () => {
    const spy = vi.spyOn(window.api.quiz, 'mergeDecks').mockResolvedValue(makeMerged('Combined'))
    const onMerged = vi.fn()
    render(
      <MergeQuizDialog
        workspaceId={4}
        decks={[makeDeck(1, 'A'), makeDeck(2, 'B')]}
        onCancel={() => undefined}
        onMerged={onMerged}
      />,
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Combined' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /^A\b/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^B\b/ }))
    fireEvent.click(screen.getByText('Merge'))

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy).toHaveBeenCalledWith({
      workspaceId: 4,
      name: 'Combined',
      deckIds: [1, 2],
      shuffle: true,
    })
    await waitFor(() => expect(onMerged).toHaveBeenCalledWith(makeMerged('Combined')))
  })

  it('shows the not-enough-decks hint with fewer than two ready decks', () => {
    render(
      <MergeQuizDialog
        workspaceId={1}
        decks={[makeDeck(1, 'A')]}
        onCancel={() => undefined}
        onMerged={() => undefined}
      />,
    )
    expect(screen.getByText(/at least two ready quizzes/i)).toBeInTheDocument()
  })
})

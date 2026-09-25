import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { QuizDeckSummary } from '@shared/quiz'
import { QuizView } from './QuizView'

const job = vi.hoisted(() => ({ end: vi.fn(), begin: vi.fn() }))
vi.mock('../generation/GenerationContext', () => ({ useGeneration: () => ({ begin: job.begin }) }))
const deck: QuizDeckSummary = {
  id: 1,
  workspaceId: 1,
  name: 'History',
  documentIds: [1],
  questionCount: 10,
  error: null,
  language: 'en',
  createdAt: 1,
  attemptCount: 0,
  lastScore: null,
  lastFinishedAt: null,
  status: 'failed',
}

afterEach(() => {
  vi.restoreAllMocks()
  job.end.mockReset()
  job.begin.mockReset()
})

describe('Quiz workflow', () => {
  it('cleans up activity and event subscriptions when generation IPC rejects', async () => {
    job.begin.mockReturnValue(job.end)
    vi.spyOn(window.api.quiz, 'listDecks').mockResolvedValue([deck])
    vi.spyOn(window.api.quiz, 'generate').mockRejectedValue(new Error('GPU unavailable'))
    const off = vi.fn()
    vi.spyOn(window.api.quiz, 'onGenerateEvent').mockReturnValue(off)
    render(<QuizView workspaceId={1} workspaceName="Research" documents={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('GPU unavailable')
    expect(job.end).toHaveBeenCalledTimes(1)
    expect(off).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Retry' }).at(-1)).toBeEnabled(),
    )
  })

  it('requires confirmation before deleting a quiz and reports a rejected deletion', async () => {
    vi.spyOn(window.api.quiz, 'listDecks').mockResolvedValue([{ ...deck, status: 'ready' }])
    const remove = vi
      .spyOn(window.api.quiz, 'deleteDeck')
      .mockRejectedValue(new Error('Vault unavailable'))
    render(<QuizView workspaceId={1} workspaceName="Research" documents={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete deck' }))
    expect(remove).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Vault unavailable')
    expect(screen.getByRole('heading', { name: 'History' })).toBeVisible()
  })
})

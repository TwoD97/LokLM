import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateQuizDialog } from './CreateQuizDialog'
import type { Document } from '@shared/documents'
import type { QuizDeck } from '@shared/quiz'

const NOW = Math.floor(Date.now() / 1000)

function makeDoc(id: number, status: Document['status'] = 'ready', title = `Doc ${id}`): Document {
  return {
    id,
    workspaceId: 1,
    title,
    sourcePath: `/tmp/${title}.md`,
    mimeType: 'text/markdown',
    byteSize: 100,
    status,
    chunkCount: 5,
    tokenCount: 500,
    addedAt: NOW,
  }
}

function makeDeck(name: string): QuizDeck {
  return {
    id: 99,
    workspaceId: 1,
    name,
    documentIds: [1],
    questionCount: 5,
    status: 'generating',
    error: null,
    language: 'en',
    createdAt: NOW,
  }
}

describe('CreateQuizDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('disables Generate when no document is selected', () => {
    render(
      <CreateQuizDialog
        workspaceId={1}
        documents={[makeDoc(1)]}
        onCancel={() => undefined}
        onCreated={() => undefined}
      />,
    )
    const generate = screen.getByText('Generate').closest('button')!
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Quiz Name' } })
    // Still disabled — no doc picked.
    expect(generate.disabled).toBe(true)
  })

  it('disables Generate when the name is empty', () => {
    render(
      <CreateQuizDialog
        workspaceId={1}
        documents={[makeDoc(1)]}
        onCancel={() => undefined}
        onCreated={() => undefined}
      />,
    )
    fireEvent.click(screen.getByLabelText(/Doc 1/i))
    const generate = screen.getByText('Generate').closest('button')!
    expect(generate.disabled).toBe(true)
  })

  it('only lists documents whose status is ready', () => {
    render(
      <CreateQuizDialog
        workspaceId={1}
        documents={[
          makeDoc(1, 'ready', 'Ready doc'),
          makeDoc(2, 'indexing', 'Indexing doc'),
          makeDoc(3, 'failed', 'Failed doc'),
        ]}
        onCancel={() => undefined}
        onCreated={() => undefined}
      />,
    )
    expect(screen.getByText('Ready doc')).toBeInTheDocument()
    expect(screen.queryByText('Indexing doc')).not.toBeInTheDocument()
    expect(screen.queryByText('Failed doc')).not.toBeInTheDocument()
  })

  it('calls createDeck with the entered name, selected docs and language', async () => {
    const createSpy = vi.spyOn(window.api.quiz, 'createDeck').mockResolvedValue(makeDeck('My Q'))
    const onCreated = vi.fn()
    render(
      <CreateQuizDialog
        workspaceId={7}
        documents={[makeDoc(1, 'ready', 'A'), makeDoc(2, 'ready', 'B')]}
        onCancel={() => undefined}
        onCreated={onCreated}
      />,
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My Q' } })
    fireEvent.click(screen.getByLabelText('A'))
    fireEvent.click(screen.getByLabelText('B'))
    fireEvent.click(screen.getByText('Deutsch'))
    fireEvent.click(screen.getByText('Generate'))

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
    expect(createSpy).toHaveBeenCalledWith({
      workspaceId: 7,
      name: 'My Q',
      documentIds: [1, 2],
      language: 'de',
    })
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
  })

  it('shows the derived question estimate once documents are selected', async () => {
    const estimateSpy = vi
      .spyOn(window.api.quiz, 'estimate')
      .mockResolvedValue({ questionCount: 12, unitCount: 7 })
    render(
      <CreateQuizDialog
        workspaceId={1}
        documents={[makeDoc(1)]}
        onCancel={() => undefined}
        onCreated={() => undefined}
      />,
    )
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Doc 1/i))
    await waitFor(() => expect(estimateSpy).toHaveBeenCalledWith([1]))
    expect(await screen.findByText(/≈ 12 questions from 7 sections/)).toBeInTheDocument()
  })

  it('shows the empty-material hint when the estimate is zero', async () => {
    vi.spyOn(window.api.quiz, 'estimate').mockResolvedValue({ questionCount: 0, unitCount: 0 })
    render(
      <CreateQuizDialog
        workspaceId={1}
        documents={[makeDoc(1)]}
        onCancel={() => undefined}
        onCreated={() => undefined}
      />,
    )
    fireEvent.click(screen.getByLabelText(/Doc 1/i))
    expect(
      await screen.findByText(/No indexable content in the selected documents/),
    ).toBeInTheDocument()
  })

  it('surfaces backend validation errors as inline text', async () => {
    vi.spyOn(window.api.quiz, 'createDeck').mockRejectedValue(
      new Error('Quiz name must be 1–128 characters'),
    )
    render(
      <CreateQuizDialog
        workspaceId={1}
        documents={[makeDoc(1)]}
        onCancel={() => undefined}
        onCreated={() => undefined}
      />,
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'X' } })
    fireEvent.click(screen.getByLabelText(/Doc 1/i))
    fireEvent.click(screen.getByText('Generate'))
    expect(await screen.findByText(/1–128 characters/)).toBeInTheDocument()
  })

  it('cancel button invokes onCancel without touching the API', () => {
    const createSpy = vi.spyOn(window.api.quiz, 'createDeck')
    const onCancel = vi.fn()
    render(
      <CreateQuizDialog
        workspaceId={1}
        documents={[makeDoc(1)]}
        onCancel={onCancel}
        onCreated={() => undefined}
      />,
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(createSpy).not.toHaveBeenCalled()
  })
})

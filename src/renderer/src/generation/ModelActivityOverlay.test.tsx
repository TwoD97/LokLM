import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ModelActivityOverlay } from './ModelActivityOverlay'
import { IDLE_MODEL_TRANSITION, type ModelActivity } from '@shared/modelActivity'

let emit: (activity: ModelActivity) => void
beforeEach(() => {
  vi.spyOn(window.api.models, 'onActivity').mockImplementation((cb) => {
    emit = cb
    return () => {}
  })
  // Native dialog handles focus trapping in Electron. jsdom supplies no implementation.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => vi.restoreAllMocks())
const indexing: ModelActivity = {
  ...IDLE_MODEL_TRANSITION,
  phase: 'indexing',
  jobs: [{ workspaceId: 1, title: 'Example.pdf', done: 4, total: 10 }],
}

describe('model activity loading screen', () => {
  it('shows indexing progress, restoration, and closes only when ready', async () => {
    render(<ModelActivityOverlay />)
    act(() => emit(indexing))
    expect(screen.getByRole('dialog')).toHaveAttribute('open')
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '40')
    expect(screen.getByText('Example.pdf')).toBeInTheDocument()
    act(() => emit({ ...indexing, phase: 'restoring', target: 'llm', progress: 0.5, jobs: [] }))
    expect(screen.getByRole('heading', { name: 'Getting chat ready again' })).toBeInTheDocument()
    act(() => emit({ ...IDLE_MODEL_TRANSITION, jobs: [] }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('keeps live progress accessible while browsing', () => {
    render(<ModelActivityOverlay />)
    act(() => emit(indexing))
    fireEvent.click(screen.getByRole('button', { name: 'Continue browsing' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => emit({ ...indexing, jobs: [{ ...indexing.jobs[0]!, done: 7 }] }))
    fireEvent.click(screen.getByRole('button', { name: 'View progress' }))
    expect(screen.getByRole('dialog')).toHaveAttribute('open')
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '70')
  })
  it('finishes indexing without promising an automatic chat reload', () => {
    render(<ModelActivityOverlay />)
    act(() => emit(indexing))
    expect(screen.getByText('Finish')).toBeInTheDocument()
    expect(screen.getByText(/the chat model loads when needed/)).toBeInTheDocument()
    act(() => emit({ ...IDLE_MODEL_TRANSITION, jobs: [] }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Getting chat ready again')).not.toBeInTheDocument()
  })
  it('stops indexing and explains the current batch must finish', async () => {
    const cancel = vi.spyOn(window.api.models, 'cancelIndexing').mockResolvedValue()
    render(<ModelActivityOverlay />)
    act(() => emit(indexing))
    fireEvent.click(screen.getByRole('button', { name: 'Stop indexing' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(
      screen.getByText('Finishing the current batch, then stopping indexing…'),
    ).toBeInTheDocument()
  })
  it('leaves routine model switches to the title bar without adding a second strip or taking focus', () => {
    render(
      <>
        <input aria-label="Draft" />
        <ModelActivityOverlay />
      </>,
    )
    const draft = screen.getByRole('textbox')
    draft.focus()
    act(() => emit({ ...IDLE_MODEL_TRANSITION, phase: 'switching', target: 'llm', jobs: [] }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(draft).toHaveFocus()
    act(() => emit({ ...IDLE_MODEL_TRANSITION, phase: 'switching', target: 'reranker', jobs: [] }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(draft).toHaveFocus()
  })

  it('keeps the indexing dialog dismissed through restoration', () => {
    render(<ModelActivityOverlay />)
    act(() => emit(indexing))
    fireEvent.click(screen.getByRole('button', { name: 'Continue browsing' }))
    act(() => emit({ ...indexing, phase: 'restoring', target: 'llm', jobs: [] }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Getting chat ready again')
  })
})

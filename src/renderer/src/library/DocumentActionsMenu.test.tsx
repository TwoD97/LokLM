import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Document } from '@shared/documents'
import { DocumentActionsMenu } from './DocumentActionsMenu'

const doc: Document = {
  id: 7,
  workspaceId: 1,
  title: 'Project notes.md',
  sourcePath: '/notes.md',
  mimeType: 'text/markdown',
  byteSize: 100,
  status: 'ready',
  chunkCount: 1,
  tokenCount: 20,
  addedAt: 1,
  pinned: false,
}
function setup(onDelete = vi.fn<() => void | Promise<void>>(), document = doc) {
  const actions = {
    onDelete,
    onRead: vi.fn(),
    onReindex: vi.fn(),
    onReveal: vi.fn(),
    onOpenExternal: vi.fn(),
    onReplace: vi.fn(),
    onRefresh: vi.fn(),
    onExport: vi.fn(),
    onSummarize: vi.fn(),
    onTogglePin: vi.fn(),
  }
  render(<DocumentActionsMenu doc={document} {...actions} />)
  return { ...actions, trigger: screen.getByRole('button', { name: 'actions' }) }
}

describe('document actions', () => {
  it('keeps generated text readable, exportable and retryable without original-file actions', () => {
    const { trigger, onRead, onExport, onReindex } = setup(undefined, {
      ...doc,
      sourcePath: 'loklm-generated:abc',
    })
    fireEvent.click(trigger)
    expect(screen.getAllByRole('menuitem')).toHaveLength(7)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Read' }))
    expect(onRead).toHaveBeenCalledOnce()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export…' }))
    expect(onExport).toHaveBeenCalledOnce()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reindex' }))
    expect(onReindex).toHaveBeenCalledExactlyOnceWith(7)
  })
  it('requires a named confirmation and cancellation keeps the document unchanged', () => {
    const { trigger, onDelete } = setup()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete document?' })
    expect(dialog).toHaveTextContent('Project notes.md')
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
  })

  it('runs one confirmed deletion and prevents repeat actions while it is pending', async () => {
    let finish!: () => void
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const { trigger } = setup(onDelete)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledExactlyOnceWith(7))
    expect(trigger).toBeDisabled()
    await act(async () => finish())
    expect(trigger).not.toBeDisabled()
  })

  it('supports arrow keys, Home/End, and Escape returning focus to the trigger', () => {
    const { trigger } = setup()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Read' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Read' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(screen.getByRole('menuitem', { name: 'Read' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps failed deletion feedback visible and permits retry', async () => {
    const { trigger } = setup(vi.fn().mockRejectedValue(new Error('File busy')))
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('File busy')
    expect(trigger).not.toBeDisabled()
  })
})

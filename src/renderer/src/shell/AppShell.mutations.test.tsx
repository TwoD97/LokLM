import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@shared/documents'
import { AppShell } from './AppShell'

vi.mock('../library/LibraryView', () => ({
  LibraryView: ({ workspaceId }: { workspaceId: number }) => <p>Opened library {workspaceId}</p>,
}))
const workspace: Workspace = {
  id: 1,
  name: 'First',
  createdAt: 0,
  type: 'library',
  encryptionLevel: 'full',
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
beforeEach(() => {
  localStorage.removeItem('loklm:sidebar:pinned')
  vi.spyOn(window.api.workspaces, 'list').mockResolvedValue([workspace])
})
afterEach(() => vi.restoreAllMocks())

describe('durable workspace controls', () => {
  it('shows a workspace-list failure and allows a read retry', async () => {
    vi.mocked(window.api.workspaces.list).mockRejectedValueOnce(new Error('vault unavailable'))
    render(<AppShell />)
    expect(await screen.findByRole('alert')).toHaveTextContent('vault unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Opened library 1')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps a failed creation draft and prevents duplicate submissions while saving', async () => {
    const created = deferred<Workspace>()
    const create = vi.spyOn(window.api.workspaces, 'create').mockReturnValue(created.promise)
    render(<AppShell />)
    await screen.findByText('Opened library 1')
    const input = screen.getByRole('textbox', { name: '+ New workspace' })
    fireEvent.change(input, { target: { value: 'Research' } })
    const form = input.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(create).toHaveBeenCalledExactlyOnceWith('Research', true)
    expect(input).toBeDisabled()
    await act(async () => created.reject(new Error('disk full')))
    expect(screen.getByRole('alert')).toHaveTextContent('disk full')
    expect(input).toHaveValue('Research')
    expect(input).not.toBeDisabled()
    expect(screen.getByText('Opened library 1')).toBeInTheDocument()
  })

  it('updates the default star only after persistence and leaves the old selection on failure', async () => {
    const saved = deferred<void>()
    const setDefault = vi
      .spyOn(window.api.workspaces, 'setDefault')
      .mockReturnValueOnce(saved.promise)
      .mockResolvedValueOnce(undefined)
    render(<AppShell />)
    await screen.findByText('Opened library 1')
    const star = screen.getByRole('button', { name: 'Set as default workspace' })
    fireEvent.click(star)
    expect(star).toHaveAttribute('aria-pressed', 'false')
    expect(star).toBeDisabled()
    await act(async () => saved.reject(new Error('save failed')))
    expect(screen.getByRole('alert')).toHaveTextContent('save failed')
    expect(star).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(star)
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'true'))
    expect(setDefault.mock.calls).toEqual([[1], [1]])
  })

  it('retains a failed rename for correction and commits the new name after a successful retry', async () => {
    const rename = vi
      .spyOn(window.api.workspaces, 'rename')
      .mockRejectedValueOnce(new Error('rename failed'))
      .mockResolvedValueOnce(undefined)
    render(<AppShell />)
    await screen.findByText('Opened library 1')
    fireEvent.click(screen.getByRole('button', { name: 'Rename workspace' }))
    const input = screen.getByRole('textbox', { name: 'Rename workspace' })
    fireEvent.change(input, { target: { value: 'Revised' } })
    fireEvent.submit(input.closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('rename failed')
    expect(input).toHaveValue('Revised')
    fireEvent.submit(input.closest('form')!)
    expect(await screen.findByRole('button', { name: 'Revised' })).toBeInTheDocument()
    expect(rename).toHaveBeenCalledTimes(2)
  })

  it('gates current-workspace actions during deletion and reopens it after a failed delete', async () => {
    const removed = deferred<void>()
    const remove = vi.spyOn(window.api.workspaces, 'delete').mockReturnValue(removed.promise)
    const activate = vi.spyOn(window.api.workspaces, 'activate')
    render(<AppShell />)
    await screen.findByText('Opened library 1')
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(remove).toHaveBeenCalledExactlyOnceWith(1)
    expect(screen.queryByText('Opened library 1')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Deleting First')
    await act(async () => removed.reject(new Error('delete failed')))
    expect(screen.getByRole('alert')).toHaveTextContent('delete failed')
    expect(await screen.findByText('Opened library 1')).toBeInTheDocument()
    expect(activate).toHaveBeenCalledTimes(2)
  })
})

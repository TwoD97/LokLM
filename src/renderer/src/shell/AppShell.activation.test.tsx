import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

vi.mock('./Sidebar', () => ({
  usePinnedSidebar: () => [true, () => {}],
  Sidebar: ({
    onWorkspaceSelect,
    onViewChange,
  }: {
    onWorkspaceSelect: (id: number) => void
    onViewChange: (view: string) => void
  }) => (
    <aside>
      <button onClick={() => onWorkspaceSelect(1)}>Workspace 1</button>
      <button onClick={() => onWorkspaceSelect(2)}>Workspace 2</button>
      <button onClick={() => onViewChange('writing')}>Open writing</button>
    </aside>
  ),
}))
vi.mock('../library/LibraryView', () => ({
  LibraryView: ({ workspaceId }: { workspaceId: number }) => <p>Opened library {workspaceId}</p>,
}))
vi.mock('../writing/WritingView', () => ({ WritingView: () => <p>Writing remains available</p> }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.spyOn(window.api.workspaces, 'list').mockResolvedValue([
    { id: 1, name: 'First', createdAt: 0, type: 'library', encryptionLevel: 'full' },
    { id: 2, name: 'Second', createdAt: 0, type: 'library', encryptionLevel: 'full' },
  ])
})
afterEach(() => vi.restoreAllMocks())

describe('workspace activation boundary', () => {
  it('does not mount workspace actions or request scope data before activation succeeds', async () => {
    const opening = deferred<void>()
    const activate = vi.spyOn(window.api.workspaces, 'activate').mockReturnValue(opening.promise)
    const docs = vi.spyOn(window.api.documents, 'list')
    const folders = vi.spyOn(window.api.folders, 'list')
    render(<AppShell />)
    await waitFor(() => expect(activate).toHaveBeenCalledWith(1))
    expect(screen.getByRole('status')).toHaveTextContent('Opening First')
    expect(screen.queryByText('Opened library 1')).not.toBeInTheDocument()
    expect(docs).not.toHaveBeenCalled()
    expect(folders).not.toHaveBeenCalled()
    await act(async () => opening.resolve())
    expect(await screen.findByText('Opened library 1')).toBeVisible()
    expect(docs).toHaveBeenCalledWith(1)
  })

  it('keeps failed workspaces closed until Retry succeeds', async () => {
    const activate = vi
      .spyOn(window.api.workspaces, 'activate')
      .mockRejectedValueOnce(new Error('Store unavailable'))
      .mockResolvedValue(undefined)
    render(<AppShell />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Store unavailable')
    expect(screen.queryByText('Opened library 1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Opened library 1')).toBeVisible()
    expect(activate.mock.calls).toEqual([[1], [1]])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('serializes rapid selections and skips a queued workspace that was superseded', async () => {
    const first = deferred<void>()
    const latest = deferred<void>()
    const activate = vi
      .spyOn(window.api.workspaces, 'activate')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(latest.promise)
    render(<AppShell />)
    await waitFor(() => expect(activate).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Workspace 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Workspace 1' }))
    expect(activate).toHaveBeenCalledTimes(1)
    await act(async () => first.resolve())
    await waitFor(() => expect(activate).toHaveBeenCalledTimes(2))
    expect(activate.mock.calls).toEqual([[1], [1]])
    expect(screen.queryByText('Opened library 1')).not.toBeInTheDocument()
    await act(async () => latest.resolve())
    expect(await screen.findByText('Opened library 1')).toBeVisible()
  })

  it('does not reopen an earlier ready view while another activation is still changing the store', async () => {
    const second = deferred<void>()
    const reopened = deferred<void>()
    const activate = vi
      .spyOn(window.api.workspaces, 'activate')
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(reopened.promise)
    render(<AppShell />)
    await screen.findByText('Opened library 1')
    fireEvent.click(screen.getByRole('button', { name: 'Workspace 2' }))
    await waitFor(() => expect(activate).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Workspace 1' }))
    expect(screen.queryByText('Opened library 1')).not.toBeInTheDocument()
    await act(async () => second.resolve())
    expect(activate.mock.calls).toEqual([[1], [2], [1]])
    expect(screen.queryByText('Opened library 1')).not.toBeInTheDocument()
    await act(async () => reopened.resolve())
    expect(await screen.findByText('Opened library 1')).toBeVisible()
  })

  it('keeps workspace-independent writing available when opening a workspace fails', async () => {
    vi.spyOn(window.api.workspaces, 'activate').mockRejectedValue(new Error('Store unavailable'))
    render(<AppShell />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Open writing' }))
    expect(await screen.findByText('Writing remains available')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

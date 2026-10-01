import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SyncFoldersPanel } from './SyncFoldersPanel'

afterEach(() => vi.restoreAllMocks())
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function setup() {
  vi.spyOn(window.api.workspaces, 'listSyncFolders').mockResolvedValue(['/project'])
  const onSyncDone = vi.fn()
  const view = render(<SyncFoldersPanel workspaceId={1} onSyncDone={onSyncDone} />)
  await screen.findByRole('button', { name: 'Folder sync · 1 folders connected' })
  fireEvent.click(screen.getByRole('button', { name: /Folder sync/ }))
  return { ...view, onSyncDone }
}
async function openPicker() {
  vi.spyOn(window.api.workspaces, 'getDirSelection').mockResolvedValue({
    topLevelDirs: ['src', 'docs'],
    selected: ['src'],
    hasGitignore: false,
  })
  const view = await setup()
  const opener = screen.getByRole('button', { name: 'Edit indexed folders' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = await screen.findByRole('dialog', { name: 'Choose folders to index' })
  return { ...view, opener, dialog }
}

describe('folder sync operations', () => {
  it('shows load failure and allows retry instead of claiming no folders are connected', async () => {
    vi.spyOn(window.api.workspaces, 'listSyncFolders')
      .mockRejectedValueOnce(new Error('vault busy'))
      .mockResolvedValue(['/retry'])
    render(<SyncFoldersPanel workspaceId={1} onSyncDone={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('vault busy')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('button', { name: 'Folder sync · 1 folders connected' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not display delayed folders from the previous workspace', async () => {
    const old = deferred<string[]>()
    vi.spyOn(window.api.workspaces, 'listSyncFolders').mockImplementation((id) =>
      id === 1 ? old.promise : Promise.resolve(['/current']),
    )
    const view = render(<SyncFoldersPanel workspaceId={1} onSyncDone={vi.fn()} />)
    view.rerender(<SyncFoldersPanel workspaceId={2} onSyncDone={vi.fn()} />)
    await screen.findByRole('button', { name: 'Folder sync · 1 folders connected' })
    fireEvent.click(screen.getByRole('button', { name: /Folder sync/ }))
    await act(async () => old.resolve(['/previous']))
    expect(screen.getByText('/current')).toBeInTheDocument()
    expect(screen.queryByText('/previous')).not.toBeInTheDocument()
  })

  it('confirms indexed-document deletion and refreshes the library only after disconnect succeeds', async () => {
    const removed = deferred<string[]>()
    const remove = vi
      .spyOn(window.api.workspaces, 'removeSyncFolder')
      .mockReturnValue(removed.promise)
    const { onSyncDone } = await setup()
    const opener = screen.getByRole('button', { name: 'Remove /project' })
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Disconnect folder?' })
    expect(dialog).toHaveTextContent('Original files on disk are kept')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(opener)
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Disconnect folder' }),
    )
    expect(remove).toHaveBeenCalledExactlyOnceWith(1, '/project')
    expect(opener).toBeDisabled()
    expect(onSyncDone).not.toHaveBeenCalled()
    await act(async () => removed.resolve([]))
    expect(onSyncDone).toHaveBeenCalledOnce()
    expect(screen.queryByText('/project')).not.toBeInTheDocument()
  })

  it('cannot translate an empty selection into the backend index-everything sentinel', async () => {
    const save = vi.spyOn(window.api.workspaces, 'setIndexDirs')
    await openPicker()
    fireEvent.click(screen.getByRole('checkbox', { name: 'src' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Select at least one folder')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(save).not.toHaveBeenCalled()
  })

  it('retains failed selection edits for retry and blocks duplicate submits while pending', async () => {
    const saved = deferred<void>()
    const save = vi
      .spyOn(window.api.workspaces, 'setIndexDirs')
      .mockRejectedValueOnce(new Error('write failed'))
      .mockReturnValueOnce(saved.promise)
    const sync = vi.spyOn(window.api.workspaces, 'syncNow')
    const { dialog } = await openPicker()
    fireEvent.click(screen.getByRole('checkbox', { name: 'docs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('write failed')
    expect(screen.getByRole('checkbox', { name: 'docs' })).toBeChecked()
    expect(sync).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(save).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(dialog).toBeInTheDocument()
    await act(async () => saved.resolve())
    expect(sync).toHaveBeenCalledExactlyOnceWith(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('contains keyboard focus and returns it to the edit button on Escape', async () => {
    const { dialog, opener } = await openPicker()
    expect(screen.getByRole('checkbox', { name: 'src' })).toHaveFocus()
    const save = screen.getByRole('button', { name: 'Save' })
    save.focus()
    fireEvent.keyDown(save, { key: 'Tab' })
    expect(screen.getByRole('checkbox', { name: 'src' })).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('does not start a deferred sync after selection save finishes in an unmounted workspace', async () => {
    const saved = deferred<void>()
    vi.spyOn(window.api.workspaces, 'setIndexDirs').mockReturnValue(saved.promise)
    const sync = vi.spyOn(window.api.workspaces, 'syncNow')
    const view = await openPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    view.rerender(<SyncFoldersPanel workspaceId={2} onSyncDone={vi.fn()} />)
    await act(async () => saved.resolve())
    expect(sync).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows sync invocation errors and releases pending controls for a retry', async () => {
    const sync = vi
      .spyOn(window.api.workspaces, 'syncNow')
      .mockRejectedValueOnce(new Error('GPU busy'))
      .mockResolvedValueOnce({
        imported: 0,
        reindexed: 0,
        markedMissing: 0,
        unchanged: 0,
        stillMissing: 0,
      })
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('GPU busy')
    const retry = screen.getByRole('button', { name: 'Sync now' })
    expect(retry).not.toBeDisabled()
    fireEvent.click(retry)
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

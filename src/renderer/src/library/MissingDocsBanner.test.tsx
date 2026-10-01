import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Document } from '@shared/documents'
import { MissingDocsBanner } from './MissingDocsBanner'

afterEach(() => vi.restoreAllMocks())
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const doc = (id: number, workspaceId = 1): Document => ({
  id,
  workspaceId,
  title: `Missing ${id}`,
  sourcePath: `/missing-${id}.md`,
  mimeType: 'text/markdown',
  byteSize: 1,
  status: 'ready',
  chunkCount: 1,
  tokenCount: 1,
  addedAt: 1,
  pinned: false,
})
const banner = (workspaceId = 1, onChanged = vi.fn()) => (
  <MissingDocsBanner workspaceId={workspaceId} refreshKey={0} onChanged={onChanged} />
)

describe('missing document recovery', () => {
  it('excludes generated documents because they have no original file to be missing', async () => {
    vi.spyOn(window.api.documents, 'listMissing').mockResolvedValue([
      doc(1),
      { ...doc(2), sourcePath: 'loklm-generated:abc' },
    ])
    render(banner())
    await screen.findByText('Missing 1')
    expect(screen.queryByText('Missing 2')).not.toBeInTheDocument()
  })

  it('surfaces a failed missing-document read and retries without silently clearing the warning', async () => {
    vi.spyOn(window.api.documents, 'listMissing')
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce([doc(1)])
    render(banner())
    expect(await screen.findByRole('alert')).toHaveTextContent('read failed')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Missing 1')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('requires confirmation and stops a sequential deletion on workspace navigation', async () => {
    const first = deferred<void>()
    const remove = vi.spyOn(window.api.documents, 'delete').mockReturnValue(first.promise)
    const changed = vi.fn()
    vi.spyOn(window.api.documents, 'listMissing').mockImplementation(async (id) =>
      id === 1 ? [doc(1), doc(2)] : [doc(9, 2)],
    )
    const view = render(banner(1, changed))
    await screen.findByText('Missing 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete (2)' }))
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(remove).toHaveBeenCalledExactlyOnceWith(1)
    view.rerender(banner(2, changed))
    await screen.findByText('Missing 9')
    await act(async () => first.resolve())
    expect(remove).toHaveBeenCalledTimes(1)
    expect(changed).not.toHaveBeenCalled()
  })

  it('retains a visible mutation error and reloads after a partially completed keep batch', async () => {
    vi.spyOn(window.api.documents, 'listMissing')
      .mockResolvedValueOnce([doc(1), doc(2)])
      .mockResolvedValue([doc(2)])
    const keep = vi
      .spyOn(window.api.documents, 'keepMissing')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('write failed'))
    const changed = vi.fn()
    render(banner(1, changed))
    await screen.findByText('Missing 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep (2)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('write failed')
    await waitFor(() => expect(screen.queryByText('Missing 1')).not.toBeInTheDocument())
    expect(screen.getByText('Missing 2')).toBeInTheDocument()
    expect(keep).toHaveBeenCalledTimes(2)
    expect(changed).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Keep (1)' })).not.toBeDisabled()
  })

  it('ignores old missing-document reads after a workspace switch', async () => {
    const old = deferred<Document[]>()
    vi.spyOn(window.api.documents, 'listMissing').mockImplementation((id) =>
      id === 1 ? old.promise : Promise.resolve([doc(2, 2)]),
    )
    const view = render(banner(1))
    view.rerender(banner(2))
    await screen.findByText('Missing 2')
    await act(async () => old.resolve([doc(1)]))
    expect(screen.queryByText('Missing 1')).not.toBeInTheDocument()
    expect(screen.getByText('Missing 2')).toBeInTheDocument()
  })
})

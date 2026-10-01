import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackfillStatus, Document, IndexProgress } from '@shared/documents'
import type { WorkspaceStorageFootprint } from '@shared/workspaceStorage'
import { LibraryView } from './LibraryView'

afterEach(() => vi.restoreAllMocks())
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const doc = (workspaceId: number, title = 'Current document'): Document => ({
  id: 1,
  workspaceId,
  title,
  sourcePath: '/doc.md',
  mimeType: 'text/markdown',
  byteSize: 10,
  status: 'ready',
  chunkCount: 1,
  tokenCount: 10,
  addedAt: 1,
  pinned: false,
})
const footprint = (workspaceId: number, atRestBytes: number): WorkspaceStorageFootprint => ({
  workspaceId,
  atRestBytes,
  openBytes: atRestBytes,
  vectorBytes: 0,
  metaDbBytes: atRestBytes,
  vectorCount: 0,
  estDecryptOnOpenMs: 0,
  encrypted: true,
  measured: true,
})

describe('library workspace and progress ownership', () => {
  it('stops retrying old local document IDs when the workspace changes during a batch', async () => {
    const first = deferred<Document>()
    const retry = vi.spyOn(window.api.documents, 'reindex').mockReturnValue(first.promise)
    vi.spyOn(window.api.documents, 'list').mockImplementation(async (id) =>
      id === 1
        ? [
            { ...doc(1, 'Failed one'), status: 'failed', id: 1 },
            { ...doc(1, 'Failed two'), status: 'failed', id: 2 },
          ]
        : [doc(2)],
    )
    const view = render(<LibraryView workspaceId={1} workspaceName="First" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry all (2)' }))
    expect(retry).toHaveBeenCalledExactlyOnceWith(1)
    view.rerender(<LibraryView workspaceId={2} workspaceName="Second" />)
    await screen.findByText('Current document')
    await act(async () => first.resolve(doc(1)))
    expect(retry).toHaveBeenCalledTimes(1)
  })
  it('ignores progress from another workspace with the same local document ID', async () => {
    let progress!: (event: IndexProgress) => void
    vi.spyOn(window.api.documents, 'list').mockResolvedValue([doc(2)])
    vi.spyOn(window.api.documents, 'onIndexProgress').mockImplementation((listener) => {
      progress = listener
      return () => {}
    })
    const view = render(<LibraryView workspaceId={2} workspaceName="Second" />)
    await screen.findByText('Current document')
    const failed = {
      workspaceId: 1,
      documentId: 1,
      title: 'Other workspace document',
      phase: 'failed' as const,
      step: 1,
      total: 1,
    }
    act(() => progress(failed))
    expect(view.container.querySelector('.library__status--failed')).toBeNull()
    act(() => progress({ ...failed, workspaceId: 2 }))
    expect(view.container.querySelector('.library__status--failed')).not.toBeNull()
  })

  it('does not reuse old-workspace progress or accept its delayed storage estimate', async () => {
    let progress!: (event: IndexProgress) => void
    const oldStorage = deferred<WorkspaceStorageFootprint>()
    vi.spyOn(window.api.documents, 'list').mockImplementation(async (id) => [doc(id)])
    vi.spyOn(window.api.documents, 'onIndexProgress').mockImplementation((listener) => {
      progress = listener
      return () => {}
    })
    vi.spyOn(window.api.workspaces, 'storageEstimate').mockImplementation((id) =>
      id === 1 ? oldStorage.promise : Promise.resolve(footprint(id, 333)),
    )
    const view = render(<LibraryView workspaceId={1} workspaceName="First" />)
    await screen.findByText('Current document')
    act(() =>
      progress({
        workspaceId: 1,
        documentId: 1,
        title: 'Current document',
        phase: 'embedding',
        step: 1,
        total: 2,
      }),
    )
    expect(view.container.querySelector('.library__status--indexing')).not.toBeNull()
    view.rerender(<LibraryView workspaceId={2} workspaceName="Second" />)
    await screen.findByText('Current document')
    await waitFor(() =>
      expect(view.container.querySelector('.library__storage')).toHaveTextContent('333'),
    )
    await act(async () => oldStorage.resolve(footprint(1, 999)))
    expect(view.container.querySelector('.library__storage')).toHaveTextContent('333')
    expect(view.container.querySelector('.library__storage')).not.toHaveTextContent('999')
    expect(view.container.querySelector('.library__status--indexing')).toBeNull()
  })

  it('does not restore re-embedding after a completion event overtakes a pending document read', async () => {
    let status!: (event: BackfillStatus) => void
    const pending = deferred<number[]>()
    vi.spyOn(window.api.documents, 'list').mockResolvedValue([doc(1)])
    vi.spyOn(window.api.embedder, 'pendingReembedDocs').mockReturnValue(pending.promise)
    vi.spyOn(window.api.embedder, 'onBackfillStatus').mockImplementation((listener) => {
      status = listener
      return () => {}
    })
    const view = render(<LibraryView workspaceId={1} workspaceName="First" />)
    await screen.findByText('Current document')
    act(() => status({ workspaceId: 1, state: 'running', done: 0, total: 1, message: null }))
    act(() => status({ workspaceId: 1, state: 'done', done: 1, total: 1, message: null }))
    await act(async () => pending.resolve([1]))
    expect(view.container.querySelector('.library__status--reembedding')).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Api } from '@preload/index'
import type { LibrarySearchHit } from '@shared/documents'
import { LibraryView } from './LibraryView'

function setApi(impl: Partial<Api['documents']>): void {
  Object.assign(window.api.documents, impl)
}

function hit(overrides: Partial<LibrarySearchHit> = {}): LibrarySearchHit {
  return {
    chunkId: 99,
    documentId: 7,
    documentTitle: 'Found.pdf',
    docType: 'pdf',
    pageFrom: 2,
    pageTo: 2,
    headingPath: null,
    score: 1,
    addedAt: 1000,
    byteSize: 1234,
    language: 'en',
    segments: [
      { text: 'a ', highlighted: false },
      { text: 'match', highlighted: true },
    ],
    ...overrides,
  }
}

describe('LibraryView search integration', () => {
  beforeEach(() => {
    setApi({
      list: () => Promise.resolve([]),
      listMissing: () => Promise.resolve([]),
      searchLibrary: () => Promise.resolve([]),
      getSourceForChunk: () => Promise.resolve(null),
      listChunksForDocument: () => Promise.resolve([]),
    })
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (Element.prototype as { scrollIntoView?: () => void }).scrollIntoView
  })

  it('accepts files across the library and clears the drag hint after import', async () => {
    const importFiles = vi.spyOn(window.api.documents, 'import')
    vi.spyOn(window.api.documents, 'getPathForFile').mockReturnValue('D:/Research/report.pdf')
    const { container } = render(<LibraryView workspaceId={1} workspaceName="WS" />)
    const library = container.querySelector('.library')!
    const dataTransfer = {
      types: ['Files'],
      files: [new File(['report'], 'report.pdf', { type: 'application/pdf' })],
    }
    fireEvent.dragEnter(library, { dataTransfer })
    expect(screen.getByText('Drop documents to import')).toBeInTheDocument()
    fireEvent.drop(screen.getByRole('heading', { name: 'WS' }), { dataTransfer })
    await waitFor(() => expect(importFiles).toHaveBeenCalledWith(1, 'D:/Research/report.pdf'))
    expect(screen.queryByText('Drop documents to import')).not.toBeInTheDocument()
  })

  it('runs a search as the user types and shows highlighted hits', async () => {
    setApi({ searchLibrary: () => Promise.resolve([hit()]) })
    render(<LibraryView workspaceId={1} workspaceName="WS" />)

    fireEvent.change(screen.getByPlaceholderText('Search documents…'), {
      target: { value: 'match' },
    })

    await waitFor(() => expect(screen.getByText('Found.pdf')).toBeTruthy())
    expect(screen.getByText('match').tagName).toBe('MARK')
    expect(screen.getByText('p. 2')).toBeTruthy()
  })

  it('distinguishes a failed search from no matches and retries the same query', async () => {
    const search = vi
      .spyOn(window.api.documents, 'searchLibrary')
      .mockRejectedValueOnce(new Error('Workspace unavailable'))
      .mockResolvedValueOnce([hit()])
    render(<LibraryView workspaceId={1} workspaceName="WS" />)
    fireEvent.change(screen.getByPlaceholderText('Search documents…'), {
      target: { value: 'match' },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace unavailable')
    expect(screen.queryByText('No documents match your search.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Found.pdf')).toBeVisible()
    expect(search).toHaveBeenCalledTimes(2)
    expect(search.mock.calls.map((call) => call[1])).toEqual(['match', 'match'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows import failures in the workspace instead of only logging them', async () => {
    vi.spyOn(window.api.documents, 'pickFiles').mockResolvedValue(['D:/Research/locked.pdf'])
    vi.spyOn(window.api.documents, 'import').mockRejectedValue(new Error('Access denied'))
    render(<LibraryView workspaceId={1} workspaceName="WS" />)
    fireEvent.click(screen.getByRole('button', { name: 'Import documents' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('locked.pdf: Access denied'),
    )
  })

  it('shows a failed library load with retry instead of the empty library prompt', async () => {
    vi.spyOn(window.api.documents, 'list')
      .mockRejectedValueOnce(new Error('Vault unavailable'))
      .mockResolvedValue([])
    render(<LibraryView workspaceId={1} workspaceName="WS" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Vault unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(window.api.documents.list).toHaveBeenCalledTimes(2)
  })

  it('opens the SourceViewer at the clicked hit chunk', async () => {
    const getSourceForChunk = vi.fn(() => Promise.resolve(null))
    setApi({ searchLibrary: () => Promise.resolve([hit({ chunkId: 99 })]), getSourceForChunk })
    render(<LibraryView workspaceId={1} workspaceName="WS" />)

    fireEvent.change(screen.getByPlaceholderText('Search documents…'), {
      target: { value: 'match' },
    })
    const row = await screen.findByRole('button', { name: /Found\.pdf/ })
    fireEvent.click(row)
    // Lazy reader loading includes module transformation in Vitest; wait for
    // that boundary explicitly rather than imposing a 1 s machine-speed gate.
    await act(async () => {
      await vi.dynamicImportSettled()
    })

    await waitFor(() => expect(getSourceForChunk).toHaveBeenCalledWith(99))
  })
})

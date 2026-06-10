import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
    delete (Element.prototype as { scrollIntoView?: () => void }).scrollIntoView
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

  it('opens the SourceViewer at the clicked hit chunk', async () => {
    const getSourceForChunk = vi.fn(() => Promise.resolve(null))
    setApi({ searchLibrary: () => Promise.resolve([hit({ chunkId: 99 })]), getSourceForChunk })
    render(<LibraryView workspaceId={1} workspaceName="WS" />)

    fireEvent.change(screen.getByPlaceholderText('Search documents…'), {
      target: { value: 'match' },
    })
    const row = await screen.findByRole('button', { name: /Found\.pdf/ })
    fireEvent.click(row)

    await waitFor(() => expect(getSourceForChunk).toHaveBeenCalledWith(99))
  })
})

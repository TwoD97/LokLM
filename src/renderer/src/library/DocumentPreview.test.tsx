import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Document, DocumentBytesResult } from '@shared/documents'
import { DocumentPreview } from './DocumentPreview'

const { renderPdf } = vi.hoisted(() => ({ renderPdf: vi.fn() }))
vi.mock('../chat/MultiPagePdfPreview', () => ({
  MultiPagePdfPreview: (props: unknown) => {
    renderPdf(props)
    return <div data-testid="verified-pdf" />
  },
}))
beforeEach(() => renderPdf.mockClear())

afterEach(() => vi.restoreAllMocks())
const doc = (id: number, status: Document['status'] = 'pending'): Document => ({
  id,
  workspaceId: 1,
  title: `Generated ${id}`,
  sourcePath: `loklm-generated:${id}`,
  mimeType: 'text/markdown',
  byteSize: 25,
  status,
  chunkCount: 0,
  tokenCount: 0,
  addedAt: 1,
  pinned: false,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const pdfDoc = (id = 1): Document => ({
  ...doc(id, 'ready'),
  sourcePath: `/sources/evidence-${id}.pdf`,
  mimeType: 'application/pdf',
  contentHash: 'a'.repeat(64),
})

describe('library PDF preview', () => {
  it('reads hash-verified bytes before opening the PDF worker', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const read = vi
      .spyOn(window.api.documents, 'readDocumentBytes')
      .mockResolvedValue({ status: 'verified', bytes })
    const chunks = vi.spyOn(window.api.documents, 'listChunksForDocument')
    render(<DocumentPreview doc={pdfDoc()} onClose={vi.fn()} />)
    await screen.findByTestId('verified-pdf')
    expect(read).toHaveBeenCalledExactlyOnceWith(1, 'a'.repeat(64))
    expect(renderPdf.mock.calls[0]![0]).toMatchObject({ bytes, targetPage: 1 })
    expect(chunks).not.toHaveBeenCalled()
  })

  it.each(['changed', 'unavailable', 'unverified'] as const)(
    'shows indexed text and an explanation when the PDF is %s',
    async (status) => {
      vi.spyOn(window.api.documents, 'readDocumentBytes').mockResolvedValue({ status })
      vi.spyOn(window.api.documents, 'listChunksForDocument').mockResolvedValue([
        {
          id: 11,
          documentId: 1,
          ordinal: 0,
          text: 'Stored original PDF text',
          tokenCount: 5,
          pageFrom: 1,
          pageTo: 1,
          headingPath: null,
          language: 'en',
        },
      ])
      render(<DocumentPreview doc={pdfDoc()} onClose={vi.fn()} />)
      await screen.findByText('Stored original PDF text')
      expect(screen.getByRole('status')).toHaveTextContent(/indexed text/i)
      expect(renderPdf).not.toHaveBeenCalled()
    },
  )

  it('discards stale bytes after changing document or indexed version', async () => {
    const prior = deferred<DocumentBytesResult>()
    const bytes = new Uint8Array([2])
    const read = vi
      .spyOn(window.api.documents, 'readDocumentBytes')
      .mockReturnValueOnce(prior.promise)
      .mockResolvedValue({ status: 'verified', bytes })
    const view = render(<DocumentPreview doc={pdfDoc()} onClose={vi.fn()} />)
    await waitFor(() => expect(read).toHaveBeenCalledOnce())
    view.rerender(
      <DocumentPreview doc={{ ...pdfDoc(), contentHash: 'b'.repeat(64) }} onClose={vi.fn()} />,
    )
    await screen.findByTestId('verified-pdf')
    expect(read).toHaveBeenLastCalledWith(1, 'b'.repeat(64))
    await act(async () => prior.resolve({ status: 'verified', bytes: new Uint8Array([1]) }))
    expect(renderPdf.mock.calls.at(-1)![0]).toMatchObject({ bytes })
    expect(renderPdf.mock.calls.every(([props]) => props.bytes === bytes)).toBe(true)
  })

  it('does not open a PDF or fetch a fallback after the reader closes', async () => {
    const pending = deferred<DocumentBytesResult>()
    vi.spyOn(window.api.documents, 'readDocumentBytes').mockReturnValue(pending.promise)
    const chunks = vi.spyOn(window.api.documents, 'listChunksForDocument')
    const view = render(<DocumentPreview doc={pdfDoc()} onClose={vi.fn()} />)
    view.unmount()
    await act(async () => pending.resolve({ status: 'changed' }))
    expect(renderPdf).not.toHaveBeenCalled()
    expect(chunks).not.toHaveBeenCalled()
  })
})

describe('generated document preview', () => {
  it.each(['pending', 'ready'] as const)(
    'reads the encrypted full source while indexing is %s and formats Markdown by MIME',
    async (status) => {
      const read = vi
        .spyOn(window.api.documents, 'readGeneratedText')
        .mockResolvedValue('# Saved source\n\nAll paragraphs remain readable.')
      const chunks = vi.spyOn(window.api.documents, 'listChunksForDocument')
      render(<DocumentPreview doc={doc(1, status)} onClose={vi.fn()} />)
      expect(await screen.findByRole('heading', { name: 'Saved source' })).toBeInTheDocument()
      expect(screen.getByText('All paragraphs remain readable.')).toBeInTheDocument()
      expect(read).toHaveBeenCalledExactlyOnceWith(1)
      expect(chunks).not.toHaveBeenCalled()
      expect(screen.queryByText('No chunks yet.')).not.toBeInTheDocument()
    },
  )

  it('shows an encrypted source read error instead of an empty successful preview', async () => {
    vi.spyOn(window.api.documents, 'readGeneratedText').mockRejectedValue(new Error('Vault locked'))
    render(<DocumentPreview doc={doc(1)} onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Vault locked')
  })

  it('does not replace the current document with a late prior source response', async () => {
    const prior = deferred<string | null>()
    vi.spyOn(window.api.documents, 'readGeneratedText').mockImplementation((id) =>
      id === 1 ? prior.promise : Promise.resolve('# Current source'),
    )
    const view = render(<DocumentPreview doc={doc(1)} onClose={vi.fn()} />)
    view.rerender(<DocumentPreview doc={doc(2)} onClose={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Current source' })
    await act(async () => prior.resolve('# Previous source'))
    expect(screen.queryByRole('heading', { name: 'Previous source' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Current source' })).toBeInTheDocument()
  })

  it('contains focus while open and restores the opener after closing', async () => {
    vi.spyOn(window.api.documents, 'readGeneratedText').mockResolvedValue('Saved text')
    const opener = document.createElement('button')
    opener.textContent = 'Read source'
    document.body.append(opener)
    opener.focus()
    const view = render(<DocumentPreview doc={doc(1)} onClose={vi.fn()} />)
    await screen.findByText('Saved text')
    const close = screen.getByRole('button', { name: 'Close preview' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(close).toHaveFocus()
    view.unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})

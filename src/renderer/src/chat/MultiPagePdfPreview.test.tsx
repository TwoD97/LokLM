import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { MultiPagePdfPreview } from './MultiPagePdfPreview'

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function pdfTask() {
  const page = { getViewport: () => ({ width: 600, height: 800 }), cleanup: vi.fn() }
  // Zero displayed pages keeps these tests about worker/bytes ownership rather
  // than mocking the canvas renderer; the document probe still runs normally.
  const doc = { numPages: 0, getPage: vi.fn().mockResolvedValue(page) }
  return { promise: Promise.resolve(doc), destroy: vi.fn().mockResolvedValue(undefined) }
}

beforeEach(() => {
  getDocument.mockReset()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PDF preview ownership', () => {
  it('releases its worker when the preview closes and reloads reused document IDs', async () => {
    const firstBytes = new Uint8Array([1])
    const nextBytes = new Uint8Array([2])
    const read = vi
      .spyOn(window.api.documents, 'readDocumentBytes')
      .mockResolvedValueOnce(firstBytes)
      .mockResolvedValueOnce(nextBytes)
    const first = pdfTask()
    const second = pdfTask()
    getDocument.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const view = render(<MultiPagePdfPreview documentId={1} targetPage={1} />)
    await waitFor(() => expect(getDocument).toHaveBeenCalledOnce())
    view.unmount()
    expect(first.destroy).toHaveBeenCalledOnce()
    // A new workspace may have the same local document ID.
    render(<MultiPagePdfPreview documentId={1} targetPage={1} />)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(getDocument).toHaveBeenLastCalledWith({ data: nextBytes })
  })

  it('does not start a worker when the byte read finishes after closing', async () => {
    const bytes = deferred<Uint8Array>()
    vi.spyOn(window.api.documents, 'readDocumentBytes').mockReturnValue(bytes.promise)
    const view = render(<MultiPagePdfPreview documentId={1} targetPage={1} />)
    view.unmount()
    await act(async () => bytes.resolve(new Uint8Array([1])))
    expect(getDocument).not.toHaveBeenCalled()
  })

  it('destroys a loading worker before switching documents', async () => {
    vi.spyOn(window.api.documents, 'readDocumentBytes').mockResolvedValue(new Uint8Array([1]))
    const pending = deferred<unknown>()
    const destroy = vi.fn().mockResolvedValue(undefined)
    getDocument
      .mockReturnValueOnce({ promise: pending.promise, destroy })
      .mockReturnValue(pdfTask())
    const view = render(<MultiPagePdfPreview documentId={1} targetPage={1} />)
    await waitFor(() => expect(getDocument).toHaveBeenCalledOnce())
    view.rerender(<MultiPagePdfPreview documentId={2} targetPage={1} />)
    expect(destroy).toHaveBeenCalledOnce()
    await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(2))
  })

  it('retries failed reads on reopen rather than retaining a rejected cache entry', async () => {
    const read = vi
      .spyOn(window.api.documents, 'readDocumentBytes')
      .mockRejectedValueOnce(new Error('File unavailable'))
      .mockResolvedValueOnce(new Uint8Array([1]))
    getDocument.mockReturnValue(pdfTask())
    const view = render(<MultiPagePdfPreview documentId={1} targetPage={1} />)
    await screen.findByText(/File unavailable/)
    view.unmount()
    render(<MultiPagePdfPreview documentId={1} targetPage={1} />)
    await waitFor(() => expect(getDocument).toHaveBeenCalledOnce())
    expect(read).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/File unavailable/)).not.toBeInTheDocument()
  })

  it('does not leak the abandoned effect in React StrictMode', async () => {
    vi.spyOn(window.api.documents, 'readDocumentBytes').mockResolvedValue(new Uint8Array([1]))
    const task = pdfTask()
    getDocument.mockReturnValue(task)
    const view = render(
      <StrictMode>
        <MultiPagePdfPreview documentId={1} targetPage={1} />
      </StrictMode>,
    )
    await waitFor(() => expect(getDocument).toHaveBeenCalledOnce())
    view.unmount()
    expect(task.destroy).toHaveBeenCalledOnce()
  })
})

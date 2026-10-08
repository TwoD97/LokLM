import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Api } from '@preload/index'
import type { ChunkSource, DocumentBytesResult, DocumentChunk } from '@shared/documents'
import { SourceViewer } from './SourceViewer'

const { renderPdf } = vi.hoisted(() => ({ renderPdf: vi.fn() }))
vi.mock('./MultiPagePdfPreview', () => ({
  MultiPagePdfPreview: (props: unknown) => {
    renderPdf(props)
    return <div data-testid="verified-pdf" />
  },
}))

const pdfSource: ChunkSource = {
  documentId: 5,
  title: 'Evidence.pdf',
  mimeType: 'application/pdf',
  sourcePath: '/x/Evidence.pdf',
  contentHash: 'a'.repeat(64),
  headingPath: null,
  chunkPageFrom: 2,
  chunkPageTo: 2,
}
function indexedChunk(id = 42, text = 'Original indexed evidence'): DocumentChunk {
  return {
    id,
    documentId: 5,
    ordinal: 1,
    text,
    tokenCount: 3,
    pageFrom: 2,
    pageTo: 2,
    headingPath: null,
    language: 'en',
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setApi(impl: Partial<Api['documents']>): void {
  Object.assign(window.api.documents, impl)
}

describe('SourceViewer', () => {
  beforeEach(() => {
    renderPdf.mockClear()
    setApi({
      listChunksForDocument: () => Promise.resolve([]),
      getSourceForChunk: () => Promise.resolve(null),
      readDocumentBytes: () => Promise.resolve({ status: 'unavailable' }),
    })
    // jsdom doesn't implement scrollIntoView; the modal calls it on mount.
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    // Delete (not reassign to undefined) so checks for the method behave as
    // they would in fresh jsdom.
    delete (Element.prototype as { scrollIntoView?: () => void }).scrollIntoView
  })

  it('passes only hash-verified bytes to PDF.js, without fetching unused text', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const read = vi.fn().mockResolvedValue({ status: 'verified', bytes })
    const list = vi.fn().mockResolvedValue([indexedChunk()])
    setApi({
      getSourceForChunk: async () => pdfSource,
      readDocumentBytes: read,
      listChunksForDocument: list,
    })
    render(<SourceViewer chunkId={42} onClose={() => undefined} />)
    await screen.findByTestId('verified-pdf')
    expect(read).toHaveBeenCalledWith(5, pdfSource.contentHash)
    expect(renderPdf.mock.calls[0]![0]).toMatchObject({ bytes, targetPage: 2 })
    expect(list).not.toHaveBeenCalled()
  })

  it.each(['changed', 'unavailable', 'unverified'] as const)(
    'shows original indexed text with a notice when PDF bytes are %s',
    async (status) => {
      setApi({
        getSourceForChunk: async () => pdfSource,
        readDocumentBytes: async () => ({ status }),
        listChunksForDocument: async () => [indexedChunk()],
      })
      render(<SourceViewer chunkId={42} onClose={() => undefined} />)
      await screen.findByText('Original indexed evidence')
      expect(screen.getByRole('status')).toHaveTextContent(/indexed text/i)
      expect(screen.queryByTestId('verified-pdf')).not.toBeInTheDocument()
      expect(renderPdf).not.toHaveBeenCalled()
    },
  )

  it('does not substitute newly indexed chunks if refresh removed the cited passage', async () => {
    setApi({
      getSourceForChunk: async () => pdfSource,
      readDocumentBytes: async () => ({ status: 'changed' }),
      listChunksForDocument: async () => [indexedChunk(43, 'Unrelated replacement content')],
    })
    render(<SourceViewer chunkId={42} onClose={() => undefined} />)
    expect(await screen.findByRole('status')).toHaveTextContent(/passage is no longer available/i)
    expect(screen.queryByText('Unrelated replacement content')).not.toBeInTheDocument()
    expect(renderPdf).not.toHaveBeenCalled()
  })

  it('explains when the cited passage was already removed before opening', async () => {
    const read = vi.fn()
    const list = vi.fn()
    setApi({
      getSourceForChunk: async () => null,
      readDocumentBytes: read,
      listChunksForDocument: list,
    })
    render(<SourceViewer chunkId={42} onClose={() => undefined} />)
    expect(await screen.findByRole('status')).toHaveTextContent(/passage is no longer available/i)
    expect(read).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
    expect(renderPdf).not.toHaveBeenCalled()
  })

  it('discards a late PDF byte result after navigating to a different citation', async () => {
    const pending = deferred<DocumentBytesResult>()
    const read = vi.fn().mockReturnValue(pending.promise)
    setApi({
      getSourceForChunk: async (id) =>
        id === 42
          ? pdfSource
          : {
              ...pdfSource,
              documentId: 6,
              sourcePath: '/x/current.txt',
              mimeType: 'text/plain',
            },
      readDocumentBytes: read,
      listChunksForDocument: async () => [indexedChunk(60, 'Current citation evidence')],
    })
    const view = render(<SourceViewer chunkId={42} onClose={() => undefined} />)
    await waitFor(() => expect(read).toHaveBeenCalledOnce())
    view.rerender(<SourceViewer chunkId={60} onClose={() => undefined} />)
    await screen.findByText('Current citation evidence')
    await act(async () => pending.resolve({ status: 'verified', bytes: new Uint8Array([1]) }))
    expect(screen.getByText('Current citation evidence')).toBeInTheDocument()
    expect(renderPdf).not.toHaveBeenCalled()
  })

  it('discards a late indexed fallback after closing', async () => {
    const pending = deferred<DocumentChunk[]>()
    const list = vi.fn().mockReturnValue(pending.promise)
    setApi({
      getSourceForChunk: async () => pdfSource,
      readDocumentBytes: async () => ({ status: 'changed' }),
      listChunksForDocument: list,
    })
    const view = render(<SourceViewer chunkId={42} onClose={() => undefined} />)
    await waitFor(() => expect(list).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => pending.resolve([indexedChunk()]))
    expect(screen.queryByText('Original indexed evidence')).not.toBeInTheDocument()
    expect(renderPdf).not.toHaveBeenCalled()
  })

  it('renders all chunks of the document and accents the cited one', async () => {
    setApi({
      getSourceForChunk: () =>
        Promise.resolve({
          documentId: 5,
          title: 'Test.md',
          mimeType: null,
          sourcePath: '/x/Test.md',
          headingPath: null,
          chunkPageFrom: null,
          chunkPageTo: null,
        }),
      listChunksForDocument: () =>
        Promise.resolve([
          {
            id: 1,
            documentId: 5,
            ordinal: 1,
            text: 'previous chunk',
            tokenCount: 2,
            pageFrom: null,
            pageTo: null,
            headingPath: null,
            language: null,
          },
          {
            id: 2,
            documentId: 5,
            ordinal: 2,
            text: 'the target chunk',
            tokenCount: 3,
            pageFrom: null,
            pageTo: null,
            headingPath: null,
            language: null,
          },
          {
            id: 3,
            documentId: 5,
            ordinal: 3,
            text: 'next chunk',
            tokenCount: 2,
            pageFrom: null,
            pageTo: null,
            headingPath: null,
            language: null,
          },
        ]),
    })

    const { container } = render(
      <SourceViewer chunkId={2} documentTitle="Test.md" onClose={() => undefined} />,
    )
    await waitFor(() => expect(screen.getByText('the target chunk')).toBeInTheDocument())
    const cited = container.querySelector('.source-viewer__doc-section--cited')
    expect(cited?.textContent).toContain('the target chunk')
    expect(screen.getByText('previous chunk')).toBeInTheDocument()
    expect(screen.getByText('next chunk')).toBeInTheDocument()
    expect(screen.getByText(/Test\.md/)).toBeInTheDocument()
  })

  it('renders a code source as the whole syntax-highlighted file', async () => {
    setApi({
      getSourceForChunk: () =>
        Promise.resolve({
          documentId: 9,
          title: 'AuthService.ts',
          mimeType: null,
          sourcePath: 'src/main/services/auth/AuthService.ts',
          headingPath: ['AuthService.ts', 'AuthService'],
          chunkPageFrom: null,
          chunkPageTo: null,
        }),
      listChunksForDocument: () =>
        Promise.resolve([
          {
            id: 10,
            documentId: 9,
            ordinal: 1,
            text: 'import argon2 from "argon2"',
            tokenCount: null,
            pageFrom: null,
            pageTo: null,
            headingPath: ['AuthService.ts'],
            language: null,
          },
          {
            id: 11,
            documentId: 9,
            ordinal: 2,
            text: 'export class AuthService {}',
            tokenCount: null,
            pageFrom: null,
            pageTo: null,
            headingPath: ['AuthService.ts', 'AuthService'],
            language: null,
          },
        ]),
    })

    const { container } = render(
      <SourceViewer chunkId={11} documentTitle="AuthService.ts" onClose={() => undefined} />,
    )
    await waitFor(() =>
      expect(container.querySelector('.source-viewer__doc--code')).toBeInTheDocument(),
    )
    // Whole file: every chunk rendered as a highlight.js code block, not just the cited one.
    expect(container.querySelectorAll('pre code.hljs').length).toBeGreaterThanOrEqual(2)
    expect(container.textContent).toContain('export class AuthService')
    expect(container.textContent).toContain('import argon2')
    // Cited chunk still accented.
    expect(container.querySelector('.source-viewer__doc-section--cited')?.textContent).toContain(
      'AuthService',
    )
  })

  it('renders fuzzy-highlighted marks for the cited sentence', async () => {
    setApi({
      getSourceForChunk: () =>
        Promise.resolve({
          documentId: 7,
          title: 'Frist.md',
          mimeType: null,
          sourcePath: '/x/Frist.md',
          headingPath: null,
          chunkPageFrom: null,
          chunkPageTo: null,
        }),
      listChunksForDocument: () =>
        Promise.resolve([
          {
            id: 42,
            documentId: 7,
            ordinal: 1,
            text: 'Die Frist beträgt vierzehn Tage ab Bescheid.',
            tokenCount: null,
            pageFrom: null,
            pageTo: null,
            headingPath: null,
            language: null,
          },
        ]),
    })

    const { container } = render(
      <SourceViewer
        chunkId={42}
        messageText="Die Frist beträgt vierzehn Tage [doc:7, chunk:42]."
        onClose={() => undefined}
      />,
    )
    await waitFor(() => expect(container.querySelector('.source-viewer__mark')).toBeInTheDocument())
    const mark = container.querySelector('.source-viewer__mark')
    expect(mark?.textContent?.toLowerCase()).toContain('frist beträgt vierzehn tage')
  })

  it('skips the whole-message highlight fallback when wholeMessageFallback is false', async () => {
    // Chat footer click: the answer carries no [doc:X, chunk:42] marker for this
    // chunk, so there is no specific cited sentence. With the fallback off we
    // render the chunk but mark nothing — better than highlighting an arbitrary
    // phrase the whole answer happens to share with the source.
    setApi({
      getSourceForChunk: () =>
        Promise.resolve({
          documentId: 7,
          title: 'Frist.md',
          mimeType: null,
          sourcePath: '/x/Frist.md',
          headingPath: null,
          chunkPageFrom: null,
          chunkPageTo: null,
        }),
      listChunksForDocument: () =>
        Promise.resolve([
          {
            id: 42,
            documentId: 7,
            ordinal: 1,
            text: 'Die Frist beträgt vierzehn Tage ab Bescheid.',
            tokenCount: null,
            pageFrom: null,
            pageTo: null,
            headingPath: null,
            language: null,
          },
        ]),
    })

    const { container } = render(
      <SourceViewer
        chunkId={42}
        messageText="Die Frist beträgt vierzehn Tage."
        wholeMessageFallback={false}
        onClose={() => undefined}
      />,
    )
    await waitFor(() => expect(container.textContent).toContain('vierzehn Tage'))
    expect(container.querySelector('.source-viewer__mark')).toBeNull()
  })

  it('highlights the grounding passage from the whole answer when no marker exists', async () => {
    // Chat "Quellen" footer click: a small / German answer emitted no inline
    // [doc,chunk] marker, so the whole answer is fuzzy-matched against the cited
    // chunk. With the fallback on (the chat default) the passage the answer
    // overlaps lights up instead of opening the source with nothing marked.
    setApi({
      getSourceForChunk: () =>
        Promise.resolve({
          documentId: 7,
          title: 'Frist.md',
          mimeType: null,
          sourcePath: '/x/Frist.md',
          headingPath: null,
          chunkPageFrom: null,
          chunkPageTo: null,
        }),
      listChunksForDocument: () =>
        Promise.resolve([
          {
            id: 42,
            documentId: 7,
            ordinal: 1,
            text: 'Die Frist beträgt vierzehn Tage ab Bescheid.',
            tokenCount: null,
            pageFrom: null,
            pageTo: null,
            headingPath: null,
            language: null,
          },
        ]),
    })

    const { container } = render(
      <SourceViewer
        chunkId={42}
        messageText="Die Frist beträgt vierzehn Tage."
        wholeMessageFallback={true}
        onClose={() => undefined}
      />,
    )
    await waitFor(() => expect(container.querySelector('.source-viewer__mark')).toBeInTheDocument())
    const mark = container.querySelector('.source-viewer__mark')
    expect(mark?.textContent?.toLowerCase()).toContain('frist beträgt vierzehn tage')
  })

  it('renders empty state when the document has no chunks', async () => {
    setApi({
      getSourceForChunk: () =>
        Promise.resolve({
          documentId: 5,
          title: 'Empty',
          mimeType: null,
          sourcePath: '/x/empty.md',
          headingPath: null,
          chunkPageFrom: null,
          chunkPageTo: null,
        }),
      listChunksForDocument: () => Promise.resolve([]),
    })
    render(<SourceViewer chunkId={42} onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByText(/no chunks available/i)).toBeInTheDocument())
  })

  it('Escape key calls onClose', async () => {
    const onClose = vi.fn()
    render(<SourceViewer chunkId={1} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('close button calls onClose', async () => {
    const onClose = vi.fn()
    render(<SourceViewer chunkId={1} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText(/close source viewer/i))
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking the backdrop closes the modal', async () => {
    const onClose = vi.fn()
    const { container } = render(<SourceViewer chunkId={1} onClose={onClose} />)
    const backdrop = container.querySelector('.source-viewer__backdrop') as HTMLElement
    fireEvent.mouseDown(backdrop, { target: backdrop })
    expect(onClose).toHaveBeenCalled()
  })
})

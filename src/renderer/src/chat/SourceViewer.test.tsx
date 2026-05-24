import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Api } from '@preload/index'
import { SourceViewer } from './SourceViewer'

function setApi(impl: Partial<Api['documents']>): void {
  Object.assign(window.api.documents, impl)
}

describe('SourceViewer', () => {
  beforeEach(() => {
    setApi({
      listChunksForDocument: () => Promise.resolve([]),
      getSourceForChunk: () => Promise.resolve(null),
    })
    // jsdom doesn't implement scrollIntoView; the modal calls it on mount.
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    // Delete (not reassign to undefined) so checks for the method behave as
    // they would in fresh jsdom.
    delete (Element.prototype as { scrollIntoView?: () => void }).scrollIntoView
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

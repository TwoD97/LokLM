import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SourceViewer } from './SourceViewer'

describe('SourceViewer', () => {
  beforeEach(() => {
    ;(
      window.api.documents as unknown as {
        getChunkWithContext: () => Promise<unknown[]>
      }
    ).getChunkWithContext = () => Promise.resolve([])
  })

  it('renders loading state, then chunks with target highlighted', async () => {
    ;(
      window.api.documents as unknown as {
        getChunkWithContext: () => Promise<unknown[]>
      }
    ).getChunkWithContext = () =>
      Promise.resolve([
        {
          id: 1,
          documentId: 5,
          ordinal: 1,
          text: 'previous chunk',
          tokenCount: 2,
          pageFrom: 1,
          pageTo: 1,
          isTarget: false,
        },
        {
          id: 2,
          documentId: 5,
          ordinal: 2,
          text: 'the target chunk',
          tokenCount: 3,
          pageFrom: 1,
          pageTo: 1,
          isTarget: true,
        },
        {
          id: 3,
          documentId: 5,
          ordinal: 3,
          text: 'next chunk',
          tokenCount: 2,
          pageFrom: 2,
          pageTo: 2,
          isTarget: false,
        },
      ])

    const { container } = render(
      <SourceViewer chunkId={2} documentTitle="Test.pdf" onClose={() => undefined} />,
    )
    await waitFor(() => expect(screen.getByText('the target chunk')).toBeInTheDocument())
    const target = container.querySelector('.source-viewer__chunk--target')
    expect(target?.textContent).toContain('the target chunk')
    expect(screen.getByText('previous chunk')).toBeInTheDocument()
    expect(screen.getByText('next chunk')).toBeInTheDocument()
    expect(screen.getByText(/Test\.pdf/)).toBeInTheDocument()
  })

  it('renders empty state when SQL returns no rows', async () => {
    ;(
      window.api.documents as unknown as {
        getChunkWithContext: () => Promise<unknown[]>
      }
    ).getChunkWithContext = () => Promise.resolve([])
    render(<SourceViewer chunkId={42} onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByText(/no surrounding context/i)).toBeInTheDocument())
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
})

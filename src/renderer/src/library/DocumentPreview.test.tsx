import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Document } from '@shared/documents'
import { DocumentPreview } from './DocumentPreview'

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

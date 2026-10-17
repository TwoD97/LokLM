import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Document } from '@shared/documents'
import { SummaryModal } from './SummaryModal'

const doc: Document = {
  id: 1,
  workspaceId: 1,
  title: 'Research notes',
  sourcePath: '/notes.txt',
  mimeType: 'text/plain',
  byteSize: 100,
  status: 'ready',
  chunkCount: 1,
  tokenCount: 20,
  addedAt: 0,
  pinned: false,
}

afterEach(() => vi.restoreAllMocks())

describe('SummaryModal recovery and keyboard access', () => {
  it('contains focus during loading and returns it to the opener', () => {
    vi.spyOn(window.api.documents, 'summarize').mockReturnValue(new Promise(() => {}))
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(<SummaryModal doc={doc} onClose={vi.fn()} />)
    const close = screen.getByRole('button', { name: /close/i })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(/summar/i)
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(close).toHaveFocus()
    view.unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('announces a failed summary and retries without reopening the document', async () => {
    const summarize = vi
      .spyOn(window.api.documents, 'summarize')
      .mockRejectedValueOnce(new Error('worker disconnected'))
      .mockResolvedValue({ summary: 'Recovered summary', cached: false })
    render(<SummaryModal doc={doc} onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('worker disconnected')
    const retry = screen.getByRole('button', { name: /retry/i })
    retry.focus()
    fireEvent.click(retry)
    expect(await screen.findByText('Recovered summary')).toBeVisible()
    expect(screen.getByRole('button', { name: /close/i })).toHaveFocus()
    expect(summarize).toHaveBeenCalledTimes(2)
    expect(summarize).toHaveBeenLastCalledWith(doc.id)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores an old document summary after the selected document changes', async () => {
    let finish!: (value: { summary: string; cached: boolean }) => void
    vi.spyOn(window.api.documents, 'summarize')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        }),
      )
      .mockResolvedValue({ summary: 'Current summary', cached: false })
    const view = render(<SummaryModal doc={doc} onClose={vi.fn()} />)
    view.rerender(<SummaryModal doc={{ ...doc, id: 2 }} onClose={vi.fn()} />)
    await screen.findByText('Current summary')
    await act(async () => finish({ summary: 'Old summary', cached: false }))
    expect(screen.queryByText('Old summary')).toBeNull()
    expect(screen.getByText('Current summary')).toBeVisible()
  })
})

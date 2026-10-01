import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ReaderBoundary, SourceViewer } from './lazyReaders'

const gate = vi.hoisted(() => {
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  return { ready, release }
})
vi.mock('../chat/SourceViewer', async () => {
  await gate.ready
  return { SourceViewer: () => <p>Late reader content</p> }
})
function Fixture(): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Read source</button>
      {open && (
        <ReaderBoundary label="Document preview" onClose={() => setOpen(false)}>
          <SourceViewer chunkId={1} onClose={() => setOpen(false)} />
        </ReaderBoundary>
      )}
    </>
  )
}

it('keeps loading readers keyboard-accessible and does not reopen a dismissed pending import', async () => {
  render(<Fixture />)
  const opener = screen.getByRole('button', { name: 'Read source' })
  opener.focus()
  fireEvent.click(opener)
  expect(await screen.findByRole('dialog', { name: 'Document preview' })).toBeVisible()
  const close = screen.getByRole('button', { name: 'Close' })
  expect(close).toHaveFocus()
  fireEvent.keyDown(close, { key: 'Tab' })
  expect(close).toHaveFocus()
  fireEvent.keyDown(close, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
  await act(async () => gate.release())
  expect(screen.queryByText('Late reader content')).not.toBeInTheDocument()
})

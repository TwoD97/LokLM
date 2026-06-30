import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.removeItem('loklm:sidebar:pinned')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders rail when not pinned and not peeking', async () => {
    render(<AppShell />)
    await waitFor(() => {
      expect(screen.getByLabelText(/library/i)).toBeInTheDocument()
    })
  })

  it('pin button toggles expanded state', async () => {
    const { container } = render(<AppShell />)
    await waitFor(() => container.querySelector('.app-shell'))

    const sidebar = container.querySelector('.app-shell__sidebar') as HTMLElement
    fireEvent.mouseEnter(sidebar)

    const pinBtn = await screen.findByLabelText(/pin sidebar/i)
    fireEvent.click(pinBtn)
    fireEvent.mouseLeave(sidebar)
    await waitFor(() => {
      expect(container.querySelector('.app-shell--expanded')).not.toBeNull()
    })

    fireEvent.mouseEnter(sidebar)
    const unpin = await screen.findByLabelText(/unpin sidebar/i)
    fireEvent.click(unpin)
    fireEvent.mouseLeave(sidebar)
    await waitFor(() => {
      expect(container.querySelector('.app-shell--expanded')).toBeNull()
    })
  })

  it('chat view shows "create or select a workspace" when none active', async () => {
    render(<AppShell />)
    await waitFor(() => screen.getByLabelText(/^chat$/i))
    fireEvent.click(screen.getByLabelText(/^chat$/i))
    await waitFor(() => {
      expect(screen.getByText(/create or select a workspace/i)).toBeInTheDocument()
    })
  })

  // Regression: tabs are kept mounted across switches (KeepAlive) so their state
  // survives. Before that, a tab switch unmounted the view and its result was
  // lost — a translation/transcription/rewrite vanished, and a generating quiz
  // reverted to "Starting…". This drives the translation path because it asserts
  // without mocking an event stream, but the persistence mechanism is shared.
  it("keeps a tab's result after switching away and back (KeepAlive)", async () => {
    vi.spyOn(window.api.translation, 'status').mockResolvedValue({
      state: 'ready',
      message: null,
      sidecarAvailable: true,
    })
    vi.spyOn(window.api.translation, 'translate').mockResolvedValue({
      text: 'KEEPALIVE_RESULT',
      detected: null,
      sentences: 1,
      ms: 100,
    })

    render(<AppShell />)
    fireEvent.click(await screen.findByLabelText('Translation'))

    const source = await screen.findByPlaceholderText(/type or paste text to translate/i)
    fireEvent.change(source, { target: { value: 'hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))

    await screen.findByText('KEEPALIVE_RESULT')

    // Switch to another tab and back — with KeepAlive the view stays mounted, so
    // the result is still on screen rather than reset to the empty placeholder.
    fireEvent.click(screen.getByLabelText('Write'))
    await screen.findByRole('button', { name: 'Rewrite' })
    fireEvent.click(screen.getByLabelText('Translation'))

    expect(screen.getByText('KEEPALIVE_RESULT')).toBeInTheDocument()
  })

  // Regression: Library is NOT kept-alive (it unmounts on tab switch), so its
  // search query + table page are lifted to AppShell to survive the round trip.
  it('keeps the Library search query after a tab switch (lifted to AppShell)', async () => {
    vi.spyOn(window.api.workspaces, 'list').mockResolvedValue([
      { id: 1, name: 'WS', createdAt: 0, type: 'library', encryptionLevel: 'full' },
    ])

    render(<AppShell />)
    // Library is the default view; the sole workspace auto-activates.
    const searchBox = await screen.findByPlaceholderText(/search documents/i)
    fireEvent.change(searchBox, { target: { value: 'invoice' } })
    expect((searchBox as HTMLInputElement).value).toBe('invoice')

    // Leave Library (which unmounts it) and return — the lifted query repopulates
    // the freshly-remounted search box instead of resetting to empty.
    fireEvent.click(screen.getByLabelText('Write'))
    await screen.findByRole('button', { name: 'Rewrite' })
    fireEvent.click(screen.getByLabelText('Library'))

    const restored = await screen.findByPlaceholderText(/search documents/i)
    expect((restored as HTMLInputElement).value).toBe('invoice')
  })
})

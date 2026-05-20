import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.removeItem('loklm:sidebar:pinned')
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
})

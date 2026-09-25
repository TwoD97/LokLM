import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BehaviorSection } from './BehaviorSection'
import { DEFAULT_SETTINGS } from '@shared/settings'

describe('BehaviorSection', () => {
  it('provides a focusable disclosure button linked to a persistent, named region', () => {
    render(<BehaviorSection settings={DEFAULT_SETTINGS} update={async () => {}} />)
    const header = screen.getByRole('button', { name: 'Session & behavior' })
    const region = screen.getByRole('region', { name: 'Session & behavior' })
    expect(header).toHaveAttribute('type', 'button')
    expect(header.tabIndex).toBe(0)
    expect(header).toHaveAttribute('aria-controls', region.id)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    header.focus()
    fireEvent.click(header)
    expect(header).toHaveFocus()
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(region).not.toBeVisible()
    expect(screen.queryByRole('radio', { name: 'Unload' })).not.toBeInTheDocument()
    fireEvent.click(header)
    expect(region).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Unload' })).toBeInTheDocument()
  })
  it('renders the conversation-switch and auto-lock controls', () => {
    render(<BehaviorSection settings={DEFAULT_SETTINGS} update={async () => {}} />)
    expect(screen.getByRole('radio', { name: 'Unload' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Never' })).toBeInTheDocument()
  })
  it('updates runtime.conversationSwitch to unload', () => {
    const update = vi.fn(async () => {})
    render(<BehaviorSection settings={DEFAULT_SETTINGS} update={update} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Unload' }))
    expect(update).toHaveBeenCalledWith({ runtime: { conversationSwitch: 'unload' } })
  })
  it('updates security.autoLockMinutes to 5', () => {
    const update = vi.fn(async () => {})
    render(<BehaviorSection settings={DEFAULT_SETTINGS} update={update} />)
    fireEvent.click(screen.getByRole('radio', { name: '5 min' }))
    expect(update).toHaveBeenCalledWith({ security: { autoLockMinutes: 5 } })
  })
})

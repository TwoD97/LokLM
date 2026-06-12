import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BehaviorSection } from './BehaviorSection'
import { DEFAULT_SETTINGS } from '@shared/settings'

describe('BehaviorSection', () => {
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

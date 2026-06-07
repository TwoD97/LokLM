import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsModal } from './SettingsModal'

describe('SettingsModal', () => {
  it('keeps the active tab when the parent re-renders with a new onClose (e.g. a settings update)', () => {
    // App passes an inline `onClose={() => setSettingsOpen(false)}`, so every App
    // re-render (which a settings update triggers via useSettings) hands the modal
    // a fresh onClose identity. The active tab must survive that.
    const { rerender } = render(<SettingsModal open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /About/i }))
    expect(screen.getByRole('tab', { name: /About/i })).toHaveAttribute('aria-selected', 'true')

    rerender(<SettingsModal open={true} onClose={() => {}} />) // new onClose identity
    expect(screen.getByRole('tab', { name: /About/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('resets to Basic when re-opened', () => {
    const { rerender } = render(<SettingsModal open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /About/i }))
    rerender(<SettingsModal open={false} onClose={() => {}} />)
    rerender(<SettingsModal open={true} onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: /Basic/i })).toHaveAttribute('aria-selected', 'true')
  })
})

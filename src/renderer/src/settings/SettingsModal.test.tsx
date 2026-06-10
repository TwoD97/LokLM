import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsModal } from './SettingsModal'

describe('SettingsModal', () => {
  it('does not close when a drag (e.g. selecting input text) starts inside and releases on the backdrop', () => {
    const onClose = vi.fn()
    render(<SettingsModal open={true} onClose={onClose} />)
    // press starts inside the modal (selecting text in a field)...
    fireEvent.mouseDown(screen.getByRole('dialog'))
    // ...mouse released outside, so the click resolves on the backdrop.
    fireEvent.click(screen.getByRole('presentation'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on a genuine backdrop click', () => {
    const onClose = vi.fn()
    render(<SettingsModal open={true} onClose={onClose} />)
    const backdrop = screen.getByRole('presentation')
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

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

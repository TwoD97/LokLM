import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsModal } from './SettingsModal'

describe('SettingsModal', () => {
  it('opens System settings directly with focus on its tab', () => {
    render(<SettingsModal open initialTab="system" onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: 'System & models' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'System & models' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })
  it('contains keyboard focus, supports arrow-key tabs and returns focus on close', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { rerender } = render(<SettingsModal open onClose={() => {}} />)
    const basic = screen.getByRole('tab', { name: /General/i })
    expect(basic).toHaveFocus()
    fireEvent.keyDown(basic, { key: 'ArrowDown' })
    const advanced = screen.getByRole('tab', { name: /Modules/i })
    expect(advanced).toHaveFocus()
    expect(advanced).toHaveAttribute('aria-selected', 'true')
    screen.getByRole('button', { name: 'Close' }).focus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    expect(advanced).not.toHaveFocus()
    rerender(<SettingsModal open={false} onClose={() => {}} />)
    expect(opener).toHaveFocus()
    opener.remove()
  })
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

  it('resets to General when re-opened', () => {
    const { rerender } = render(<SettingsModal open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /About/i }))
    rerender(<SettingsModal open={false} onClose={() => {}} />)
    rerender(<SettingsModal open={true} onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: /General/i })).toHaveAttribute('aria-selected', 'true')
  })
})

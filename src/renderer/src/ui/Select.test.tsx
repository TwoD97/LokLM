import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './Select'

const options = Array.from({ length: 30 }, (_, index) => ({
  value: String(index),
  label: `Option ${index}`,
}))

const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
afterEach(() => {
  vi.restoreAllMocks()
  if (originalScroll) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScroll)
  else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe('Select keyboard lifecycle', () => {
  it.each([false, true])(
    'restores the trigger before native Tab navigation (shift=%s)',
    (shift) => {
      const change = vi.fn()
      render(<Select value="0" options={options} onChange={change} ariaLabel="Filter" />)
      const trigger = screen.getByRole('button', { name: 'Filter' })
      fireEvent.click(trigger)
      const list = screen.getByRole('listbox')
      expect(list).toHaveFocus()
      expect(trigger).toHaveAttribute('aria-controls', list.id)

      expect(fireEvent.keyDown(list, { key: 'Tab', shiftKey: shift })).toBe(true)

      expect(trigger).toHaveFocus()
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(change).not.toHaveBeenCalled()
    },
  )

  it('keeps the active option visible and closes without dismissing an enclosing dialog', () => {
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scroll,
      configurable: true,
      writable: true,
    })
    const outerKey = vi.fn()
    const change = vi.fn()
    render(
      <div onKeyDown={outerKey}>
        <Select value="0" options={options} onChange={change} ariaLabel="Filter" />
      </div>,
    )
    const trigger = screen.getByRole('button', { name: 'Filter' })
    fireEvent.click(trigger)
    const list = screen.getByRole('listbox')
    fireEvent.keyDown(list, { key: 'End' })
    expect(list).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Option 29' }).id,
    )
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' })
    outerKey.mockClear()
    fireEvent.keyDown(list, { key: 'Escape' })
    expect(outerKey).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    expect(change).not.toHaveBeenCalled()
  })

  it('clamps the active option when options shrink and closes when focus leaves', () => {
    const change = vi.fn()
    const view = render(<Select value="0" options={options} onChange={change} ariaLabel="Filter" />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'End' })
    view.rerender(
      <Select value="0" options={options.slice(0, 2)} onChange={change} ariaLabel="Filter" />,
    )
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' })
    expect(change).toHaveBeenCalledWith('1')
    fireEvent.click(screen.getByRole('button'))
    fireEvent.blur(screen.getByRole('listbox'), { relatedTarget: document.body })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not open a listbox without options', () => {
    render(<Select value="0" options={[]} onChange={vi.fn()} ariaLabel="Filter" />)
    expect(screen.getByRole('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

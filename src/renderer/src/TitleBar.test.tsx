import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TitleBar } from './TitleBar'

afterEach(() => vi.restoreAllMocks())

describe('TitleBar window state', () => {
  it('keeps a newer window notification when the initial maximized read arrives late', async () => {
    let finish!: (value: boolean) => void
    let emit!: (value: boolean) => void
    const off = vi.fn()
    vi.spyOn(window.api.window, 'isMaximized').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    vi.spyOn(window.api.window, 'onMaximizedChange').mockImplementation((listener) => {
      emit = listener
      return off
    })
    const view = render(<TitleBar />)
    act(() => emit(true))
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    await act(async () => finish(false))
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    view.unmount()
    expect(off).toHaveBeenCalledOnce()
  })
})

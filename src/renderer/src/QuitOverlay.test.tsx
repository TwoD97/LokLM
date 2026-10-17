import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuitOverlay } from './QuitOverlay'
import { QuestionCard } from './quiz/QuestionCard'

afterEach(() => vi.restoreAllMocks())

describe('QuitOverlay keyboard blocking', () => {
  it('moves focus away from active controls while locking, traps Tab, and restores on completion', () => {
    let lock!: (active: boolean) => void
    vi.spyOn(window.api.window, 'onLocking').mockImplementation((listener) => {
      lock = listener
      return () => {}
    })
    const selectAnswer = vi.fn()
    render(
      <>
        <button>Background action</button>
        <QuestionCard
          question={{
            id: 1,
            deckId: 1,
            ordinal: 0,
            stem: 'Question',
            options: ['First', 'Second'],
            correctIndex: 0,
            explanation: '',
            sourceChunkIds: [],
            themeTitle: '',
          }}
          selectedIndex={null}
          revealed={false}
          onSelect={selectAnswer}
          onCite={vi.fn()}
        />
        <QuitOverlay />
      </>,
    )
    const opener = screen.getByRole('button', { name: 'Background action' })
    opener.focus()
    act(() => lock(true))
    const overlay = screen.getByRole('dialog')
    expect(overlay).toHaveAttribute('aria-modal', 'true')
    expect(overlay).toHaveFocus()
    fireEvent.keyDown(overlay, { key: '1' })
    expect(selectAnswer).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(overlay, { key: 'Tab' })).toBe(false)
    expect(fireEvent.keyDown(overlay, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(overlay).toHaveFocus()
    act(() => lock(false))
    expect(screen.queryByRole('status')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('keeps the quit overlay active when a lock drain finishes during shutdown', () => {
    let lock!: (active: boolean) => void
    let quit!: () => void
    vi.spyOn(window.api.window, 'onLocking').mockImplementation((listener) => {
      lock = listener
      return () => {}
    })
    vi.spyOn(window.api.window, 'onQuitting').mockImplementation((listener) => {
      quit = listener
      return () => {}
    })
    render(<QuitOverlay />)
    act(() => lock(true))
    act(() => quit())
    const message = screen.getByRole('status').textContent
    act(() => lock(false))
    expect(screen.getByRole('status')).toHaveTextContent(message!)
    expect(screen.getByRole('dialog')).toHaveFocus()
  })
})

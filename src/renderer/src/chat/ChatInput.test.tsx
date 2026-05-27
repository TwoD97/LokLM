import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatInput } from './ChatInput'

describe('ChatInput', () => {
  it('disables send when input is empty', () => {
    render(<ChatInput onSend={() => undefined} busy={false} />)
    const send = screen.getByRole('button', { name: /send message/i })
    expect(send).toBeDisabled()
  })

  it('enables send when input has non-whitespace text', () => {
    render(<ChatInput onSend={() => undefined} busy={false} />)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'what is argon?' } })
    expect(screen.getByRole('button', { name: /send message/i })).not.toBeDisabled()
  })

  it('sends on Enter and clears the textarea', () => {
    const onSend = vi.fn()
    render(<ChatInput onSend={onSend} busy={false} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hi' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('hi')
    expect(ta.value).toBe('')
  })

  it('does not send on Shift+Enter (allows newline)', () => {
    const onSend = vi.fn()
    render(<ChatInput onSend={onSend} busy={false} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hi' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('shows Cancel when busy and onCancel provided', () => {
    const onCancel = vi.fn()
    render(<ChatInput onSend={() => undefined} busy={true} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel streaming/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatInput } from './ChatInput'

describe('ChatInput', () => {
  it('disables send when input is empty', () => {
    render(<ChatInput onSend={() => undefined} busy={false} />)
    const send = screen.getByText(/send/i)
    expect(send).toBeDisabled()
  })

  it('enables send when input has non-whitespace text', () => {
    render(<ChatInput onSend={() => undefined} busy={false} />)
    const ta = screen.getByPlaceholderText(/dokumenten/i)
    fireEvent.change(ta, { target: { value: 'what is argon?' } })
    expect(screen.getByText(/send/i)).not.toBeDisabled()
  })

  it('calls onSend on Ctrl+Enter and clears the textarea', () => {
    const onSend = vi.fn()
    render(<ChatInput onSend={onSend} busy={false} />)
    const ta = screen.getByPlaceholderText(/dokumenten/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hi' } })
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true })
    expect(onSend).toHaveBeenCalledWith('hi')
    expect(ta.value).toBe('')
  })

  it('shows Cancel when busy and onCancel provided', () => {
    const onCancel = vi.fn()
    render(<ChatInput onSend={() => undefined} busy={true} onCancel={onCancel} />)
    fireEvent.click(screen.getByText(/cancel/i))
    expect(onCancel).toHaveBeenCalled()
  })
})

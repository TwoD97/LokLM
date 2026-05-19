import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageBubble } from './MessageBubble'

describe('MessageBubble', () => {
  it('renders user message as plain text', () => {
    render(<MessageBubble role="user" content="hello there" onCitationClick={() => undefined} />)
    expect(screen.getByText('hello there')).toBeInTheDocument()
  })

  it('renders assistant citations as clickable chips', () => {
    const onClick = vi.fn()
    render(
      <MessageBubble
        role="assistant"
        content="argon2id is used [doc:5, chunk:42] in the vault"
        onCitationClick={onClick}
      />,
    )
    const chip = screen.getByText('1')
    fireEvent.click(chip)
    expect(onClick).toHaveBeenCalledWith({ documentId: 5, chunkId: 42 })
  })

  it('applies refusal style when isRefusal is true', () => {
    const { container } = render(
      <MessageBubble
        role="assistant"
        content="not in the documents"
        isRefusal
        onCitationClick={() => undefined}
      />,
    )
    expect(container.querySelector('.bubble--refusal')).not.toBeNull()
  })

  it('reuses chip index for duplicate citations in the same message', () => {
    render(
      <MessageBubble
        role="assistant"
        content="a [doc:1, chunk:1] b [doc:1, chunk:1] c"
        onCitationClick={() => undefined}
      />,
    )
    expect(screen.getAllByText('1')).toHaveLength(2)
  })
})

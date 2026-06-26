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
    expect(onClick).toHaveBeenCalledWith({
      documentId: 5,
      chunkId: 42,
      messageText: 'argon2id is used [doc:5, chunk:42] in the vault',
    })
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

  it('shows a fallback Sources footer when the model emitted no inline markers', () => {
    const onClick = vi.fn()
    const { container } = render(
      <MessageBubble
        role="assistant"
        content="Die auth Klasse verwaltet den Tresor."
        citations={[
          { documentId: 7, chunkId: 3 },
          { documentId: 7, chunkId: 9 }, // same doc → deduped
          { documentId: 12, chunkId: 1 },
        ]}
        onCitationClick={onClick}
      />,
    )
    expect(container.querySelector('.bubble__sources')).not.toBeNull()
    fireEvent.click(screen.getByText('1'))
    expect(onClick).toHaveBeenCalledWith({
      documentId: 7,
      chunkId: 3,
      messageText: 'Die auth Klasse verwaltet den Tresor.',
    })
    expect(screen.getByText('2')).toBeInTheDocument() // one chip per unique document
  })

  it('omits the fallback footer when inline markers are present', () => {
    const { container } = render(
      <MessageBubble
        role="assistant"
        content="grounded [doc:1, chunk:1]"
        citations={[{ documentId: 1, chunkId: 1 }]}
        onCitationClick={() => undefined}
      />,
    )
    expect(container.querySelector('.bubble__sources')).toBeNull()
  })
})

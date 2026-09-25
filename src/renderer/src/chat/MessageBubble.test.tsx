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
        citations={[{ documentId: 5, chunkId: 42 }]}
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
        citations={[{ documentId: 1, chunkId: 1 }]}
        onCitationClick={() => undefined}
      />,
    )
    expect(screen.getAllByText('1')).toHaveLength(2)
  })

  it('renders NO in-bubble source footer for a marker-less answer (the GroundingBadge owns sources now)', () => {
    // The redundant in-bubble fallback was removed: a marker-less answer still
    // shows its fed sources via the per-turn "Belegt · N Quellen" GroundingBadge
    // (MessageList), so the bubble must not duplicate them.
    const { container } = render(
      <MessageBubble
        role="assistant"
        content="Die auth Klasse verwaltet den Tresor."
        citations={[
          { documentId: 7, chunkId: 3 },
          { documentId: 12, chunkId: 1 },
        ]}
        onCitationClick={vi.fn()}
      />,
    )
    expect(container.querySelector('.bubble__sources')).toBeNull()
  })

  it('still renders inline chips when the model DID emit markers', () => {
    render(
      <MessageBubble
        role="assistant"
        content="grounded [doc:1, chunk:1]"
        citations={[{ documentId: 1, chunkId: 1 }]}
        onCitationClick={() => undefined}
      />,
    )
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('keeps unknown prose markers visible and denies sources until supplied', () => {
    const props = {
      role: 'assistant' as const,
      content: 'Known [doc:1, chunk:11], unknown [doc:9, chunk:99].',
      onCitationClick: vi.fn(),
    }
    const view = render(<MessageBubble {...props} />)
    expect(view.container.querySelector('.citation-chip')).toBeNull()
    expect(view.container).toHaveTextContent('[doc:1, chunk:11]')
    view.rerender(<MessageBubble {...props} citations={[{ documentId: 1, chunkId: 11 }]} />)
    expect(view.container.querySelectorAll('.citation-chip')).toHaveLength(1)
    expect(view.container).toHaveTextContent('[doc:9, chunk:99]')
  })

  it('blocks direct Markdown citation links that bypass marker transformation', () => {
    const click = vi.fn()
    const view = render(
      <MessageBubble
        role="assistant"
        content="[Invented source](#cite-99-99) [Permitted source](#cite-1-11)"
        citations={[{ documentId: 1, chunkId: 11 }]}
        onCitationClick={click}
      />,
    )
    fireEvent.click(screen.getByText('Invented source'))
    expect(click).not.toHaveBeenCalled()
    expect(view.container.querySelectorAll('.citation-chip')).toHaveLength(1)
    fireEvent.click(screen.getByText('Permitted source'))
    expect(click).toHaveBeenCalledWith(expect.objectContaining({ documentId: 1, chunkId: 11 }))
  })

  it.each([
    '[Invalid](#cite-0-11)',
    '[Invalid](#cite-999999999999999999999-11)',
    '[Invalid](#cite-not-a-source)',
  ])('keeps malformed reserved links inert: %s', (content) => {
    const view = render(
      <MessageBubble
        role="assistant"
        content={content}
        citations={[{ documentId: 1, chunkId: 11 }]}
        onCitationClick={vi.fn()}
      />,
    )
    expect(view.container.querySelector('a')).toBeNull()
    expect(screen.getByText('Invalid')).toBeVisible()
  })

  it.each([
    '`[doc:1, chunk:11]`',
    '```text\n[doc:1, chunk:11]\n```',
    '[doc:1, chunk:11](https://example.test)',
    '\\[doc:1, chunk:11]',
  ])('does not turn a literal marker into a source chip: %s', (content) => {
    const view = render(
      <MessageBubble
        role="assistant"
        content={content}
        citations={[{ documentId: 1, chunkId: 11 }]}
        onCitationClick={vi.fn()}
      />,
    )
    expect(view.container.querySelector('.citation-chip')).toBeNull()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConversationList } from './ConversationList'
import type { Conversation } from '@shared/documents'

const conv = (id: number, title: string | null, messages = 0): Conversation => ({
  id,
  workspaceId: 1,
  title,
  activeDocumentIds: [],
  createdAt: 0,
  lastActivityAt: 0,
  messageCount: messages,
})

describe('ConversationList', () => {
  it('renders empty state when no conversations', () => {
    render(
      <ConversationList
        conversations={[]}
        currentId={null}
        onSelect={() => undefined}
        onNewChat={() => undefined}
        onRequestDelete={() => undefined}
      />,
    )
    expect(screen.getByText(/no conversations/i)).toBeInTheDocument()
  })

  it('renders + New chat button and fires onNewChat', () => {
    const onNew = vi.fn()
    render(
      <ConversationList
        conversations={[]}
        currentId={null}
        onSelect={() => undefined}
        onNewChat={onNew}
        onRequestDelete={() => undefined}
      />,
    )
    fireEvent.click(screen.getByText(/new chat/i))
    expect(onNew).toHaveBeenCalled()
  })

  it('shows titles + message counts and fires onSelect/onRequestDelete', () => {
    const onSelect = vi.fn()
    const onDel = vi.fn()
    const a = conv(1, 'alpha', 3)
    const b = conv(2, null, 0)
    render(
      <ConversationList
        conversations={[a, b]}
        currentId={null}
        onSelect={onSelect}
        onNewChat={() => undefined}
        onRequestDelete={onDel}
      />,
    )
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('Conversation #2')).toBeInTheDocument()
    expect(screen.getByText(/3 messages/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('alpha'))
    expect(onSelect).toHaveBeenCalledWith(1)
    const dels = screen.getAllByLabelText('Delete')
    fireEvent.click(dels[0]!)
    expect(onDel).toHaveBeenCalledWith(a)
  })
})

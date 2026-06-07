import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { ChatView } from './ChatView'

describe('ChatView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('re-enables the composer when creating the conversation fails', async () => {
    // New chat (currentConversationId=null): the first send mints a conversation
    // row via conversations.create. Force that to reject (transient DB error /
    // a lock racing in). The composer must not stay stuck in the busy state
    // (which renders the stop button and disables sending) — onSend resets busy
    // only inside a try/finally that wraps the stream phase, not the create.
    vi.spyOn(window.api.conversations, 'create').mockRejectedValue(new Error('db down'))

    const { container } = render(
      <ChatView
        workspaceId={1}
        currentConversationId={null}
        activeDocumentIds={[]}
        documents={[]}
        onConversationChange={() => undefined}
      />,
    )

    const textarea = container.querySelector('.chat__input') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello there' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    // Once the create failure settles, the composer is back to the send state —
    // the stop/cancel button (rendered only while busy) must be gone, and onSend
    // must not leave an unhandled rejection.
    await waitFor(() => {
      expect(container.querySelector('.chat__send--cancel')).toBeNull()
    })
  })
})

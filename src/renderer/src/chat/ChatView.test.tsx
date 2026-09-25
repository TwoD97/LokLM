import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, fireEvent, waitFor, screen } from '@testing-library/react'
import { ChatView } from './ChatView'
import type { StreamEvent } from '@shared/documents'

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
    expect(textarea).toHaveValue('hello there')
    expect(screen.getByRole('alert')).toHaveTextContent('db down')
  })

  it('ends the streaming placeholder and preserves the question after an IPC failure', async () => {
    vi.spyOn(window.api.chat, 'stream').mockRejectedValue(new Error('worker stopped'))
    const { container } = render(
      <ChatView
        workspaceId={1}
        currentConversationId={1}
        activeDocumentIds={[]}
        documents={[]}
        onConversationChange={() => {}}
      />,
    )
    const textarea = container.querySelector('.chat__input')!
    fireEvent.change(textarea, { target: { value: 'Keep this question' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('worker stopped')
    expect(screen.getByText('Keep this question')).toBeVisible()
    expect(container.querySelector('.chat__send--cancel')).toBeNull()
  })

  it('does not reopen an old conversation when its stream finishes after navigation', async () => {
    let finish!: () => void
    vi.spyOn(window.api.chat, 'stream').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const open = vi.spyOn(window.api.conversations, 'getWithMessages')
    const change = vi.fn()
    const props = {
      workspaceId: 1,
      activeDocumentIds: [],
      documents: [],
      onConversationChange: change,
    }
    const view = render(<ChatView {...props} currentConversationId={1} />)
    const textarea = view.container.querySelector('.chat__input')!
    fireEvent.change(textarea, { target: { value: 'Question' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    view.rerender(<ChatView {...props} currentConversationId={2} />)
    await act(async () => finish())
    expect(open).not.toHaveBeenCalled()
    expect(change).not.toHaveBeenCalled()
  })

  it('preserves streamed text when the worker emits an error before the invoke resolves', async () => {
    let emit!: (event: StreamEvent) => void
    let finish!: () => void
    vi.spyOn(window.api.chat, 'onEvent').mockImplementation((_id, callback) => {
      emit = callback
      return () => {}
    })
    vi.spyOn(window.api.chat, 'stream').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const open = vi.spyOn(window.api.conversations, 'getWithMessages')
    const view = render(
      <ChatView
        workspaceId={1}
        currentConversationId={1}
        activeDocumentIds={[]}
        documents={[]}
        onConversationChange={() => {}}
      />,
    )
    const textarea = view.container.querySelector('.chat__input')!
    fireEvent.change(textarea, { target: { value: 'A question' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await act(async () => {
      emit({ type: 'token', text: 'Partial useful answer' })
      emit({ type: 'error', message: 'GPU interrupted' })
      finish()
    })
    expect(screen.getByText('Partial useful answer')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('GPU interrupted')
    expect(open).not.toHaveBeenCalled()
  })
})

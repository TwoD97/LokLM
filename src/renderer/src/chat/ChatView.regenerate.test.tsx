import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationWithMessages } from '@shared/documents'
import { ChatView } from './ChatView'

afterEach(() => vi.restoreAllMocks())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const saved: ConversationWithMessages = {
  conversation: {
    id: 1,
    workspaceId: 1,
    title: 'Existing chat',
    activeDocumentIds: [],
    createdAt: 1,
    lastActivityAt: 1,
    messageCount: 4,
  },
  messages: ['First question', 'First answer', 'Retry this question', 'Old answer'].map(
    (content, index) => ({
      id: 11 + index,
      conversationId: 1,
      role: index % 2 ? 'assistant' : 'user',
      content,
      createdAt: 1,
      ttftMs: null,
      tokensPerSec: null,
      tokenCount: null,
      citations: [],
    }),
  ),
}
const props = {
  workspaceId: 1,
  currentConversationId: 1,
  activeDocumentIds: [],
  documents: [],
  onConversationChange: () => {},
}

async function setup() {
  vi.spyOn(window.api.conversations, 'list').mockResolvedValue([saved.conversation])
  const read = vi.spyOn(window.api.conversations, 'getWithMessages').mockResolvedValue(saved)
  const remove = vi.spyOn(window.api.conversations, 'deleteLatestTurn').mockResolvedValue()
  const stream = vi.spyOn(window.api.chat, 'stream').mockResolvedValue({
    type: 'done',
    full_text: 'Replacement answer',
    citations: [],
    outcome: 'completed',
  })
  const view = render(<ChatView {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Existing chat/ }))
  await screen.findByText('Old answer')
  read.mockClear()
  return { ...view, read, remove, stream }
}

describe('regenerate an existing chat turn', () => {
  it('uses the stored history before the replaced question and removes the old pair once', async () => {
    const { stream, remove } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(stream).toHaveBeenCalledOnce())
    expect(remove.mock.calls).toEqual([
      [{ workspaceId: 1, conversationId: 1, userMessageId: 13, assistantMessageId: 14 }],
    ])
    expect(stream.mock.calls[0]![2]).toBe('Retry this question')
    expect(stream.mock.calls[0]![3]?.history).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
    ])
  })

  it('locks the whole regeneration preflight against duplicate clicks and new sends', async () => {
    const { read, stream, container } = await setup()
    const pending = deferred<ConversationWithMessages>()
    read.mockReturnValueOnce(pending.promise)
    const regenerate = screen.getByRole('button', { name: 'Regenerate' })
    act(() => {
      fireEvent.click(regenerate)
      fireEvent.click(regenerate)
    })
    const input = container.querySelector('.chat__input')!
    fireEvent.change(input, { target: { value: 'Another question' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(read).toHaveBeenCalledOnce()
    expect(stream).not.toHaveBeenCalled()
    await act(async () => pending.resolve(saved))
    await waitFor(() => expect(stream).toHaveBeenCalledOnce())
  })

  it('does not delete or send the old turn after navigating while its read is pending', async () => {
    const { read, stream, remove, rerender } = await setup()
    const pending = deferred<ConversationWithMessages>()
    read.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    rerender(<ChatView {...props} currentConversationId={2} />)
    await act(async () => pending.resolve(saved))
    expect(remove).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })

  it('allows Stop to cancel the read phase without changing saved history', async () => {
    const { read, stream, remove } = await setup()
    const pending = deferred<ConversationWithMessages>()
    read.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel streaming' }))
    await act(async () => pending.resolve(saved))
    expect(remove).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
    expect(screen.getByText('Old answer')).toBeVisible()
  })

  it('does not send into a new conversation after the atomic deletion was admitted', async () => {
    const { stream, remove, rerender, container } = await setup()
    const pending = deferred<void>()
    remove.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(remove).toHaveBeenCalledOnce())
    rerender(<ChatView {...props} currentConversationId={2} />)
    const input = container.querySelector('.chat__input')!
    fireEvent.change(input, { target: { value: 'Question for the new conversation' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(stream).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cancel streaming' })).toBeVisible()
    await act(async () => pending.resolve())
    expect(remove).toHaveBeenCalledOnce()
    expect(stream).not.toHaveBeenCalled()
  })

  it('keeps the removed question in the composer when Stop arrives during atomic deletion', async () => {
    const { stream, remove, container } = await setup()
    const pending = deferred<void>()
    remove.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(remove).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel streaming' }))
    await act(async () => pending.resolve())
    expect(stream).not.toHaveBeenCalled()
    expect(container.querySelector('.chat__input')).toHaveValue('Retry this question')
    expect(screen.queryByText('Old answer')).not.toBeInTheDocument()
    expect(screen.getByText('First answer')).toBeVisible()
  })

  it('rejects an incomplete tail without deleting an earlier completed exchange', async () => {
    const { read, remove, stream } = await setup()
    read.mockResolvedValueOnce({ ...saved, messages: saved.messages.slice(0, -1) })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not regenerate')
    expect(remove).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })

  it('reloads a newer unseen exchange instead of silently selecting it for deletion', async () => {
    const { read, remove, stream } = await setup()
    const newer: ConversationWithMessages = {
      ...saved,
      messages: [
        ...saved.messages,
        { ...saved.messages[2]!, id: 15, content: 'Unseen question' },
        { ...saved.messages[3]!, id: 16, content: 'Unseen answer' },
      ],
    }
    read.mockResolvedValue(newer)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not regenerate')
    expect(await screen.findByText('Unseen answer')).toBeVisible()
    expect(remove).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })

  it('rejects a changed answer even when the saved message count is unchanged', async () => {
    const { read, remove, stream } = await setup()
    read.mockResolvedValue({
      ...saved,
      messages: saved.messages.map((message) =>
        message.id === 14 ? { ...message, content: 'Changed stored answer' } : message,
      ),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByText('Changed stored answer')).toBeVisible()
    expect(remove).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })

  it('shows a deletion failure in the workspace and restores the stored conversation', async () => {
    const { read, stream, remove } = await setup()
    remove.mockRejectedValueOnce(new Error('Storage busy'))
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not regenerate')
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(stream).not.toHaveBeenCalled()
    expect(screen.getByText('Old answer')).toBeVisible()
  })

  it('does not resume regeneration after the workspace view unmounts', async () => {
    const { read, stream, remove, unmount } = await setup()
    const pending = deferred<ConversationWithMessages>()
    read.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    unmount()
    await act(async () => pending.resolve(saved))
    expect(remove).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })
})

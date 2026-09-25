import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ConversationWithMessages, StreamEvent } from '@shared/documents'
import { ChatView } from './ChatView'

afterEach(() => vi.restoreAllMocks())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function captureStream() {
  let listener!: (event: StreamEvent) => void
  const finished = deferred<Extract<StreamEvent, { type: 'done' | 'error' }> | void>()
  vi.spyOn(window.api.chat, 'onEvent').mockImplementation((_id, callback) => {
    listener = callback
    return () => {}
  })
  const stream = vi.spyOn(window.api.chat, 'stream').mockReturnValue(finished.promise)
  return {
    stream,
    emit: (event: StreamEvent) => listener(event),
    finish: (terminal?: Extract<StreamEvent, { type: 'done' | 'error' }>) =>
      finished.resolve(terminal),
  }
}

function saved(content: string, source = 1): ConversationWithMessages {
  return {
    conversation: {
      id: 1,
      workspaceId: 1,
      title: null,
      activeDocumentIds: [],
      createdAt: 1,
      lastActivityAt: 1,
      messageCount: 1,
    },
    messages: [
      {
        id: 10,
        conversationId: 1,
        role: 'assistant',
        content,
        createdAt: 1,
        ttftMs: null,
        tokensPerSec: null,
        tokenCount: null,
        citations: [
          {
            id: 1,
            messageId: 10,
            documentId: source,
            chunkId: source + 10,
            score: 1,
            spanStart: null,
            spanEnd: null,
            createdAt: 1,
          },
        ],
      },
    ],
  }
}

const props = {
  workspaceId: 1,
  activeDocumentIds: [],
  documents: [],
  onConversationChange: vi.fn(),
}
function send(container: HTMLElement) {
  const input = container.querySelector('.chat__input')!
  fireEvent.change(input, { target: { value: 'A question' } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('chat terminal text and supplied citations', () => {
  it('allows live supplied IDs, replaces the draft at done, and ignores trailing events', async () => {
    const stream = captureStream()
    const final = 'Final answer [doc:2, chunk:12].'
    vi.spyOn(window.api.conversations, 'getWithMessages').mockResolvedValue(saved(final, 2))
    const view = render(<ChatView {...props} currentConversationId={1} />)
    send(view.container)
    act(() => {
      stream.emit({ type: 'token', text: 'Draft [doc:1, chunk:11], unknown [doc:9, chunk:99].' })
    })
    expect(view.container.querySelector('.citation-chip')).toBeNull()
    act(() => stream.emit({ type: 'citation', doc_id: 1, chunk_id: 11, score: 1 }))
    expect(view.container.querySelectorAll('.citation-chip')).toHaveLength(1)
    expect(view.container).toHaveTextContent('[doc:9, chunk:99]')
    act(() => {
      stream.emit({
        type: 'done',
        full_text: final,
        citations: [{ doc_id: 2, chunk_id: 12, score: 1 }],
        outcome: 'completed',
      })
      stream.emit({ type: 'token', text: 'LATE TEXT' })
      stream.emit({ type: 'citation', doc_id: 9, chunk_id: 99, score: 1 })
    })
    expect(view.container).not.toHaveTextContent('Draft')
    expect(view.container).not.toHaveTextContent('LATE TEXT')
    expect(view.container.querySelector('.citation-chip')).toHaveAttribute('href', '#cite-2-12')
    await act(async () => stream.finish())
    expect(view.container.querySelectorAll('.bubble--assistant')).toHaveLength(1)
    expect(view.container.querySelector('.citation-chip')).toHaveAttribute('href', '#cite-2-12')
  })

  it('rehydrates a durable partial error without duplicating or reverting its final text', async () => {
    const stream = captureStream()
    const partial = 'Useful partial [doc:1, chunk:11].\n\nResponse interrupted.'
    const get = vi
      .spyOn(window.api.conversations, 'getWithMessages')
      .mockResolvedValue(saved(partial))
    const view = render(<ChatView {...props} currentConversationId={1} />)
    send(view.container)
    act(() => {
      stream.emit({ type: 'token', text: 'Unnormalized draft' })
      stream.emit({
        type: 'error',
        message: 'GPU stopped',
        full_text: partial,
        citations: [{ doc_id: 1, chunk_id: 11, score: 1 }],
        persisted: true,
      })
    })
    await act(async () => stream.finish())
    expect(get).toHaveBeenCalledWith(1)
    expect(view.container).not.toHaveTextContent('Unnormalized draft')
    expect(screen.getAllByText('Response interrupted.')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('GPU stopped')
    expect(view.container.querySelectorAll('.citation-chip')).toHaveLength(1)
  })

  it('keeps an unsaved terminal answer copyable instead of replacing it with an empty DB result', async () => {
    const stream = captureStream()
    const get = vi.spyOn(window.api.conversations, 'getWithMessages')
    const title = vi.spyOn(window.api.conversations, 'generateTitle')
    const view = render(<ChatView {...props} currentConversationId={null} />)
    send(view.container)
    await waitFor(() => expect(stream.stream).toHaveBeenCalled())
    act(() =>
      stream.emit({
        type: 'error',
        message: 'Disk full',
        full_text: 'Useful unsaved answer.\n\nNot saved; copy this text.',
        citations: [],
        persisted: false,
      }),
    )
    await act(async () => stream.finish())
    expect(get).not.toHaveBeenCalled()
    expect(screen.getByText('Useful unsaved answer.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full')
    expect(title).not.toHaveBeenCalled()
  })

  it('applies an unsaved error returned by invoke before its delayed event can arrive', async () => {
    const stream = captureStream()
    const get = vi.spyOn(window.api.conversations, 'getWithMessages')
    const terminal = {
      type: 'error',
      message: 'Disk full',
      full_text: 'Keep this unsaved answer.',
      citations: [],
      persisted: false,
    } as const
    const view = render(<ChatView {...props} currentConversationId={1} />)
    send(view.container)
    act(() => stream.emit({ type: 'token', text: 'Earlier draft' }))
    await act(async () => stream.finish({ ...terminal, citations: [] }))
    expect(get).not.toHaveBeenCalled()
    expect(screen.getByText('Keep this unsaved answer.')).toBeVisible()
    expect(view.container).not.toHaveTextContent('Earlier draft')
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled()
    act(() => stream.emit({ ...terminal, citations: [] }))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(view.container.querySelectorAll('.bubble--assistant')).toHaveLength(1)
  })

  it('refreshes a completed turn after navigating away and back to its conversation', async () => {
    const stream = captureStream()
    const get = vi
      .spyOn(window.api.conversations, 'getWithMessages')
      .mockResolvedValue(saved('Persisted after returning.'))
    const view = render(<ChatView {...props} currentConversationId={1} />)
    send(view.container)
    view.rerender(<ChatView {...props} currentConversationId={2} />)
    view.rerender(<ChatView {...props} currentConversationId={1} />)
    await act(async () =>
      stream.finish({
        type: 'done',
        full_text: 'Persisted after returning.',
        citations: [],
        outcome: 'completed',
      }),
    )
    expect(get).toHaveBeenCalledWith(1)
    expect(screen.getByText('Persisted after returning.')).toBeVisible()
  })

  it('does not override a pending selection to a different conversation at completion', async () => {
    const stream = captureStream()
    const target = deferred<ConversationWithMessages>()
    const get = vi
      .spyOn(window.api.conversations, 'getWithMessages')
      .mockReturnValue(target.promise)
    vi.spyOn(window.api.conversations, 'list').mockResolvedValue([
      { ...saved('').conversation, id: 2, title: 'Other conversation' },
    ])
    const changed = vi.fn()
    const view = render(
      <ChatView {...props} onConversationChange={changed} currentConversationId={1} />,
    )
    send(view.container)
    fireEvent.click(await screen.findByText('Other conversation'))
    expect(get).toHaveBeenCalledWith(2)
    await act(async () =>
      stream.finish({
        type: 'done',
        full_text: 'Previous answer.',
        citations: [],
        outcome: 'completed',
      }),
    )
    expect(get).toHaveBeenCalledTimes(1)
    await act(async () =>
      target.resolve({
        ...saved('Other saved answer.'),
        conversation: { ...saved('').conversation, id: 2 },
      }),
    )
    expect(changed).toHaveBeenCalledWith(2, [])
    expect(screen.getByText('Other saved answer.')).toBeVisible()
    expect(view.container).not.toHaveTextContent('Previous answer.')
  })

  it('shows an unsaved terminal after returning through a DB snapshot without the live placeholder', async () => {
    const stream = captureStream()
    const first = { ...saved('').conversation, title: 'First conversation' }
    const second = { ...first, id: 2, title: 'Second conversation' }
    vi.spyOn(window.api.conversations, 'list').mockResolvedValue([first, second])
    const get = vi
      .spyOn(window.api.conversations, 'getWithMessages')
      .mockImplementation(async (id) => ({ conversation: id === 1 ? first : second, messages: [] }))
    const view = render(<ChatView {...props} currentConversationId={1} />)
    send(view.container)
    fireEvent.click(await screen.findByText('Second conversation'))
    await waitFor(() => expect(view.container.querySelector('.bubble--assistant')).toBeNull())
    view.rerender(<ChatView {...props} currentConversationId={2} />)
    fireEvent.click(screen.getByText('First conversation'))
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(1))
    await act(async () => {})
    view.rerender(<ChatView {...props} currentConversationId={1} />)
    await act(async () =>
      stream.finish({
        type: 'error',
        message: 'Disk full',
        full_text: 'Unsaved after returning.',
        citations: [],
        persisted: false,
      }),
    )
    expect(get).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Unsaved after returning.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full')
  })

  it.each(['create', 'refresh'] as const)(
    'honors Stop during conversation %s without starting inference',
    async (stage) => {
      const pendingCreate = deferred<ConversationWithMessages['conversation']>()
      const pendingRefresh = deferred<ConversationWithMessages['conversation'][]>()
      if (stage === 'create')
        vi.spyOn(window.api.conversations, 'create').mockReturnValue(pendingCreate.promise)
      const list = vi.spyOn(window.api.conversations, 'list').mockResolvedValue([])
      const stream = vi.spyOn(window.api.chat, 'stream')
      const view = render(<ChatView {...props} currentConversationId={null} />)
      await act(async () => {})
      if (stage === 'refresh') list.mockReturnValue(pendingRefresh.promise)
      send(view.container)
      if (stage === 'refresh') await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
      fireEvent.click(view.container.querySelector('.chat__send--cancel')!)
      await act(async () => {
        if (stage === 'create') pendingCreate.resolve(saved('').conversation)
        else pendingRefresh.resolve([])
      })
      expect(stream).not.toHaveBeenCalled()
      expect(view.container.querySelector('.chat__input')).toHaveValue('A question')
      expect(view.container.querySelector('.chat__send--cancel')).toBeNull()
    },
  )

  it.each(['cancelled', 'requested-stop', 'refused', 'completed'] as const)(
    'generates a new title only for a completed successful turn: %s',
    async (outcome) => {
      const stream = captureStream()
      const title = vi.spyOn(window.api.conversations, 'generateTitle')
      const cancel = vi.spyOn(window.api.chat, 'cancel')
      vi.spyOn(window.api.conversations, 'getWithMessages').mockResolvedValue(saved('Final text.'))
      const view = render(<ChatView {...props} currentConversationId={null} />)
      send(view.container)
      await waitFor(() => expect(stream.stream).toHaveBeenCalled())
      if (outcome === 'requested-stop')
        fireEvent.click(view.container.querySelector('.chat__send--cancel')!)
      act(() => {
        if (outcome === 'refused')
          stream.emit({
            type: 'refusal',
            reason: 'no_hits',
            message: 'No evidence.',
            suggestions: [],
          })
        stream.emit({
          type: 'done',
          full_text: 'Final text.',
          citations: [],
          outcome: outcome === 'cancelled' ? 'cancelled' : 'completed',
        })
      })
      await act(async () => stream.finish())
      if (outcome === 'completed') expect(title).toHaveBeenCalledWith(1)
      else expect(title).not.toHaveBeenCalled()
      if (outcome === 'requested-stop') expect(cancel).toHaveBeenCalledOnce()
    },
  )

  it('does not apply a stale DB refresh after the selected conversation changes', async () => {
    const stream = captureStream()
    const pending = deferred<ConversationWithMessages>()
    const get = vi
      .spyOn(window.api.conversations, 'getWithMessages')
      .mockReturnValue(pending.promise)
    const changed = vi.fn()
    const view = render(
      <ChatView {...props} onConversationChange={changed} currentConversationId={1} />,
    )
    send(view.container)
    act(() =>
      stream.emit({
        type: 'done',
        full_text: 'Final live text.',
        citations: [],
        outcome: 'completed',
      }),
    )
    await act(async () => stream.finish())
    expect(get).toHaveBeenCalledWith(1)
    view.rerender(<ChatView {...props} onConversationChange={changed} currentConversationId={2} />)
    await act(async () => pending.resolve(saved('Stale database answer.')))
    expect(changed).not.toHaveBeenCalled()
    expect(view.container).not.toHaveTextContent('Stale database answer.')
  })

  it('does not send or reopen a newly created row after navigation during its creation', async () => {
    const pending = deferred<ConversationWithMessages['conversation']>()
    vi.spyOn(window.api.conversations, 'create').mockReturnValue(pending.promise)
    const stream = vi.spyOn(window.api.chat, 'stream')
    const changed = vi.fn()
    const view = render(
      <ChatView {...props} onConversationChange={changed} currentConversationId={null} />,
    )
    send(view.container)
    view.rerender(<ChatView {...props} onConversationChange={changed} currentConversationId={2} />)
    await act(async () => pending.resolve(saved('').conversation))
    expect(changed).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
    expect(view.container.querySelector('.chat__send--cancel')).toBeNull()
  })
})

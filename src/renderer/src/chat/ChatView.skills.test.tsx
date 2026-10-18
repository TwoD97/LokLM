import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationWithMessages, StreamEvent } from '@shared/documents'
import type { SkillAction } from '@shared/connections'
import { ChatView } from './ChatView'

afterEach(() => vi.restoreAllMocks())
const action: SkillAction = {
  id: 'task-action',
  toolId: 'organizer.tasks.create',
  title: 'Create task',
  effect: 'write',
  status: 'pending',
  arguments: { title: 'Prepare talk' },
}
const snapshot: ConversationWithMessages = {
  conversation: {
    id: 1,
    workspaceId: 1,
    title: 'Task chat',
    activeDocumentIds: [],
    createdAt: 1,
    lastActivityAt: 1,
    messageCount: 2,
  },
  messages: [
    {
      id: 10,
      conversationId: 1,
      role: 'user',
      content: 'Create a task',
      createdAt: 1,
      ttftMs: null,
      tokensPerSec: null,
      tokenCount: null,
      citations: [],
    },
    {
      id: 11,
      conversationId: 1,
      role: 'assistant',
      content: 'Review the task.',
      createdAt: 2,
      ttftMs: null,
      tokensPerSec: null,
      tokenCount: null,
      citations: [],
      skillActions: [action],
    },
  ],
}
const props = {
  workspaceId: 1,
  currentConversationId: 1,
  activeDocumentIds: [],
  documents: [],
  onConversationChange: vi.fn(),
}
function send() {
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'Create a task' } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('Assistant chat scope and persisted actions', () => {
  it.each([false, true])('sends explicit skill scope (assistant=%s)', async (assistant) => {
    const stream = vi.spyOn(window.api.chat, 'stream').mockResolvedValue(undefined)
    render(<ChatView {...props} />)
    if (assistant) fireEvent.click(screen.getByRole('radio', { name: 'Assistant' }))
    send()
    await waitFor(() => expect(stream).toHaveBeenCalled())
    expect(stream.mock.calls[0]![3]).toEqual(expect.objectContaining({ skills: assistant }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop/i })).toBeNull())
  })

  it('receives live actions, then uses the restored numeric message ID for approval', async () => {
    let emit!: (event: StreamEvent) => void
    let finish!: (event: Extract<StreamEvent, { type: 'done' }>) => void
    vi.spyOn(window.api.chat, 'onEvent').mockImplementation((_id, callback) => {
      emit = callback
      return () => {}
    })
    vi.spyOn(window.api.chat, 'stream').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    vi.spyOn(window.api.conversations, 'getWithMessages').mockResolvedValue(snapshot)
    const apply = vi
      .spyOn(window.api.skills, 'apply')
      .mockResolvedValue({ ...action, status: 'completed', result: 'Task saved' })
    render(<ChatView {...props} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Assistant' }))
    send()
    await waitFor(() => expect(emit).toBeDefined())
    act(() => emit({ type: 'skill', action }))
    expect(screen.getByRole('button', { name: 'Apply change' })).toBeDisabled()
    await act(async () =>
      finish({
        type: 'done',
        full_text: 'Review the task.',
        citations: [],
        skillActions: [action],
      }),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply change' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }))
    expect(await screen.findByText('Task saved')).toBeVisible()
    expect(apply).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 1,
      conversationId: 1,
      messageId: 11,
      actionId: 'task-action',
    })
  })

  it('restores Assistant mode from saved actions for follow-ups without applying them automatically', async () => {
    vi.spyOn(window.api.conversations, 'list').mockResolvedValue([snapshot.conversation])
    vi.spyOn(window.api.conversations, 'getWithMessages').mockResolvedValue(snapshot)
    const apply = vi.spyOn(window.api.skills, 'apply')
    const stream = vi.spyOn(window.api.chat, 'stream').mockResolvedValue(undefined)
    render(<ChatView {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: /Task chat/ }))
    expect(await screen.findByRole('button', { name: 'Apply change' })).toBeEnabled()
    expect(apply).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /regenerate/i })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Assistant' })).toBeChecked()
    send()
    await waitFor(() => expect(stream).toHaveBeenCalled())
    expect(stream.mock.calls[0]![3]).toEqual(expect.objectContaining({ skills: true }))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Assistant' })).toBeEnabled())
  })

  it('preserves an explicit Documents choice when a follow-up finishes and rehydrates', async () => {
    vi.spyOn(window.api.conversations, 'list').mockResolvedValue([snapshot.conversation])
    vi.spyOn(window.api.conversations, 'getWithMessages').mockResolvedValue(snapshot)
    const stream = vi
      .spyOn(window.api.chat, 'stream')
      .mockResolvedValue({ type: 'done', full_text: 'A document answer', citations: [] })
    render(<ChatView {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: /Task chat/ }))
    await screen.findByRole('button', { name: 'Apply change' })
    fireEvent.click(screen.getByRole('radio', { name: 'Documents' }))
    send()
    await waitFor(() => expect(stream).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Documents' })).toBeEnabled())
    expect(screen.getByRole('radio', { name: 'Documents' })).toBeChecked()
    expect(stream.mock.calls[0]![3]).toEqual(expect.objectContaining({ skills: false }))
  })

  it('offers personal-tool prompts in an empty Assistant conversation without documents', async () => {
    render(<ChatView {...props} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Assistant' }))
    expect(screen.getByRole('heading', { name: 'Work with your personal tools' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Show my unfinished tasks' }))
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Show my unfinished tasks'))
  })
})

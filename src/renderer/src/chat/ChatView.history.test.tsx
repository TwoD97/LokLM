import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@shared/documents'
import { ChatView } from './ChatView'

const conversation = (workspaceId: number): Conversation => ({
  id: 1,
  workspaceId,
  title: `Workspace ${workspaceId} chat`,
  activeDocumentIds: [],
  createdAt: 1,
  lastActivityAt: 1,
  messageCount: 0,
})
const props = {
  currentConversationId: 1,
  activeDocumentIds: [],
  documents: [],
  onConversationChange: vi.fn(),
}

afterEach(() => vi.restoreAllMocks())

describe('Chat history request ownership', () => {
  it.each(['success', 'error'])('ignores an old workspace list %s', async (outcome) => {
    let resolve!: (rows: Conversation[]) => void
    let reject!: (reason: Error) => void
    vi.spyOn(window.api.conversations, 'list')
      .mockReturnValueOnce(
        new Promise((yes, no) => {
          resolve = yes
          reject = no
        }),
      )
      .mockResolvedValue([conversation(2)])
    const view = render(<ChatView {...props} workspaceId={1} />)
    view.rerender(<ChatView {...props} workspaceId={2} />)
    await screen.findByRole('button', { name: /Workspace 2 chat/ })
    await act(async () => {
      if (outcome === 'success') resolve([conversation(1)])
      else reject(new Error('old workspace failure'))
    })
    expect(screen.queryByRole('button', { name: /Workspace 1 chat/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Workspace 2 chat/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not clear a replacement workspace selection after an old deletion completes', async () => {
    let finish!: () => void
    vi.spyOn(window.api.conversations, 'list').mockImplementation(async (id) => [conversation(id)])
    vi.spyOn(window.api.conversations, 'delete').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const change = vi.fn()
    const view = render(<ChatView {...props} onConversationChange={change} workspaceId={1} />)
    const history = screen.getByRole('complementary', { name: /conversations/i })
    await within(history).findByRole('button', { name: /Workspace 1 chat/ })
    fireEvent.click(within(history).getByRole('button', { name: /delete/i }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /delete/i }))
    view.rerender(<ChatView {...props} onConversationChange={change} workspaceId={2} />)
    await screen.findByRole('button', { name: /Workspace 2 chat/ })
    await act(async () => finish())
    expect(change).not.toHaveBeenCalled()
  })
})

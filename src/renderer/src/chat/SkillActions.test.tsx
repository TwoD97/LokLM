import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SkillAction } from '@shared/connections'
import { SkillActions } from './SkillActions'
import { MessageList } from './MessageList'
import {
  clearOrganizerNavigation,
  ORGANIZER_NAVIGATE_EVENT,
} from '../organizer/organizerNavigation'

const action: SkillAction = {
  id: 'action-1',
  toolId: 'organizer.tasks.create',
  title: 'Create task',
  effect: 'write',
  status: 'pending',
  arguments: { title: 'Finish report' },
}
const context = { workspaceId: 2, conversationId: 3, messageId: 4 }
function SavedAction() {
  const [receipt, setReceipt] = useState(action)
  return <SkillActions actions={[receipt]} {...context} onUpdate={setReceipt} />
}
afterEach(() => {
  vi.restoreAllMocks()
  clearOrganizerNavigation()
})

describe('Skill action review', () => {
  it('renders organizer results as readable entries with named destinations and pagination feedback', () => {
    render(
      <SkillActions
        actions={[
          {
            ...action,
            toolId: 'organizer.search',
            status: 'completed',
            effect: 'read',
            result: JSON.stringify({
              hasMore: true,
              items: [
                {
                  kind: 'notes',
                  id: 'note-1',
                  title: 'Project ideas',
                  body: '<script>unsafe</script>',
                  truncated: true,
                },
              ],
            }),
            targets: [{ kind: 'notes', id: 'note-1' }],
          },
        ]}
        {...context}
      />,
    )
    expect(screen.getByText('Project ideas')).toBeVisible()
    expect(screen.getByText('<script>unsafe</script>')).toBeVisible()
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open note: Project ideas' })).toBeEnabled()
    expect(screen.getByText(/More results are available/)).toBeVisible()
    expect(screen.getByText(/Text preview/)).toBeVisible()
  })
  it('waits for a saved message ID before allowing execution', () => {
    render(<SkillActions actions={[action]} workspaceId={2} conversationId={3} />)
    expect(screen.getByRole('button', { name: 'Apply change' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled()
    expect(screen.getByText(/message to be saved/)).toBeVisible()
  })

  it('applies only persisted IDs once and opens a completed organizer result', async () => {
    let finish!: (receipt: SkillAction) => void
    const apply = vi.spyOn(window.api.skills, 'apply').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const navigate = vi.fn()
    window.addEventListener(ORGANIZER_NAVIGATE_EVENT, navigate)
    try {
      render(<SavedAction />)
      fireEvent.click(screen.getByRole('button', { name: 'Apply change' }))
      fireEvent.click(screen.getByRole('button', { name: 'Apply change' }))
      expect(apply).toHaveBeenCalledExactlyOnceWith({ ...context, actionId: action.id })
      await act(async () =>
        finish({
          ...action,
          status: 'completed',
          result: 'Created Finish report',
          targets: [{ kind: 'tasks', id: 'saved-task' }],
        }),
      )
      expect(screen.queryByRole('button', { name: 'Apply change' })).toBeNull()
      expect(screen.getByText('Created Finish report')).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: 'Open task' }))
      expect((navigate.mock.calls[0]![0] as CustomEvent).detail).toEqual({
        kind: 'tasks',
        id: 'saved-task',
      })
    } finally {
      window.removeEventListener(ORGANIZER_NAVIGATE_EVENT, navigate)
    }
  })

  it('blocks replay when an interrupted call cannot be reconciled', async () => {
    const apply = vi
      .spyOn(window.api.skills, 'apply')
      .mockRejectedValue(new Error('connection lost'))
    vi.spyOn(window.api.skills, 'get').mockRejectedValue(new Error('vault locked'))
    render(<SavedAction />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }))
    await screen.findByText(/result could not be verified/)
    expect(screen.getByRole('button', { name: 'Apply change' })).toBeDisabled()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('reconciles against the same workspace and retains feedback when an action remains pending', async () => {
    vi.spyOn(window.api.skills, 'apply').mockRejectedValue(
      new Error('Server configuration changed'),
    )
    const get = vi.spyOn(window.api.skills, 'get').mockResolvedValue(action)
    render(<SavedAction />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Server configuration changed')
    await act(async () => {})
    expect(get).toHaveBeenCalledExactlyOnceWith({ ...context, actionId: action.id })
    expect(screen.getByRole('button', { name: 'Apply change' })).toBeEnabled()
  })

  it('explains uncertain saved actions and expands details for pending review', () => {
    const { rerender } = render(<SkillActions actions={[action]} {...context} />)
    expect(screen.getByText('Requested details').closest('details')).toHaveAttribute('open')
    rerender(<SkillActions actions={[{ ...action, status: 'running' }]} {...context} />)
    expect(screen.getByText(/result could not be verified/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Apply change' })).toBeNull()
  })

  it('renders saved cards even with pipeline details hidden and prevents regeneration', () => {
    const regenerate = vi.fn()
    render(
      <MessageList
        messages={[
          {
            id: 'message',
            messageId: 4,
            role: 'assistant',
            content: 'Review this change.',
            streaming: false,
            skillActions: [action],
          },
        ]}
        actionContext={{ workspaceId: 2, conversationId: 3 }}
        documents={[]}
        onCitationClick={vi.fn()}
        onCopy={vi.fn()}
        onRegenerate={regenerate}
        keepPipelineVisible={false}
      />,
    )
    expect(screen.getByRole('button', { name: 'Apply change' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /regenerate/i })).toBeNull()
    expect(regenerate).not.toHaveBeenCalled()
  })

  it('offers a reviewed external call and can dismiss it without execution', async () => {
    const dismiss = vi
      .spyOn(window.api.skills, 'dismiss')
      .mockResolvedValue({ ...action, status: 'dismissed' })
    const apply = vi.spyOn(window.api.skills, 'apply')
    const update = vi.fn()
    render(
      <SkillActions
        actions={[
          { ...action, effect: 'external', arguments: { query: '<img src=x onerror=alert(1)>' } },
        ]}
        {...context}
        onUpdate={update}
      />,
    )
    expect(screen.getByRole('button', { name: 'Run connected tool' })).toBeEnabled()
    expect(document.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await act(async () => {})
    expect(dismiss).toHaveBeenCalledExactlyOnceWith({ ...context, actionId: action.id })
    expect(apply).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'dismissed' }))
  })
})

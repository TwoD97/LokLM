import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import { clearOrganizerNavigation, openOrganizerItem } from '../organizer/organizerNavigation'

vi.mock('../library/LibraryView', () => ({ LibraryView: () => <p>Library page</p> }))
vi.mock('../chat/ChatView', () => ({
  ChatView: () => (
    <label>
      Chat draft
      <textarea />
    </label>
  ),
}))
vi.mock('../organizer/OrganizerView', () => ({
  OrganizerView: ({ view }: { view: string }) => <p>Organizer {view}</p>,
}))
vi.mock('../settings/useSettings', async () => {
  const { DEFAULT_SETTINGS } = await import('@shared/settings')
  const settings = {
    ...DEFAULT_SETTINGS,
    basic: {
      ...DEFAULT_SETTINGS.basic,
      language: 'en',
      modules: { ...DEFAULT_SETTINGS.basic.modules, notes: false, todos: false, calendar: false },
    },
  }
  return {
    useSettings: () => ({ settings, update: vi.fn(), savedFlash: false, loadFailed: false }),
  }
})
afterEach(() => {
  vi.restoreAllMocks()
  clearOrganizerNavigation()
})

it.each([
  ['notes', 'notes'],
  ['tasks', 'todos'],
  ['events', 'calendar'],
] as const)(
  'opens a %s result, including a hidden module, and preserves the chat draft',
  async (kind, view) => {
    vi.spyOn(window.api.workspaces, 'list').mockResolvedValue([
      { id: 1, name: 'Workspace', createdAt: 0, type: 'library', encryptionLevel: 'full' },
    ])
    render(<AppShell />)
    await screen.findByText('Library page')
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    const draft = await screen.findByRole('textbox', { name: 'Chat draft' })
    fireEvent.change(draft, { target: { value: 'Continue this conversation' } })
    act(() => openOrganizerItem({ kind, id: 'created-item' }))
    expect(await screen.findByText(`Organizer ${view}`)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toHaveValue(
      'Continue this conversation',
    )
  },
)

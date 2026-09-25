import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  OrganizerApi,
  OrganizerSnapshot,
  SaveNoteInput,
  SaveTaskInput,
  SaveEventInput,
} from '@shared/organizer'
import { OrganizerView } from './OrganizerView'
import { dateKey } from './organizerDates'
import { organizerDict } from '../i18n/dict_organizer'

vi.mock('../i18n', () => ({
  useT:
    () =>
    (key: string, args: Record<string, string | number> = {}) => {
      const dict = organizerDict.en as Record<string, string>
      const common: Record<string, string> = {
        'common.cancel': 'Cancel',
        'common.delete': 'Delete',
      }
      return (dict[key] ?? common[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
        String(args[name] ?? name),
      )
    },
}))
vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({ settings: { basic: { language: 'en', weekStartsOn: 1 } } }),
}))

let snapshot: OrganizerSnapshot
let api: OrganizerApi
let counter = 0
const today = dateKey(new Date())
const metadata = (id: string) => ({
  id,
  revision: 1,
  createdAt: '2026-09-24T09:00:00Z',
  updatedAt: '2026-09-24T09:00:00Z',
})

beforeEach(() => {
  snapshot = { notes: [], tasks: [], events: [] }
  counter = 0
  api = {
    list: vi.fn(async () => structuredClone(snapshot)),
    saveNote: vi.fn(async (input: SaveNoteInput) => {
      const note = {
        ...metadata(input.id ?? `note-${++counter}`),
        ...input,
        revision: (input.revision ?? 0) + 1,
      }
      snapshot.notes = [...snapshot.notes.filter((item) => item.id !== note.id), note]
      return note
    }),
    saveTask: vi.fn(async (input: SaveTaskInput) => {
      const task = {
        ...metadata(input.id ?? `task-${++counter}`),
        ...input,
        revision: (input.revision ?? 0) + 1,
      }
      snapshot.tasks = [...snapshot.tasks.filter((item) => item.id !== task.id), task]
      return task
    }),
    saveEvent: vi.fn(async (input: SaveEventInput) => {
      const event = {
        ...metadata(input.id ?? `event-${++counter}`),
        ...input,
        revision: (input.revision ?? 0) + 1,
      }
      snapshot.events = [...snapshot.events.filter((item) => item.id !== event.id), event]
      return event
    }),
    deleteNote: vi.fn(async ({ id }) => {
      snapshot.notes = snapshot.notes.filter((item) => item.id !== id)
    }),
    deleteTask: vi.fn(async ({ id }) => {
      snapshot.tasks = snapshot.tasks.filter((item) => item.id !== id)
    }),
    deleteEvent: vi.fn(async ({ id }) => {
      snapshot.events = snapshot.events.filter((item) => item.id !== id)
    }),
  }
  Object.assign(window.api, { organizer: api })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function opened() {
  await waitFor(() => expect(screen.queryByText('Opening your organizer…')).not.toBeInTheDocument())
}

describe('organizer workspace', () => {
  it('describes an initial load failure accurately and recovers on retry', async () => {
    vi.mocked(api.list).mockRejectedValueOnce(new Error('Read failed'))
    render(<OrganizerView view="notes" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Your organizer could not be opened')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Your draft is kept')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await opened()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Note title')).toBeVisible()
  })

  it('reveals a newly created task when the Completed filter was selected', async () => {
    render(<OrganizerView view="todos" />)
    await opened()
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
    fireEvent.change(screen.getByLabelText('New to-do'), { target: { value: 'Visible new task' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to-do' }))
    expect(await screen.findByRole('button', { name: 'Visible new task' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('To-do added')).toBeVisible()
  })

  it('protects edited task text when changing filters or marking that task done', async () => {
    snapshot.tasks = [
      { ...metadata('t1'), title: 'Original task', completed: false, dueDate: null },
    ]
    render(<OrganizerView view="todos" />)
    await opened()
    fireEvent.click(screen.getByRole('button', { name: 'Original task' }))
    fireEvent.change(screen.getByLabelText('To-do title'), {
      target: { value: 'Unsaved task changes' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('To-do title')).toHaveValue('Unsaved task changes')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete “Original task”' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(api.saveTask).not.toHaveBeenCalled()
    expect(screen.getByLabelText('To-do title')).toHaveValue('Unsaved task changes')
  })
  it('keeps a note draft across module navigation and saves it with Ctrl+S', async () => {
    const view = render(<OrganizerView view="notes" />)
    await opened()
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Research ideas' } })
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Check the source documents.' },
    })
    view.rerender(<OrganizerView view="calendar" />)
    view.rerender(<OrganizerView view="notes" />)
    expect(screen.getByLabelText('Note title')).toHaveValue('Research ideas')
    fireEvent.keyDown(screen.getByLabelText('Note', { exact: true }), { key: 's', ctrlKey: true })
    await waitFor(() =>
      expect(api.saveNote).toHaveBeenCalledWith({
        title: 'Research ideas',
        body: 'Check the source documents.',
      }),
    )
    expect(await screen.findByText('Saved', { exact: true })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Research ideas Check the source/ }),
    ).toBeInTheDocument()
  })

  it('guards dirty note selection and requires confirmation before deleting', async () => {
    snapshot.notes = [{ ...metadata('n1'), title: 'Saved reference', body: 'Original' }]
    render(<OrganizerView view="notes" />)
    await opened()
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Unsaved idea' } })
    fireEvent.click(screen.getByRole('button', { name: /Saved reference Original/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Note title')).toHaveValue('Unsaved idea')
    fireEvent.click(screen.getByRole('button', { name: /Saved reference Original/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByLabelText('Note title')).toHaveValue('Saved reference')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(api.deleteNote).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(api.deleteNote).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'n1', revision: 1 }),
      ),
    )
    await waitFor(() => expect(screen.getByLabelText('Note title')).toHaveValue(''))
  })

  it('retains a failed save for retry and prevents duplicate pending saves', async () => {
    let reject!: (reason: Error) => void
    vi.mocked(api.saveNote).mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail
        }),
    )
    render(<OrganizerView view="notes" />)
    await opened()
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    fireEvent.keyDown(screen.getByLabelText('Note title'), { key: 's', ctrlKey: true })
    expect(api.saveNote).toHaveBeenCalledTimes(1)
    reject(new Error('Disk full'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is kept')
    expect(screen.getByLabelText('Note title')).toHaveValue('Keep this draft')
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByText('Saved', { exact: true })).toBeInTheDocument()
  })

  it('adds a dated task, shares it with the calendar, and filters completed tasks', async () => {
    const view = render(<OrganizerView view="todos" />)
    await opened()
    fireEvent.change(screen.getByLabelText('New to-do'), { target: { value: 'Prepare handout' } })
    fireEvent.change(screen.getByLabelText('Due date (optional)'), { target: { value: today } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to-do' }))
    await screen.findByRole('button', { name: 'Prepare handout' })
    view.rerender(<OrganizerView view="calendar" />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Prepare handout' }))
    await waitFor(() =>
      expect(api.saveTask).toHaveBeenLastCalledWith(
        expect.objectContaining({ completed: true, dueDate: today }),
      ),
    )
    view.rerender(<OrganizerView view="todos" />)
    await screen.findByText('You’re all caught up')
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
    expect(screen.getByRole('checkbox', { name: 'Mark “Prepare handout” as open' })).toBeChecked()
  })

  it('validates event times and saves a useful calendar entry', async () => {
    render(<OrganizerView view="calendar" />)
    await opened()
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Planning review' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'All day' }))
    fireEvent.change(screen.getByLabelText('End time (optional)'), { target: { value: '08:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
    expect(screen.getByRole('alert')).toHaveTextContent('after the start time')
    expect(api.saveEvent).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('End time (optional)'), { target: { value: '10:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
    expect(
      await screen.findByRole('button', { name: /09:00–10:30 Planning review/ }),
    ).toBeInTheDocument()
    expect(api.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({ date: today, startTime: '09:00', endTime: '10:30' }),
    )
  })

  it('keeps a calendar draft when declining a date change', async () => {
    render(<OrganizerView view="calendar" />)
    await opened()
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Draft event' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Event title')).toHaveValue('Draft event')
    expect(api.saveEvent).not.toHaveBeenCalled()
  })

  it('refreshes a conflicting item without throwing away the local note draft', async () => {
    snapshot.notes = [{ ...metadata('n1'), title: 'Reference', body: 'Original' }]
    render(<OrganizerView view="notes" />)
    await opened()
    fireEvent.click(screen.getByRole('button', { name: /Reference Original/ }))
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'My local changes' },
    })
    vi.mocked(api.saveNote).mockImplementationOnce(async () => {
      snapshot.notes = [
        { ...metadata('n1'), revision: 2, title: 'Reference', body: 'Changed elsewhere' },
      ]
      throw new Error('ORGANIZER_CONFLICT: This item changed.')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This item changed elsewhere')
    expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('My local changes')
    fireEvent.click(screen.getByRole('button', { name: /Reference Changed elsewhere/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('Changed elsewhere')
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Revised safely' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() =>
      expect(api.saveNote).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'n1', revision: 2, body: 'Revised safely' }),
      ),
    )
  })

  it('edits a task due date and confirms its removal', async () => {
    snapshot.tasks = [{ ...metadata('t1'), title: 'Review draft', completed: false, dueDate: null }]
    render(<OrganizerView view="todos" />)
    await opened()
    fireEvent.click(screen.getByRole('button', { name: 'Edit “Review draft”' }))
    fireEvent.change(screen.getByLabelText('To-do title'), {
      target: { value: 'Review final draft' },
    })
    fireEvent.change(screen.getAllByLabelText('Due date (optional)')[1]!, {
      target: { value: '2026-10-02' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save to-do' }))
    await screen.findByRole('button', { name: 'Review final draft' })
    expect(api.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 't1',
        title: 'Review final draft',
        dueDate: '2026-10-02',
        revision: 1,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete “Review final draft”' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(api.deleteTask).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete “Review final draft”' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(api.deleteTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 't1', revision: 2 }),
      ),
    )
  })

  it('navigates the calendar by keyboard and validates dates for keyboard saves', async () => {
    render(<OrganizerView view="calendar" />)
    await opened()
    const day = within(screen.getByRole('table')).getByRole('button', { pressed: true })
    fireEvent.keyDown(day, { key: 'ArrowRight' })
    const next = within(screen.getByRole('table')).getByRole('button', { pressed: true })
    expect(next).not.toBe(day)
    expect(next).toHaveAttribute('tabindex', '0')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Date needed' } })
    fireEvent.change(screen.getByLabelText('Date', { exact: true }), { target: { value: '' } })
    fireEvent.keyDown(screen.getByLabelText('Event title'), { key: 's', ctrlKey: true })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a valid date')
    expect(api.saveEvent).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { OrganizerService } from '../../src/main/services/organizer/OrganizerService'
import {
  runOrganizerTool,
  validateOrganizerArguments,
} from '../../src/main/services/skills/organizerTools'
import { ORGANIZER_LIMITS } from '../../src/shared/organizer'

function fixture() {
  const kv = new Map<string, string>()
  const persist = vi.fn(async () => {})
  const organizer = new OrganizerService(
    {
      getKv: (key) => kv.get(key) ?? null,
      setKv: (key, value) => {
        kv.set(key, value)
      },
      deleteKv: (key) => {
        kv.delete(key)
      },
    },
    persist,
    () => true,
  )
  return { organizer, persist }
}
const page = (result: { result?: string }) =>
  JSON.parse(result.result!) as {
    hasMore: boolean
    nextOffset?: number
    items: Array<{
      body?: string
      bodyLength?: number
      bodyOffset?: number
      details?: string
      detailsLength?: number
      truncated: boolean
      hasMore: boolean
      title: string
    }>
  }

describe('organizer skill note editing', () => {
  it('reads all pages of a long note with explicit offsets and truncation metadata', async () => {
    const { organizer } = fixture()
    const body = `Header\n${'x'.repeat(9000)}\nKeep this tail`
    const note = await organizer.saveNote({ title: 'Long note', body })
    const first = page(
      await runOrganizerTool(organizer, 'organizer.get', { kind: 'notes', id: note.id }),
    )
    expect(first).toMatchObject({
      hasMore: true,
      nextOffset: 8000,
      items: [{ bodyLength: body.length, bodyOffset: 0, truncated: true, hasMore: true }],
    })
    expect(first.items[0]!.body).toHaveLength(8000)
    const second = page(
      await runOrganizerTool(organizer, 'organizer.get', {
        kind: 'notes',
        id: note.id,
        offset: first.nextOffset,
        limit: 8000,
      }),
    )
    expect(second).toMatchObject({
      hasMore: false,
      items: [{ bodyOffset: 8000, bodyLength: body.length, truncated: true, hasMore: false }],
    })
    expect(first.items[0]!.body! + second.items[0]!.body!).toBe(body)
    expect(second.nextOffset).toBeUndefined()
  })

  it('blocks replacing a long note from a truncated read and preserves its entire body', async () => {
    const { organizer, persist } = fixture()
    const body = `Start ${'x'.repeat(9000)} private tail`
    const note = await organizer.saveNote({ title: 'Long', body })
    await expect(
      runOrganizerTool(organizer, 'organizer.saveNote', {
        id: note.id,
        revision: note.revision,
        title: note.title,
        body: 'Only the visible prefix',
      }),
    ).rejects.toThrow('Use editNote')
    expect((await organizer.list()).notes[0]!.body).toBe(body)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('replaces one exact excerpt while preserving unseen long-note text and title', async () => {
    const { organizer } = fixture()
    const body = `Change this excerpt.\n${'x'.repeat(9000)}\nUnseen tail stays intact.`
    const note = await organizer.saveNote({ title: 'Long', body })
    const result = await runOrganizerTool(organizer, 'organizer.editNote', {
      id: note.id,
      revision: note.revision,
      find: 'Change this excerpt.',
      replace: 'Updated excerpt.',
    })
    const saved = (await organizer.list()).notes[0]!
    expect(saved).toMatchObject({
      id: note.id,
      title: note.title,
      revision: 2,
      body: body.replace('Change this excerpt.', 'Updated excerpt.'),
    })
    expect(result.targets).toEqual([{ kind: 'notes', id: note.id }])
    await expect(
      runOrganizerTool(organizer, 'organizer.editNote', {
        id: note.id,
        revision: 1,
        find: 'Updated excerpt.',
        replace: 'Stale rewrite',
      }),
    ).rejects.toThrow('ORGANIZER_CONFLICT')
  })

  it.each([
    ['repeat repeat', 'repeat', 'more than once'],
    ['aaa', 'aa', 'more than once'],
    ['Original', 'missing', 'not found'],
    ['Original', '', 'nonempty'],
  ])('rejects unsafe excerpt selection in %s', async (body, find, error) => {
    const { organizer, persist } = fixture()
    const note = await organizer.saveNote({ title: 'Note', body })
    await expect(
      runOrganizerTool(organizer, 'organizer.editNote', {
        id: note.id,
        revision: note.revision,
        find,
        replace: 'Changed',
      }),
    ).rejects.toThrow(error)
    expect((await organizer.list()).notes[0]!.body).toBe(body)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('supports removing an exact excerpt and rejects edits exceeding the storage limit', async () => {
    const { organizer } = fixture()
    const note = await organizer.saveNote({ title: 'Note', body: 'Before [remove me] after' })
    await runOrganizerTool(organizer, 'organizer.editNote', {
      id: note.id,
      revision: note.revision,
      find: '[remove me]',
      replace: '',
    })
    expect((await organizer.list()).notes[0]!.body).toBe('Before  after')
    const large = await organizer.saveNote({
      title: 'Maximum',
      body: `A${'x'.repeat(ORGANIZER_LIMITS.noteBody - 1)}`,
    })
    await expect(
      runOrganizerTool(organizer, 'organizer.editNote', {
        id: large.id,
        revision: large.revision,
        find: 'A',
        replace: 'Longer',
      }),
    ).rejects.toThrow('too large')
    expect((await organizer.list()).notes.find((item) => item.id === large.id)!.body).toBe(
      large.body,
    )
  })

  it('keeps short-note replacements and event/task reads working', async () => {
    const { organizer } = fixture()
    const note = await organizer.saveNote({ title: 'Short', body: 'Old' })
    await runOrganizerTool(organizer, 'organizer.saveNote', {
      id: note.id,
      revision: note.revision,
      title: note.title,
      body: 'Complete new body',
    })
    expect((await organizer.list()).notes[0]!.body).toBe('Complete new body')
    const event = await organizer.saveEvent({
      title: 'Meeting',
      date: '2026-10-20',
      startTime: '09:00',
      endTime: '10:00',
      details: 'Room 3',
    })
    expect(
      page(await runOrganizerTool(organizer, 'organizer.get', { kind: 'events', id: event.id })),
    ).toMatchObject({
      hasMore: false,
      items: [{ title: event.title, details: event.details, detailsLength: 6, truncated: false }],
    })
    const task = await organizer.saveTask({ title: 'Review', dueDate: null, completed: false })
    expect(
      page(await runOrganizerTool(organizer, 'organizer.get', { kind: 'tasks', id: task.id })),
    ).toMatchObject({ hasMore: false, items: [{ title: task.title, truncated: false }] })
  })

  it('blocks replacing long calendar details from a partial read', async () => {
    const { organizer, persist } = fixture()
    const event = await organizer.saveEvent({
      title: 'Detailed agenda',
      date: '2026-10-20',
      startTime: null,
      endTime: null,
      details: `${'x'.repeat(9000)} Keep the final decisions`,
    })
    const first = page(
      await runOrganizerTool(organizer, 'organizer.get', { kind: 'events', id: event.id }),
    )
    expect(first).toMatchObject({
      hasMore: true,
      nextOffset: 8000,
      items: [{ detailsLength: event.details.length, truncated: true }],
    })
    await expect(
      runOrganizerTool(organizer, 'organizer.saveEvent', {
        id: event.id,
        revision: event.revision,
        title: event.title,
        date: event.date,
        startTime: null,
        endTime: null,
        details: first.items[0]!.details,
      }),
    ).rejects.toThrow('Calendar view')
    expect((await organizer.list()).events[0]!.details).toBe(event.details)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('uses distinct bounds for result-count search limits and character read limits', async () => {
    expect(() => validateOrganizerArguments('organizer.search', { limit: 31 })).toThrow('30')
    expect(() =>
      validateOrganizerArguments('organizer.get', { kind: 'notes', id: 'n1', limit: 8000 }),
    ).not.toThrow()
    expect(() =>
      validateOrganizerArguments('organizer.get', { kind: 'notes', id: 'n1', limit: 8001 }),
    ).toThrow('8000')
    expect(() =>
      validateOrganizerArguments('organizer.get', { kind: ['notes'], id: 'n1' }),
    ).toThrow('kind')
    const { organizer } = fixture()
    const note = await organizer.saveNote({ title: 'Note', body: 'Short' })
    await expect(
      runOrganizerTool(organizer, 'organizer.get', { kind: 'notes', id: note.id, offset: 6 }),
    ).rejects.toThrow('Offset')
  })
})

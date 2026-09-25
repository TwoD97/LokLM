import { describe, expect, it, vi } from 'vitest'
import { OrganizerService } from '../../src/main/services/organizer/OrganizerService'
import {
  ORGANIZER_KEY,
  ORGANIZER_LIMITS,
  isOrganizerDate,
  isOrganizerTime,
  type SaveEventInput,
  type SaveTaskInput,
} from '../../src/shared/organizer'

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function fixture() {
  const memory = new Map<string, string>()
  let disk = new Map<string, string>()
  let unlocked = true
  const kv = {
    getKv: (key: string) => memory.get(key) ?? null,
    setKv: (key: string, value: string) => {
      memory.set(key, value)
    },
    deleteKv: (key: string) => {
      memory.delete(key)
    },
  }
  const persist = vi.fn(async () => {
    disk = new Map(memory)
  })
  const service = new OrganizerService(kv, persist, () => unlocked)
  return {
    service,
    kv,
    memory,
    persist,
    disk: () => disk,
    lock: () => {
      unlocked = false
    },
    unlock: () => {
      unlocked = true
    },
    reopen: () => {
      memory.clear()
      for (const [key, value] of disk) memory.set(key, value)
      return new OrganizerService(kv, persist, () => unlocked)
    },
  }
}

const newTask: SaveTaskInput = {
  title: 'Prepare workshop',
  completed: false,
  dueDate: '2026-09-25',
}
const newEvent: SaveEventInput = {
  title: 'Workshop',
  date: '2026-09-25',
  startTime: '09:00',
  endTime: '10:30',
  details: 'Room 3',
}

describe('OrganizerService durable encrypted-vault adapter', () => {
  it('round-trips notes, completed tasks and local calendar dates through the store', async () => {
    const f = fixture()
    const note = await f.service.saveNote({
      title: '  Research  ',
      body: 'Grüße 👋\n**Local text**',
    })
    const task = await f.service.saveTask(newTask)
    const event = await f.service.saveEvent(newEvent)
    const allDay = await f.service.saveEvent({
      ...newEvent,
      title: 'Holiday',
      startTime: null,
      endTime: null,
    })
    const done = await f.service.saveTask({ ...task, completed: true })
    expect(note.title).toBe('Research')
    expect(done).toMatchObject({
      id: task.id,
      revision: 2,
      completed: true,
      createdAt: task.createdAt,
    })
    expect(await f.reopen().list()).toEqual({
      notes: [note],
      tasks: [done],
      events: [event, allDay],
    })
    expect(f.persist).toHaveBeenCalledTimes(5)
  })

  it('does not resolve a save or expose it to queued readers before persistence completes', async () => {
    const f = fixture()
    const write = deferred()
    const persistStarted = deferred()
    f.persist.mockImplementationOnce(async () => {
      persistStarted.resolve()
      await write.promise
    })
    let saved = false
    let read = false
    const saving = f.service.saveNote({ title: 'Draft', body: 'Text' }).then((result) => {
      saved = true
      return result
    })
    await persistStarted.promise
    const reading = f.service.list().then((result) => {
      read = true
      return result
    })
    await Promise.resolve()
    expect(saved).toBe(false)
    expect(read).toBe(false)
    write.resolve()
    expect((await saving).title).toBe('Draft')
    expect((await reading).notes).toHaveLength(1)
  })

  it('serializes concurrent changes without losing records or poisoning retries', async () => {
    const f = fixture()
    const write = deferred()
    const started = deferred()
    f.persist.mockImplementationOnce(async () => {
      started.resolve()
      await write.promise
    })
    const first = f.service.saveNote({ title: 'First', body: 'One' })
    const second = f.service.saveTask(newTask)
    await started.promise
    expect(f.persist).toHaveBeenCalledTimes(1)
    write.resolve()
    await Promise.all([first, second])
    expect(f.persist).toHaveBeenCalledTimes(2)
    expect(await f.reopen().list()).toMatchObject({ notes: [{ title: 'First' }], tasks: [newTask] })
  })

  it('rolls back a rejected create and leaves unrelated settings intact', async () => {
    const f = fixture()
    f.memory.set('settings', 'unchanged')
    f.persist.mockRejectedValueOnce(new Error('Disk is full'))
    await expect(f.service.saveNote({ title: 'Unsaved', body: '' })).rejects.toThrow('Disk is full')
    expect(f.memory.get(ORGANIZER_KEY)).toBeUndefined()
    expect(f.memory.get('settings')).toBe('unchanged')
    expect(await f.service.list()).toEqual({ notes: [], tasks: [], events: [] })
    await f.service.saveTask(newTask)
    expect((await f.reopen().list()).tasks).toHaveLength(1)
  })

  it('rolls back rejected edits and deletions without changing revisions', async () => {
    const f = fixture()
    const note = await f.service.saveNote({ title: 'Saved', body: 'Original' })
    f.persist.mockRejectedValueOnce(new Error('Write failed'))
    await expect(f.service.saveNote({ ...note, body: 'Lost edit' })).rejects.toThrow('Write failed')
    expect((await f.service.list()).notes).toEqual([note])
    f.persist.mockRejectedValueOnce(new Error('Write failed'))
    await expect(f.service.deleteNote(note)).rejects.toThrow('Write failed')
    expect((await f.reopen().list()).notes).toEqual([note])
  })

  it('requires matching revisions for edits and deletions and never resurrects deleted records', async () => {
    const f = fixture()
    const note = await f.service.saveNote({ title: 'First', body: '' })
    const updated = await f.service.saveNote({ ...note, title: 'Second' })
    await expect(f.service.saveNote({ ...note, title: 'Stale' })).rejects.toThrow(
      'ORGANIZER_CONFLICT',
    )
    await expect(f.service.deleteNote(note)).rejects.toThrow('ORGANIZER_CONFLICT')
    await f.service.deleteNote(updated)
    await expect(f.service.saveNote({ ...updated, title: 'Resurrected' })).rejects.toThrow(
      'ORGANIZER_CONFLICT',
    )
    expect((await f.reopen().list()).notes).toEqual([])
    expect(f.persist).toHaveBeenCalledTimes(3)
  })

  it('rejects queued and future work after invalidation, including a stale instance after unlock', async () => {
    const f = fixture()
    const write = deferred()
    const started = deferred()
    f.persist.mockImplementationOnce(async () => {
      started.resolve()
      await write.promise
    })
    const saving = f.service.saveTask(newTask)
    const savingResult = expect(saving).rejects.toThrow('ORGANIZER_LOCKED')
    const queued = f.service.saveNote({ title: 'Queued', body: '' })
    const queuedResult = expect(queued).rejects.toThrow('ORGANIZER_LOCKED')
    await started.promise
    f.service.invalidate()
    write.resolve()
    await Promise.all([savingResult, queuedResult, f.service.drain()])
    expect(f.persist).toHaveBeenCalledTimes(1)
    f.lock()
    f.unlock()
    await expect(f.service.list()).rejects.toThrow('ORGANIZER_LOCKED')
  })

  it('does not report a skipped persist as saved or leak data to locked readers', async () => {
    const f = fixture()
    f.persist.mockImplementationOnce(async () => {
      f.lock()
    })
    await expect(f.service.saveTask(newTask)).rejects.toThrow('ORGANIZER_LOCKED')
    await expect(f.service.list()).rejects.toThrow('ORGANIZER_LOCKED')
    expect(f.disk().size).toBe(0)
  })

  it('does not write rollback data into a different session after invalidation', async () => {
    const f = fixture()
    const write = deferred()
    const started = deferred()
    f.persist.mockImplementationOnce(async () => {
      started.resolve()
      await write.promise
    })
    const saving = f.service.saveTask(newTask)
    const savingResult = expect(saving).rejects.toThrow('Write interrupted')
    await started.promise
    f.service.invalidate()
    f.memory.set(ORGANIZER_KEY, 'New session content')
    write.reject(new Error('Write interrupted'))
    await savingResult
    expect(f.memory.get(ORGANIZER_KEY)).toBe('New session content')
  })

  it.each([
    'bad JSON',
    '{"schemaVersion":99}',
    '{"schemaVersion":1,"notes":[],"tasks":false,"events":[]}',
  ])('preserves unreadable data rather than silently resetting it: %s', async (stored) => {
    const f = fixture()
    f.memory.set(ORGANIZER_KEY, stored)
    await expect(f.service.list()).rejects.toThrow('ORGANIZER_CORRUPT')
    await expect(f.service.saveTask(newTask)).rejects.toThrow('ORGANIZER_CORRUPT')
    expect(f.memory.get(ORGANIZER_KEY)).toBe(stored)
    expect(f.persist).not.toHaveBeenCalled()
  })

  it('deletes each item type durably and keeps returned snapshots detached', async () => {
    const f = fixture()
    const note = await f.service.saveNote({ title: 'Keep private', body: 'Text' })
    const task = await f.service.saveTask(newTask)
    const event = await f.service.saveEvent(newEvent)
    const snapshot = await f.service.list()
    snapshot.tasks[0]!.title = 'Mutated outside service'
    note.title = 'Also mutated'
    expect((await f.service.list()).notes[0]!.title).toBe('Keep private')
    expect((await f.service.list()).tasks[0]!.title).toBe(newTask.title)
    await Promise.all([
      f.service.deleteNote(note),
      f.service.deleteTask(task),
      f.service.deleteEvent(event),
    ])
    expect(await f.reopen().list()).toEqual({ notes: [], tasks: [], events: [] })
  })
})

describe('Organizer input validation', () => {
  it.each(['2024-02-29', '2000-02-29', '2026-09-24', '0001-01-01', '9999-12-31'])(
    'accepts actual local dates: %s',
    (date) => {
      expect(isOrganizerDate(date)).toBe(true)
    },
  )

  it.each([
    '2025-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '0000-01-01',
    '2026-9-24',
    '2026-09-24T00:00:00Z',
    '',
    null,
  ])('rejects malformed or impossible dates: %s', (date) => {
    expect(isOrganizerDate(date)).toBe(false)
  })

  it.each(['00:00', '09:05', '23:59'])('accepts local times: %s', (time) => {
    expect(isOrganizerTime(time)).toBe(true)
  })

  it.each(['24:00', '12:60', '9:00', '09:00Z', '', null])('rejects malformed times: %s', (time) => {
    expect(isOrganizerTime(time)).toBe(false)
  })

  it('validates calendar ordering and all-day times on the backend', async () => {
    const f = fixture()
    for (const event of [
      { ...newEvent, date: '2026-02-31' },
      { ...newEvent, startTime: '24:00' },
      { ...newEvent, endTime: '09:00' },
      { ...newEvent, endTime: '08:00' },
      { ...newEvent, startTime: null },
    ]) {
      await expect(f.service.saveEvent(event)).rejects.toThrow('ORGANIZER_INVALID')
    }
    expect(f.persist).not.toHaveBeenCalled()
  })

  it('rejects invalid IPC values and oversized text without changing the store', async () => {
    const f = fixture()
    for (const input of [
      null,
      [],
      {},
      { title: ' ', body: '' },
      { title: 'Title', body: 'a'.repeat(ORGANIZER_LIMITS.noteBody + 1) },
      { title: 'a'.repeat(ORGANIZER_LIMITS.title + 1), body: '' },
      { title: 'Title', body: 'a\0b' },
      { title: 'Title', body: '', revision: 3 },
    ]) {
      await expect(f.service.saveNote(input as never)).rejects.toThrow('ORGANIZER_INVALID')
    }
    await expect(f.service.saveTask({ ...newTask, completed: 'false' } as never)).rejects.toThrow(
      'ORGANIZER_INVALID',
    )
    await expect(f.service.saveTask({ ...newTask, dueDate: '2026-02-31' })).rejects.toThrow(
      'ORGANIZER_INVALID',
    )
    await expect(f.service.deleteTask({ id: '../../path', revision: 1 })).rejects.toThrow(
      'ORGANIZER_INVALID',
    )
    expect(f.persist).not.toHaveBeenCalled()
    expect(f.memory.size).toBe(0)
  })
})

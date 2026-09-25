import { randomUUID } from 'node:crypto'
import {
  ORGANIZER_KEY,
  ORGANIZER_LIMITS,
  isOrganizerDate,
  isOrganizerTime,
  type DeleteOrganizerInput,
  type OrganizerApi,
  type OrganizerEvent,
  type OrganizerNote,
  type OrganizerSnapshot,
  type OrganizerTask,
  type SaveEventInput,
  type SaveNoteInput,
  type SaveTaskInput,
} from '../../../shared/organizer'

interface OrganizerKv {
  getKv(key: string): string | null
  setKv(key: string, value: string): void
  deleteKv(key: string): void
  /** AuthService's transaction primitive; plain in-memory test stores can omit it. */
  setKvDurably?(key: string, value: string | null): Promise<void>
}

type RecordKind = keyof OrganizerSnapshot
type OrganizerItem = OrganizerNote | OrganizerTask | OrganizerEvent
type ItemFor<K extends RecordKind> = OrganizerSnapshot[K][number]
type InputObject = Record<string, unknown>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One instance per unlocked session. All operations, including reads, share a
 * queue so callers cannot observe a mutation before its encrypted vault write
 * succeeds. The caller must invalidate/drain this service before explicit lock
 * and discard it on every lock/logout; a later login gets a fresh instance. */
export class OrganizerService implements OrganizerApi {
  private queue: Promise<void> = Promise.resolve()
  private invalidated = false

  constructor(
    private readonly kv: OrganizerKv,
    private readonly persistSnapshot: () => Promise<void>,
    private readonly isUnlocked: () => boolean,
  ) {}

  invalidate(): void {
    this.invalidated = true
  }

  /** Resolves after accepted work has settled, including failed writes. */
  drain(): Promise<void> {
    return this.queue
  }

  list(): Promise<OrganizerSnapshot> {
    return this.enqueue(async () => this.read())
  }

  saveNote(input: SaveNoteInput): Promise<OrganizerNote> {
    return this.save('notes', input, noteFields)
  }

  saveTask(input: SaveTaskInput): Promise<OrganizerTask> {
    return this.save('tasks', input, taskFields)
  }

  saveEvent(input: SaveEventInput): Promise<OrganizerEvent> {
    return this.save('events', input, eventFields)
  }

  deleteNote(input: DeleteOrganizerInput): Promise<void> {
    return this.remove('notes', input)
  }

  deleteTask(input: DeleteOrganizerInput): Promise<void> {
    return this.remove('tasks', input)
  }

  deleteEvent(input: DeleteOrganizerInput): Promise<void> {
    return this.remove('events', input)
  }

  private assertUnlocked(): void {
    if (this.invalidated || !this.isUnlocked()) {
      throw new Error('ORGANIZER_LOCKED: Unlock your account to use the organizer.')
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      this.assertUnlocked()
      return operation()
    })
    // A rejected operation must not poison subsequent reads or a retry.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private read(): OrganizerSnapshot {
    const raw = this.kv.getKv(ORGANIZER_KEY)
    if (raw === null) return { notes: [], tasks: [], events: [] }
    try {
      if (Buffer.byteLength(raw, 'utf8') > ORGANIZER_LIMITS.storedBytes) throw new Error('Size')
      const stored = object(JSON.parse(raw))
      if (stored.schemaVersion !== 1) throw new Error('Version')
      return {
        notes: readItems(stored.notes, noteFields),
        tasks: readItems(stored.tasks, taskFields),
        events: readItems(stored.events, eventFields),
      }
    } catch {
      // Never silently replace unreadable data with an empty organizer.
      throw new Error('ORGANIZER_CORRUPT: Organizer data could not be read. No data was changed.')
    }
  }

  private save<K extends RecordKind>(
    kind: K,
    input: unknown,
    fields: (value: InputObject) => Omit<ItemFor<K>, keyof RecordMetadata>,
  ): Promise<ItemFor<K>> {
    return this.enqueue(async () => {
      const value = object(input)
      const data = fields(value)
      const snapshot = this.read()
      const items = snapshot[kind] as ItemFor<K>[]
      const now = new Date().toISOString()
      let saved: ItemFor<K>
      if (value.id === undefined) {
        if (value.revision !== undefined) invalid('A new item cannot have a revision.')
        if (items.length >= ORGANIZER_LIMITS.itemsPerKind) {
          throw new Error(
            'ORGANIZER_LIMIT: There are too many items. Remove an item before adding another.',
          )
        }
        saved = {
          ...data,
          id: randomUUID(),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        } as ItemFor<K>
        items.push(saved)
      } else {
        const id = identifier(value.id)
        const revision = revisionNumber(value.revision)
        const index = items.findIndex((item) => item.id === id)
        const previous = items[index]
        if (!previous || previous.revision !== revision) conflict()
        saved = {
          ...data,
          id,
          revision: revision + 1,
          createdAt: previous.createdAt,
          updatedAt: now,
        } as ItemFor<K>
        items[index] = saved
      }
      await this.commit(snapshot)
      return saved
    })
  }

  private remove(kind: RecordKind, input: unknown): Promise<void> {
    return this.enqueue(async () => {
      const value = object(input)
      const id = identifier(value.id)
      const revision = revisionNumber(value.revision)
      const snapshot = this.read()
      const items = snapshot[kind] as OrganizerItem[]
      const index = items.findIndex((item) => item.id === id)
      const previous = items[index]
      if (!previous || previous.revision !== revision) conflict()
      items.splice(index, 1)
      await this.commit(snapshot)
    })
  }

  private async commit(snapshot: OrganizerSnapshot): Promise<void> {
    this.assertUnlocked()
    const serialized = JSON.stringify({ schemaVersion: 1, ...snapshot })
    if (Buffer.byteLength(serialized, 'utf8') > ORGANIZER_LIMITS.storedBytes) {
      throw new Error(
        'ORGANIZER_LIMIT: Organizer storage is full. Shorten or remove an item and try again.',
      )
    }
    if (this.kv.setKvDurably) {
      // AuthService keeps this candidate isolated from settings/manifest
      // snapshots and publishes it only after the encrypted file is durable.
      await this.kv.setKvDurably(ORGANIZER_KEY, serialized)
      this.assertUnlocked()
      return
    }
    // Compatibility for simple KV adapters. Production uses the transaction
    // primitive above, which needs no temporary state or compensating rollback.
    const previous = this.kv.getKv(ORGANIZER_KEY)
    this.kv.setKv(ORGANIZER_KEY, serialized)
    try {
      await this.persistSnapshot()
    } catch (error) {
      // Roll back just this key, never unrelated settings. If the session was
      // invalidated, do not repopulate a locked or newly unlocked vault.
      if (!this.invalidated && this.isUnlocked()) {
        if (previous === null) this.kv.deleteKv(ORGANIZER_KEY)
        else this.kv.setKv(ORGANIZER_KEY, previous)
      }
      throw error
    }
    // persistSnapshotIfUnlocked can otherwise quietly resolve after auto-lock.
    // No caller may display "Saved" on a skipped write or a stale session.
    this.assertUnlocked()
  }
}

interface RecordMetadata {
  id: string
  revision: number
  createdAt: string
  updatedAt: string
}

function object(value: unknown): InputObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('Expected an item object.')
  }
  return value as InputObject
}

function invalid(message: string): never {
  throw new Error(`ORGANIZER_INVALID: ${message}`)
}

function conflict(): never {
  throw new Error('ORGANIZER_CONFLICT: This item changed. Reload it before saving or deleting.')
}

function text(value: unknown, max: number, name: string, required = false): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) {
    invalid(`${name} must be text of at most ${max} characters.`)
  }
  if (required && !value.trim()) invalid(`${name} is required.`)
  return required ? value.trim() : value
}

function title(value: unknown): string {
  return text(value, ORGANIZER_LIMITS.title, 'Title', true)
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid('The item ID is invalid.')
  return value
}

function revisionNumber(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value >= Number.MAX_SAFE_INTEGER
  ) {
    invalid('A valid item revision is required.')
  }
  return value
}

function noteFields(value: InputObject): Pick<OrganizerNote, 'title' | 'body'> {
  return { title: title(value.title), body: text(value.body, ORGANIZER_LIMITS.noteBody, 'Note') }
}

function taskFields(value: InputObject): Pick<OrganizerTask, 'title' | 'completed' | 'dueDate'> {
  if (typeof value.completed !== 'boolean') invalid('Completed must be true or false.')
  if (value.dueDate !== null && !isOrganizerDate(value.dueDate))
    invalid('Due date must be a valid YYYY-MM-DD date.')
  return { title: title(value.title), completed: value.completed, dueDate: value.dueDate }
}

function eventFields(
  value: InputObject,
): Pick<OrganizerEvent, 'title' | 'date' | 'startTime' | 'endTime' | 'details'> {
  if (!isOrganizerDate(value.date)) invalid('Event date must be a valid YYYY-MM-DD date.')
  if (value.startTime !== null && !isOrganizerTime(value.startTime))
    invalid('Start time must use HH:mm.')
  if (value.endTime !== null && !isOrganizerTime(value.endTime)) invalid('End time must use HH:mm.')
  if (value.endTime !== null && (value.startTime === null || value.endTime <= value.startTime)) {
    invalid('End time must be later than start time on the same day.')
  }
  return {
    title: title(value.title),
    date: value.date,
    startTime: value.startTime,
    endTime: value.endTime,
    details: text(value.details, ORGANIZER_LIMITS.eventDetails, 'Event details'),
  }
}

function readItems<T extends object>(
  value: unknown,
  fields: (item: InputObject) => T,
): (T & RecordMetadata)[] {
  if (!Array.isArray(value) || value.length > ORGANIZER_LIMITS.itemsPerKind)
    invalid('Invalid item list.')
  const seen = new Set<string>()
  return value.map((raw) => {
    const item = object(raw)
    const id = identifier(item.id)
    if (seen.has(id)) invalid('Duplicate item ID.')
    seen.add(id)
    const createdAt = timestamp(item.createdAt)
    const updatedAt = timestamp(item.updatedAt)
    return { ...fields(item), id, revision: revisionNumber(item.revision), createdAt, updatedAt }
  })
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    invalid('Invalid item timestamp.')
  if (new Date(value).toISOString() !== value) invalid('Invalid item timestamp.')
  return value
}

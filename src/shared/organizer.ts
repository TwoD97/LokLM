/** Local organizer data lives inside the encrypted account vault. Dates and
 * times are local calendar values, not UTC instants or reminder schedules. */
export const ORGANIZER_KEY = 'organizer.v1'

export const ORGANIZER_LIMITS = {
  title: 200,
  noteBody: 100_000,
  eventDetails: 10_000,
  itemsPerKind: 10_000,
  storedBytes: 16 * 1024 * 1024,
} as const

interface OrganizerRecord {
  id: string
  revision: number
  createdAt: string
  updatedAt: string
}

export interface OrganizerNote extends OrganizerRecord {
  title: string
  body: string
}

export interface OrganizerTask extends OrganizerRecord {
  title: string
  completed: boolean
  /** YYYY-MM-DD in the user's local calendar, or no due date. */
  dueDate: string | null
}

export interface OrganizerEvent extends OrganizerRecord {
  title: string
  /** YYYY-MM-DD in the user's local calendar. */
  date: string
  /** HH:mm, or null for an all-day event. */
  startTime: string | null
  endTime: string | null
  details: string
}

export interface OrganizerSnapshot {
  notes: OrganizerNote[]
  tasks: OrganizerTask[]
  events: OrganizerEvent[]
}

/** Omit id/revision to create; supply both to update a specific revision. */
interface SaveOrganizerRecord {
  id?: string
  revision?: number
}

export interface SaveNoteInput extends SaveOrganizerRecord {
  title: string
  body: string
}

export interface SaveTaskInput extends SaveOrganizerRecord {
  title: string
  completed: boolean
  dueDate: string | null
}

export interface SaveEventInput extends SaveOrganizerRecord {
  title: string
  date: string
  startTime: string | null
  endTime: string | null
  details: string
}

export interface DeleteOrganizerInput {
  id: string
  revision: number
}

export interface OrganizerApi {
  list(): Promise<OrganizerSnapshot>
  saveNote(input: SaveNoteInput): Promise<OrganizerNote>
  deleteNote(input: DeleteOrganizerInput): Promise<void>
  saveTask(input: SaveTaskInput): Promise<OrganizerTask>
  deleteTask(input: DeleteOrganizerInput): Promise<void>
  saveEvent(input: SaveEventInput): Promise<OrganizerEvent>
  deleteEvent(input: DeleteOrganizerInput): Promise<void>
}

/** Strict calendar-date validation, independent of time zone and Date's
 * rollover behavior (e.g. February 31 must never become a March date). */
export function isOrganizerDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]!
}

export function isOrganizerTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

import { useId, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import {
  ORGANIZER_LIMITS,
  isOrganizerDate,
  isOrganizerTime,
  type OrganizerEvent,
  type SaveEventInput,
} from '@shared/organizer'
import { ConfirmModal } from '../chat/ConfirmModal'
import { useT } from '../i18n'
import { dateKey, localDate, monthDays, moveDate, moveMonth } from './organizerDates'
import { OrganizerError } from './OrganizerShared'
import { useDiscardGuard, useOrganizerAction } from './useOrganizerActions'
import type { OrganizerStore } from './useOrganizer'

function fields(event: OrganizerEvent): SaveEventInput {
  return {
    id: event.id,
    revision: event.revision,
    title: event.title,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    details: event.details,
  }
}

export function CalendarView({
  store,
  locale,
  weekStartsOn,
}: {
  store: OrganizerStore
  locale: string
  weekStartsOn: 0 | 1
}): JSX.Element {
  const t = useT()
  const today = dateKey(new Date())
  const [selectedDay, setSelectedDay] = useState(today)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [draft, setDraft] = useState<SaveEventInput | null>(null)
  const [original, setOriginal] = useState<SaveEventInput | null>(null)
  const [deleting, setDeleting] = useState<OrganizerEvent | null>(null)
  const [validation, setValidation] = useState<'date' | 'time' | null>(null)
  const [saved, setSaved] = useState(false)
  const addEventRef = useRef<HTMLButtonElement>(null)
  const action = useOrganizerAction()
  const { guard, confirmation } = useDiscardGuard()
  const id = useId()
  const days = useMemo(() => monthDays(month, weekStartsOn), [month, weekStartsOn])
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(original)
  const events = store.data.events
    .filter((event) => event.date === selectedDay)
    .sort(
      (a, b) =>
        (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
        a.title.localeCompare(b.title, locale),
    )
  const tasks = store.data.tasks.filter((task) => task.dueDate === selectedDay)
  const counts = useMemo(() => {
    const byDate = new Map<string, number>()
    for (const event of store.data.events) byDate.set(event.date, (byDate.get(event.date) ?? 0) + 1)
    for (const task of store.data.tasks)
      if (task.dueDate && !task.completed)
        byDate.set(task.dueDate, (byDate.get(task.dueDate) ?? 0) + 1)
    return byDate
  }, [store.data.events, store.data.tasks])
  const longDate = (date: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(localDate(date))
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    localDate(`${month}-01`),
  )
  function chooseDay(day: string, focus = false) {
    if (action.busy || !isOrganizerDate(day)) return
    guard(dirty, () => {
      setSelectedDay(day)
      setMonth(day.slice(0, 7))
      setDraft(null)
      setOriginal(null)
      setSaved(false)
      action.clearError()
      if (focus) requestAnimationFrame(() => document.getElementById(`${id}-${day}`)?.focus())
    })
  }
  function edit(event: OrganizerEvent | null) {
    guard(dirty, () => {
      const initial = event
        ? fields(event)
        : { title: '', date: selectedDay, startTime: null, endTime: null, details: '' }
      setOriginal(initial)
      setDraft(initial)
      setValidation(null)
      setSaved(false)
      action.clearError()
    })
  }
  function patch(next: Partial<SaveEventInput>) {
    setDraft((current) => (current ? { ...current, ...next } : null))
    setValidation(null)
  }
  function save() {
    if (!draft?.title.trim() || !dirty) return
    if (!isOrganizerDate(draft.date)) {
      setValidation('date')
      return
    }
    if (
      (draft.startTime !== null && !isOrganizerTime(draft.startTime)) ||
      (draft.endTime !== null &&
        (!isOrganizerTime(draft.endTime) || !draft.startTime || draft.endTime <= draft.startTime))
    ) {
      setValidation('time')
      return
    }
    void action.run(async () => {
      const result = await store.saveEvent(draft)
      setSelectedDay(result.date)
      setMonth(result.date.slice(0, 7))
      setDraft(null)
      setOriginal(null)
      setSaved(true)
      requestAnimationFrame(() => addEventRef.current?.focus())
    })
  }
  return (
    <div className="organizer__calendar">
      <div className="organizer__month">
        <div className="organizer__month-header">
          <h2 aria-live="polite">{monthLabel}</h2>
          <div className="organizer__month-controls">
            <button disabled={action.busy} onClick={() => chooseDay(today)}>
              {t('organizer.today')}
            </button>
            <button
              className="organizer__icon"
              aria-label={t('organizer.previousMonth')}
              disabled={action.busy || month === '0001-01'}
              onClick={() => chooseDay(`${moveMonth(month, -1)}-01`)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              className="organizer__icon"
              aria-label={t('organizer.nextMonth')}
              disabled={action.busy || month === '9999-12'}
              onClick={() => chooseDay(`${moveMonth(month, 1)}-01`)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <table className="organizer__month-grid">
          <caption className="sr-only">{monthLabel}</caption>
          <thead>
            <tr>
              {days.slice(0, 7).map((day) => (
                <th key={day} scope="col">
                  <abbr
                    title={new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(
                      localDate(day),
                    )}
                  >
                    {new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(localDate(day))}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, week) => (
              <tr key={week}>
                {days.slice(week * 7, week * 7 + 7).map((day) => (
                  <td key={day}>
                    <button
                      type="button"
                      id={`${id}-${day}`}
                      className={`${day.slice(0, 7) !== month ? 'is-outside ' : ''}${day === today ? 'is-today' : ''}`}
                      aria-pressed={selectedDay === day}
                      aria-label={`${longDate(day)}${counts.has(day) ? `, ${t('organizer.dayItems', { count: counts.get(day)! })}` : ''}`}
                      tabIndex={selectedDay === day ? 0 : -1}
                      disabled={action.busy || !isOrganizerDate(day)}
                      onClick={() => chooseDay(day)}
                      onKeyDown={(e) => {
                        const offsets: Record<string, number> = {
                          ArrowLeft: -1,
                          ArrowRight: 1,
                          ArrowUp: -7,
                          ArrowDown: 7,
                          Home: -((localDate(day).getDay() - weekStartsOn + 7) % 7),
                          End: 6 - ((localDate(day).getDay() - weekStartsOn + 7) % 7),
                        }
                        if (e.key in offsets) {
                          e.preventDefault()
                          chooseDay(moveDate(day, offsets[e.key]!), true)
                        }
                      }}
                    >
                      <span>{localDate(day).getDate()}</span>
                      {counts.has(day) && <small aria-hidden="true">{counts.get(day)}</small>}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="organizer__calendar-hint">{t('organizer.calendarHint')}</p>
      </div>
      <div className="organizer__agenda">
        <div className="organizer__agenda-heading">
          <div>
            <span className="organizer__muted">
              {new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(localDate(selectedDay))}
            </span>
            <h2>
              {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(
                localDate(selectedDay),
              )}
            </h2>
          </div>
          <button
            ref={addEventRef}
            className="organizer__primary"
            disabled={action.busy}
            onClick={() => edit(null)}
          >
            <Plus size={16} aria-hidden="true" />
            {t('organizer.addEvent')}
          </button>
        </div>
        <OrganizerError error={action.error} />
        {saved && (
          <p role="status" className="organizer__muted">
            {t('organizer.eventSaved')}
          </p>
        )}
        {draft ? (
          <form
            className="organizer__event-editor"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault()
                save()
              }
            }}
          >
            <h3>{t(draft.id ? 'organizer.editEvent' : 'organizer.newEvent')}</h3>
            <label className="organizer__field">
              {t('organizer.eventTitle')}
              <input
                name="event-title"
                required
                maxLength={ORGANIZER_LIMITS.title}
                autoComplete="off"
                autoFocus
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                disabled={action.busy}
              />
            </label>
            <label className="organizer__field">
              {t('organizer.eventDate')}
              <input
                name="event-date"
                type="date"
                required
                min="0001-01-01"
                max="9999-12-31"
                value={draft.date}
                onChange={(e) => patch({ date: e.target.value })}
                disabled={action.busy}
                aria-invalid={validation === 'date'}
                aria-describedby={validation === 'date' ? `${id}-time-error` : undefined}
              />
            </label>
            <label className="organizer__check">
              <input
                type="checkbox"
                checked={draft.startTime === null}
                disabled={action.busy}
                onChange={(e) =>
                  patch(
                    e.target.checked
                      ? { startTime: null, endTime: null }
                      : { startTime: '09:00', endTime: '10:00' },
                  )
                }
              />
              {t('organizer.allDay')}
            </label>
            {draft.startTime !== null && (
              <div className="organizer__time-fields">
                <label className="organizer__field">
                  {t('organizer.startTime')}
                  <input
                    name="event-start"
                    type="time"
                    required
                    value={draft.startTime}
                    onChange={(e) => patch({ startTime: e.target.value })}
                    disabled={action.busy}
                    aria-invalid={validation === 'time'}
                    aria-describedby={validation === 'time' ? `${id}-time-error` : undefined}
                  />
                </label>
                <label className="organizer__field">
                  {t('organizer.endTime')}
                  <input
                    name="event-end"
                    type="time"
                    value={draft.endTime ?? ''}
                    onChange={(e) => patch({ endTime: e.target.value || null })}
                    disabled={action.busy}
                    aria-invalid={validation === 'time'}
                    aria-describedby={validation === 'time' ? `${id}-time-error` : undefined}
                  />
                </label>
              </div>
            )}
            {validation && (
              <p role="alert" id={`${id}-time-error`} className="organizer__error">
                {t(validation === 'date' ? 'organizer.dateError' : 'organizer.timeError')}
              </p>
            )}
            <label className="organizer__field">
              {t('organizer.eventDetails')}
              <textarea
                name="event-details"
                rows={3}
                maxLength={ORGANIZER_LIMITS.eventDetails}
                value={draft.details}
                onChange={(e) => patch({ details: e.target.value })}
                disabled={action.busy}
              />
            </label>
            <div className="organizer__editor-actions">
              <button
                type="submit"
                className="organizer__primary"
                disabled={action.busy || !dirty || !draft.title.trim()}
              >
                {t(action.busy ? 'organizer.saving' : 'organizer.saveEvent')}
              </button>
              <button
                type="button"
                disabled={action.busy}
                onClick={() =>
                  guard(dirty, () => {
                    setDraft(null)
                    setOriginal(null)
                    action.clearError()
                    requestAnimationFrame(() => addEventRef.current?.focus())
                  })
                }
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <>
            {events.length === 0 && tasks.length === 0 && (
              <div className="organizer__empty organizer__day-empty">
                <CalendarDays size={28} aria-hidden="true" />
                <h3>{t('organizer.freeDay')}</h3>
                <p>{t('organizer.freeDayHint')}</p>
              </div>
            )}
            <ul className="organizer__events">
              {events.map((event) => (
                <li key={event.id}>
                  <button
                    className="organizer__event"
                    disabled={action.busy}
                    onClick={() => edit(event)}
                  >
                    <span>
                      {event.startTime
                        ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''}`
                        : t('organizer.allDay')}
                    </span>
                    <strong>{event.title}</strong>
                    {event.details && <p>{event.details}</p>}
                  </button>
                  <button
                    className="organizer__icon organizer__delete"
                    disabled={action.busy}
                    aria-label={t('organizer.deleteEventNamed', { title: event.title })}
                    onClick={() => setDeleting(event)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {tasks.length > 0 && (
              <div className="organizer__day-tasks">
                <h3>{t('organizer.dueOnDay')}</h3>
                {tasks.map((task) => (
                  <label
                    className={`organizer__check${task.completed ? ' is-completed' : ''}`}
                    key={task.id}
                  >
                    <input
                      type="checkbox"
                      checked={task.completed}
                      disabled={action.busy}
                      onChange={() =>
                        void action.run(async () => {
                          await store.saveTask({ ...task, completed: !task.completed })
                        })
                      }
                    />
                    <span>{task.title}</span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {confirmation}
      {deleting && (
        <ConfirmModal
          title={t('organizer.deleteEvent')}
          body={t('organizer.deleteBody', { title: deleting.title })}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const event = deleting
            setDeleting(null)
            void action.run(async () => {
              await store.deleteEvent(event)
              requestAnimationFrame(() => addEventRef.current?.focus())
            })
          }}
        />
      )}
    </div>
  )
}

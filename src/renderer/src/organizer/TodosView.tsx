import { useMemo, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, ListTodo } from 'lucide-react'
import { ORGANIZER_LIMITS, type OrganizerTask } from '@shared/organizer'
import { ConfirmModal } from '../chat/ConfirmModal'
import { useT } from '../i18n'
import { dateKey, localDate } from './organizerDates'
import { OrganizerError } from './OrganizerShared'
import { useDiscardGuard, useOrganizerAction } from './useOrganizerActions'
import type { OrganizerStore } from './useOrganizer'

export function TodosView({
  store,
  locale,
}: {
  store: OrganizerStore
  locale: string
}): JSX.Element {
  const t = useT()
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [filter, setFilter] = useState<'open' | 'all' | 'completed'>('open')
  const [editing, setEditing] = useState<OrganizerTask | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDue, setEditDue] = useState('')
  const [deleting, setDeleting] = useState<OrganizerTask | null>(null)
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const newTitleRef = useRef<HTMLInputElement>(null)
  const action = useOrganizerAction()
  const guard = useDiscardGuard()
  const today = dateKey(new Date())
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
    [locale],
  )
  const dirty = !!editing && (editTitle !== editing.title || editDue !== (editing.dueDate ?? ''))
  const tasks = useMemo(
    () =>
      store.data.tasks
        .filter(
          (task) => filter === 'all' || (filter === 'completed' ? task.completed : !task.completed),
        )
        .sort(
          (a, b) =>
            Number(a.completed) - Number(b.completed) ||
            (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
            b.createdAt.localeCompare(a.createdAt),
        ),
    [store.data.tasks, filter],
  )
  const open = store.data.tasks.filter((task) => !task.completed).length
  const choose = (task: OrganizerTask | null) =>
    guard.guard(dirty, () => {
      setEditing(task)
      setEditTitle(task?.title ?? '')
      setEditDue(task?.dueDate ?? '')
      action.clearError()
    })
  return (
    <div className="organizer__todos">
      <form
        className="organizer__quick-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          guard.guard(dirty && filter === 'completed', () => {
            void action.run(async () => {
              await store.saveTask({ title, dueDate: dueDate || null, completed: false })
              setTitle('')
              setDueDate('')
              setAnnouncement('organizer.taskAdded')
              if (filter === 'completed') {
                setFilter('open')
                setEditing(null)
              }
              requestAnimationFrame(() => newTitleRef.current?.focus())
            })
          })
        }}
      >
        <label className="organizer__field organizer__grow">
          {t('organizer.newTask')}
          <input
            ref={newTitleRef}
            name="task-title"
            autoComplete="off"
            required
            maxLength={ORGANIZER_LIMITS.title}
            placeholder={t('organizer.taskPlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={action.busy}
          />
        </label>
        <label className="organizer__field">
          {t('organizer.dueDate')}
          <input
            name="task-due"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={action.busy}
          />
        </label>
        <button
          className="organizer__primary"
          type="submit"
          disabled={action.busy || !title.trim()}
        >
          <Plus size={16} aria-hidden="true" />
          {t('organizer.addTask')}
        </button>
      </form>
      <OrganizerError error={action.error} />
      <p className="organizer__save-state" role="status">
        {action.busy ? t('organizer.saving') : !action.error && announcement ? t(announcement) : ''}
      </p>
      <div className="organizer__list-toolbar">
        <div className="organizer__filters" role="group" aria-label={t('organizer.taskFilter')}>
          {(['open', 'all', 'completed'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              disabled={action.busy}
              onClick={() => {
                if (value === filter) return
                guard.guard(dirty, () => {
                  setFilter(value)
                  setEditing(null)
                  action.clearError()
                })
              }}
            >
              {t(`organizer.${value}`)}
            </button>
          ))}
        </div>
        <span>{t('organizer.openTasks', { count: open })}</span>
      </div>
      {tasks.length === 0 && (
        <div className="organizer__empty organizer__empty-large">
          <ListTodo size={32} aria-hidden="true" />
          <h2>
            {t(
              filter === 'completed'
                ? 'organizer.noCompletedTasks'
                : open === 0 && store.data.tasks.length > 0
                  ? 'organizer.allDone'
                  : 'organizer.noTasks',
            )}
          </h2>
          <p>{t('organizer.tasksEmptyHint')}</p>
        </div>
      )}
      <ul className="organizer__tasks">
        {tasks.map((task) => (
          <li key={task.id} className={task.completed ? 'is-completed' : ''}>
            <div className="organizer__task-row">
              <input
                type="checkbox"
                checked={task.completed}
                disabled={action.busy}
                aria-label={t(task.completed ? 'organizer.markOpen' : 'organizer.markDone', {
                  title: task.title,
                })}
                onChange={() =>
                  guard.guard(editing?.id === task.id && dirty, () => {
                    void action.run(async () => {
                      const next = await store.saveTask({ ...task, completed: !task.completed })
                      if (editing?.id === task.id) setEditing(null)
                      setAnnouncement(
                        next.completed ? 'organizer.taskCompleted' : 'organizer.taskReopened',
                      )
                    })
                  })
                }
              />
              <button
                className="organizer__task-title"
                disabled={action.busy}
                onClick={() => choose(task)}
              >
                {task.title}
              </button>
              {task.dueDate && (
                <span
                  className={`organizer__due${!task.completed && task.dueDate < today ? ' is-overdue' : ''}`}
                >
                  {!task.completed && task.dueDate < today && `${t('organizer.overdue')}: `}
                  <time dateTime={task.dueDate}>{dateFormat.format(localDate(task.dueDate))}</time>
                </span>
              )}
              <button
                className="organizer__icon"
                aria-label={t('organizer.editTaskNamed', { title: task.title })}
                disabled={action.busy}
                onClick={() => choose(task)}
              >
                <Pencil size={16} aria-hidden="true" />
              </button>
              <button
                className="organizer__icon organizer__delete"
                aria-label={t('organizer.deleteTaskNamed', { title: task.title })}
                disabled={action.busy}
                onClick={() => setDeleting(task)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
            {editing?.id === task.id && (
              <form
                className="organizer__task-edit"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!editTitle.trim()) return
                  void action.run(async () => {
                    await store.saveTask({ ...editing, title: editTitle, dueDate: editDue || null })
                    setEditing(null)
                    setAnnouncement('organizer.taskSaved')
                  })
                }}
              >
                <label className="organizer__field organizer__grow">
                  {t('organizer.taskTitle')}
                  <input
                    name="edit-task-title"
                    autoFocus
                    required
                    maxLength={ORGANIZER_LIMITS.title}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    disabled={action.busy}
                  />
                </label>
                <label className="organizer__field">
                  {t('organizer.dueDate')}
                  <input
                    name="edit-task-due"
                    type="date"
                    min="0001-01-01"
                    max="9999-12-31"
                    value={editDue}
                    onChange={(e) => setEditDue(e.target.value)}
                    disabled={action.busy}
                  />
                </label>
                <button
                  className="organizer__primary"
                  type="submit"
                  disabled={action.busy || !dirty || !editTitle.trim()}
                >
                  {t('organizer.saveTask')}
                </button>
                <button type="button" disabled={action.busy} onClick={() => choose(null)}>
                  {t('common.cancel')}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {guard.confirmation}
      {deleting && (
        <ConfirmModal
          title={t('organizer.deleteTask')}
          body={t('organizer.deleteBody', { title: deleting.title })}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const task = deleting
            setDeleting(null)
            void action.run(async () => {
              await store.deleteTask(task)
              if (editing?.id === task.id) setEditing(null)
              setAnnouncement('organizer.taskDeleted')
            })
          }}
        />
      )}
    </div>
  )
}

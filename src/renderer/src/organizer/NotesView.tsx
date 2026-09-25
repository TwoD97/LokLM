import { useMemo, useRef, useState } from 'react'
import { Plus, Search, FileText, Trash2, Save } from 'lucide-react'
import type { OrganizerNote } from '@shared/organizer'
import { ORGANIZER_LIMITS } from '@shared/organizer'
import { ConfirmModal } from '../chat/ConfirmModal'
import { useT } from '../i18n'
import { OrganizerError } from './OrganizerShared'
import { useDiscardGuard, useOrganizerAction } from './useOrganizerActions'
import type { OrganizerStore } from './useOrganizer'

export function NotesView({
  store,
  locale,
}: {
  store: OrganizerStore
  locale: string
}): JSX.Element {
  const t = useT()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<OrganizerNote | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const action = useOrganizerAction()
  const { guard, confirmation } = useDiscardGuard()
  const dirty = title !== (selected?.title ?? '') || body !== (selected?.body ?? '')
  const notes = useMemo(
    () =>
      store.data.notes
        .filter((note) =>
          `${note.title}\n${note.body}`
            .toLocaleLowerCase(locale)
            .includes(query.toLocaleLowerCase(locale)),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [store.data.notes, query, locale],
  )

  function choose(note: OrganizerNote | null) {
    if (action.busy) return
    guard(dirty, () => {
      setSelected(note)
      setTitle(note?.title ?? '')
      setBody(note?.body ?? '')
      setSaved(false)
      action.clearError()
      titleRef.current?.focus()
    })
  }
  const save = () => {
    if (!title.trim() || !dirty) return
    void action.run(async () => {
      const note = await store.saveNote({
        ...(selected ? { id: selected.id, revision: selected.revision } : {}),
        title,
        body,
      })
      setSelected(note)
      setTitle(note.title)
      setBody(note.body)
      setSaved(true)
    })
  }
  return (
    <div className="organizer__notes">
      <aside className="organizer__note-list" aria-label={t('organizer.savedNotes')}>
        <button className="organizer__primary" onClick={() => choose(null)} disabled={action.busy}>
          <Plus size={16} aria-hidden="true" />
          {t('organizer.newNote')}
        </button>
        <label className="organizer__search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            name="note-search"
            autoComplete="off"
            aria-label={t('organizer.searchNotes')}
            placeholder={t('organizer.searchNotes')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="organizer__note-items">
          {notes.length === 0 ? (
            <p className="organizer__empty">
              {t(query ? 'organizer.noNotesFound' : 'organizer.noNotes')}
            </p>
          ) : (
            notes.map((note) => (
              <button
                key={note.id}
                className={`organizer__note-item${selected?.id === note.id ? ' is-selected' : ''}`}
                aria-current={selected?.id === note.id ? 'true' : undefined}
                onClick={() => choose(note)}
                disabled={action.busy}
              >
                <strong>{note.title}</strong>
                <span>
                  {note.body.replace(/\s+/g, ' ').slice(0, 110) || t('organizer.emptyNote')}
                </span>
                <time dateTime={note.updatedAt}>
                  {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
                    new Date(note.updatedAt),
                  )}
                </time>
              </button>
            ))
          )}
        </div>
        <p className="organizer__list-count">
          {t('organizer.noteCount', { count: store.data.notes.length })}
        </p>
      </aside>
      <form
        className="organizer__note-editor"
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
        <div className="organizer__editor-heading">
          <FileText size={20} aria-hidden="true" />
          <h2>{t(selected ? 'organizer.editNote' : 'organizer.newNote')}</h2>
          <span className="organizer__save-state" role="status">
            {t(
              action.busy
                ? 'organizer.saving'
                : dirty
                  ? 'organizer.unsaved'
                  : saved
                    ? 'organizer.saved'
                    : 'organizer.saveHint',
            )}
          </span>
        </div>
        <OrganizerError error={action.error} />
        <label className="organizer__field">
          {t('organizer.noteTitle')}
          <input
            ref={titleRef}
            name="note-title"
            required
            maxLength={ORGANIZER_LIMITS.title}
            autoComplete="off"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setSaved(false)
            }}
            disabled={action.busy}
            placeholder={t('organizer.noteTitlePlaceholder')}
          />
        </label>
        <label className="organizer__field organizer__note-body">
          {t('organizer.noteContent')}
          <textarea
            name="note-body"
            maxLength={ORGANIZER_LIMITS.noteBody}
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              setSaved(false)
            }}
            disabled={action.busy}
            placeholder={t('organizer.noteBodyPlaceholder')}
          />
        </label>
        <div className="organizer__editor-actions">
          <button
            type="submit"
            className="organizer__primary"
            disabled={action.busy || !dirty || !title.trim()}
          >
            <Save size={16} aria-hidden="true" />
            {t('organizer.saveNote')}
          </button>
          {selected && (
            <button
              type="button"
              className="organizer__delete"
              disabled={action.busy}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={16} aria-hidden="true" />
              {t('common.delete')}
            </button>
          )}
        </div>
      </form>
      {confirmation}
      {deleting && selected && (
        <ConfirmModal
          title={t('organizer.deleteNote')}
          body={t('organizer.deleteBody', { title: selected.title })}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false)
            void action.run(async () => {
              await store.deleteNote(selected)
              setSelected(null)
              setTitle('')
              setBody('')
              setSaved(false)
              titleRef.current?.focus()
            })
          }}
        />
      )}
    </div>
  )
}

import { useSettings } from '../settings/useSettings'
import { useT } from '../i18n'
import { NotesView } from './NotesView'
import { CalendarView } from './CalendarView'
import { TodosView } from './TodosView'
import { OrganizerError } from './OrganizerShared'
import { useOrganizer } from './useOrganizer'
import './organizer.css'

export function OrganizerView({ view }: { view: 'calendar' | 'notes' | 'todos' }): JSX.Element {
  const store = useOrganizer()
  const t = useT()
  const { settings } = useSettings()
  const locale = settings?.basic.language === 'de' ? 'de-DE' : 'en-GB'
  return (
    <div className="organizer">
      <header className="organizer__header">
        <h1>{t(`organizer.${view}`)}</h1>
        <p>{t(`organizer.${view}Description`)}</p>
      </header>
      {store.loading && <p role="status">{t('organizer.loading')}</p>}
      {store.loadError != null && (
        <div>
          <OrganizerError error={store.loadError} context="load" />
          <button onClick={() => void store.refresh()}>{t('organizer.retry')}</button>
        </div>
      )}
      <div className="organizer__content" hidden={store.loading || store.loadError != null}>
        <section hidden={view !== 'calendar'} aria-label={t('organizer.calendar')}>
          <CalendarView
            store={store}
            locale={locale}
            weekStartsOn={settings?.basic.weekStartsOn ?? 1}
          />
        </section>
        <section hidden={view !== 'notes'} aria-label={t('organizer.notes')}>
          <NotesView store={store} locale={locale} />
        </section>
        <section hidden={view !== 'todos'} aria-label={t('organizer.todos')}>
          <TodosView store={store} locale={locale} />
        </section>
      </div>
    </div>
  )
}

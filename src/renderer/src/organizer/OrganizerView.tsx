import { useCallback, useEffect, useState } from 'react'
import { useSettings } from '../settings/useSettings'
import { useT } from '../i18n'
import { NotesView } from './NotesView'
import { CalendarView } from './CalendarView'
import { TodosView } from './TodosView'
import { OrganizerError } from './OrganizerShared'
import { useOrganizer } from './useOrganizer'
import {
  ORGANIZER_NAVIGATE_EVENT,
  takeOrganizerNavigation,
  type OrganizerNavigationTarget,
} from './organizerNavigation'
import './organizer.css'

export function OrganizerView({ view }: { view: 'calendar' | 'notes' | 'todos' }): JSX.Element {
  const store = useOrganizer()
  const t = useT()
  const { settings } = useSettings()
  const locale = settings?.basic.language === 'de' ? 'de-DE' : 'en-GB'
  const [navigation, setNavigation] = useState<OrganizerNavigationTarget | null>(null)
  const refresh = store.refresh
  useEffect(() => {
    let alive = true
    let request = 0
    const open = (): void => {
      const target = takeOrganizerNavigation()
      if (!target) return
      const id = ++request
      setNavigation(null)
      void refresh().then(() => {
        if (alive && id === request) setNavigation(target)
      })
    }
    window.addEventListener(ORGANIZER_NAVIGATE_EVENT, open)
    open()
    return () => {
      alive = false
      window.removeEventListener(ORGANIZER_NAVIGATE_EVENT, open)
    }
  }, [refresh])
  const navigated = useCallback((): void => setNavigation(null), [])
  const missingTarget =
    navigation &&
    store.loaded &&
    !store.refreshError &&
    !store.data[navigation.kind].some((item) => item.id === navigation.id)
  return (
    <div className="organizer">
      <header className="organizer__header">
        <h1>{t(`organizer.${view}`)}</h1>
        <p>{t(`organizer.${view}Description`)}</p>
      </header>
      {store.loading && !store.loaded && <p role="status">{t('organizer.loading')}</p>}
      {store.loadError != null && (
        <div>
          <OrganizerError error={store.loadError} context="load" />
          <button onClick={() => void store.refresh()}>{t('organizer.retry')}</button>
        </div>
      )}
      {store.refreshError != null && (
        <div>
          <p className="organizer__error" role="alert">
            {t('organizer.refreshError')}
          </p>
          <button onClick={() => void store.refresh()}>{t('organizer.retry')}</button>
        </div>
      )}
      {missingTarget && <p role="status">{t('organizer.itemUnavailable')}</p>}
      <div className="organizer__content" hidden={!store.loaded}>
        <section hidden={view !== 'calendar'} aria-label={t('organizer.calendar')}>
          <CalendarView
            store={store}
            locale={locale}
            weekStartsOn={settings?.basic.weekStartsOn ?? 1}
            navigation={navigation?.kind === 'events' ? navigation : null}
            onNavigated={navigated}
          />
        </section>
        <section hidden={view !== 'notes'} aria-label={t('organizer.notes')}>
          <NotesView
            store={store}
            locale={locale}
            navigation={navigation?.kind === 'notes' ? navigation : null}
            onNavigated={navigated}
          />
        </section>
        <section hidden={view !== 'todos'} aria-label={t('organizer.todos')}>
          <TodosView
            store={store}
            locale={locale}
            navigation={navigation?.kind === 'tasks' ? navigation : null}
            onNavigated={navigated}
          />
        </section>
      </div>
    </div>
  )
}

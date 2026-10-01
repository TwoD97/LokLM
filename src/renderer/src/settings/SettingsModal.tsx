import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  SlidersHorizontal,
  Info,
  Settings as SettingsIcon,
  User,
  LayoutGrid,
  Cpu,
  X,
} from 'lucide-react'
import { useT } from '../i18n'
import { useModalFocus } from '../ui/useModalFocus'
import { ErrorBoundary } from '../ErrorBoundary'
import './SettingsModal.css'

const ProfileTab = lazy(() =>
  import('./ProfileTab').then((module) => ({ default: module.ProfileTab })),
)
const BasicTab = lazy(() => import('./BasicTab').then((module) => ({ default: module.BasicTab })))
const ModulesTab = lazy(() =>
  import('./ModulesTab').then((module) => ({ default: module.ModulesTab })),
)
const SystemTab = lazy(() =>
  import('./SystemTab').then((module) => ({ default: module.SystemTab })),
)
const AdvancedTab = lazy(() =>
  import('./AdvancedTab').then((module) => ({ default: module.AdvancedTab })),
)
const AboutTab = lazy(() => import('./AboutTab').then((module) => ({ default: module.AboutTab })))

const SECTIONS = [
  { id: 'basic', title: 'prefs.general', hint: 'prefs.generalHint', Icon: SettingsIcon },
  { id: 'modules', title: 'prefs.modules', hint: 'prefs.modulesHint', Icon: LayoutGrid },
  { id: 'system', title: 'prefs.system', hint: 'prefs.systemHint', Icon: Cpu },
  {
    id: 'advanced',
    title: 'settings.tab.advanced',
    hint: 'prefs.advancedHint',
    Icon: SlidersHorizontal,
  },
  { id: 'profile', title: 'settings.tab.profile', hint: 'prefs.profileHint', Icon: User },
  { id: 'about', title: 'settings.tab.about', hint: 'prefs.aboutHint', Icon: Info },
] as const
type Tab = (typeof SECTIONS)[number]['id']

export function SettingsModal({
  open,
  onClose,
  initialTab = 'basic',
}: {
  open: boolean
  onClose: () => void
  initialTab?: Tab
}): JSX.Element | null {
  return open ? <SettingsDialog key={initialTab} onClose={onClose} initialTab={initialTab} /> : null
}

function SettingsDialog({
  onClose,
  initialTab,
}: {
  onClose: () => void
  initialTab: Tab
}): JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<Tab>(initialTab)
  const modalRef = useRef<HTMLDivElement>(null)
  useModalFocus(modalRef, true)
  const backdropPressed = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const current = SECTIONS.find((section) => section.id === tab)!
  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        backdropPressed.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropPressed.current) onClose()
        backdropPressed.current = false
      }}
    >
      <div
        className="settings-modal"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('prefs.title')}
      >
        <header className="settings-modal__header">
          <div>
            <h2>{t('prefs.title')}</h2>
            <p>{t('prefs.subtitle')}</p>
          </div>
          <button
            className="settings-modal__close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="settings-modal__layout">
          <div
            className="settings-modal__tabs"
            role="tablist"
            aria-orientation="vertical"
            aria-label={t('prefs.title')}
            onKeyDown={(event) => {
              const index = SECTIONS.findIndex((section) => section.id === tab)
              const next = ['ArrowDown', 'ArrowRight'].includes(event.key)
                ? (index + 1) % SECTIONS.length
                : ['ArrowUp', 'ArrowLeft'].includes(event.key)
                  ? (index + SECTIONS.length - 1) % SECTIONS.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? SECTIONS.length - 1
                      : null
              if (next === null) return
              event.preventDefault()
              setTab(SECTIONS[next]!.id)
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
            }}
          >
            {SECTIONS.map(({ id, title, Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                id={`settings-tab-${id}`}
                aria-controls="settings-panel"
                className={`settings-tab ${tab === id ? 'settings-tab--active' : ''}`}
                onClick={() => setTab(id)}
              >
                <Icon size={18} aria-hidden="true" />
                {t(title)}
              </button>
            ))}
          </div>
          <div
            className="settings-modal__body"
            role="tabpanel"
            id="settings-panel"
            aria-labelledby={`settings-tab-${tab}`}
            tabIndex={0}
            key={tab}
          >
            <div className="preferences-heading">
              <h3>{t(current.title)}</h3>
              <p>{t(current.hint)}</p>
            </div>
            <ErrorBoundary>
              <Suspense fallback={<p role="status">{t('common.loading')}</p>}>
                {tab === 'basic' && <BasicTab />}
                {tab === 'modules' && <ModulesTab />}
                {tab === 'system' && (
                  <SystemTab
                    onOpenAdvanced={() => {
                      setTab('advanced')
                      modalRef.current
                        ?.querySelector<HTMLButtonElement>('#settings-tab-advanced')
                        ?.focus()
                    }}
                  />
                )}
                {tab === 'advanced' && <AdvancedTab />}
                {tab === 'profile' && <ProfileTab />}
                {tab === 'about' && <AboutTab />}
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  )
}

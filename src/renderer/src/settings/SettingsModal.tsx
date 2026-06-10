import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Info, Settings as SettingsIcon, User } from 'lucide-react'
import { ProfileTab } from './ProfileTab'
import { BasicTab } from './BasicTab'
import { AdvancedTab } from './AdvancedTab'
import { AboutTab } from './AboutTab'
import { useT } from '../i18n'
import './SettingsModal.css'

type Tab = 'profile' | 'basic' | 'advanced' | 'about'

type Props = {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: Props): JSX.Element | null {
  const t = useT()
  const [tab, setTab] = useState<Tab>('basic')
  // Tracks whether the mouse press that precedes a click started on the
  // backdrop itself. Without this, selecting text in a field and releasing the
  // mouse over the backdrop fires a click whose target is the backdrop, which
  // would close the modal mid-selection (the press began inside, not on it).
  const backdropPressed = useRef(false)

  // Reset to Basic when the modal opens — keyed on `open` ONLY. Keeping onClose
  // out of these deps is load-bearing: App passes a fresh inline onClose every
  // render and a settings update re-renders App, so depending on onClose here
  // would snap the tab back to Basic on every setting change (e.g. dragging a
  // slider in the Advanced tab).
  useEffect(() => {
    if (open) setTab('basic')
  }, [open])

  // Escape closes while the modal is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(e) => {
        backdropPressed.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        // Close only on a genuine backdrop click — press AND release on the
        // backdrop. A drag that started inside (text selection) leaves
        // backdropPressed false even if the click resolves on the backdrop.
        if (e.target === e.currentTarget && backdropPressed.current) onClose()
        backdropPressed.current = false
      }}
      role="presentation"
    >
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="settings-modal__header">
          <div className="settings-modal__tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'profile'}
              className={`settings-tab ${tab === 'profile' ? 'settings-tab--active' : ''}`}
              onClick={() => setTab('profile')}
            >
              <span className="settings-tab__icon" aria-hidden="true">
                <User size={18} />
              </span>
              {t('settings.tab.profile')}
            </button>
            <button
              role="tab"
              aria-selected={tab === 'basic'}
              className={`settings-tab ${tab === 'basic' ? 'settings-tab--active' : ''}`}
              onClick={() => setTab('basic')}
            >
              <span className="settings-tab__icon" aria-hidden="true">
                <SettingsIcon size={18} />
              </span>
              {t('settings.tab.basic')}
            </button>
            <button
              role="tab"
              aria-selected={tab === 'advanced'}
              className={`settings-tab ${tab === 'advanced' ? 'settings-tab--active' : ''}`}
              onClick={() => setTab('advanced')}
            >
              <span className="settings-tab__icon" aria-hidden="true">
                <AlertTriangle size={18} />
              </span>
              {t('settings.tab.advanced')}
            </button>
            <button
              role="tab"
              aria-selected={tab === 'about'}
              className={`settings-tab ${tab === 'about' ? 'settings-tab--active' : ''}`}
              onClick={() => setTab('about')}
            >
              <span className="settings-tab__icon" aria-hidden="true">
                <Info size={18} />
              </span>
              {t('settings.tab.about')}
            </button>
          </div>
          <button
            className="settings-modal__close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </header>
        <div className="settings-modal__body">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'basic' && <BasicTab />}
          {tab === 'advanced' && <AdvancedTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  )
}

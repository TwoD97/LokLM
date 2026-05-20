import { useEffect, useState } from 'react'
import { ProfileTab } from './ProfileTab'
import { BasicTab } from './BasicTab'
import { AdvancedTab } from './AdvancedTab'
import './SettingsModal.css'

type Tab = 'profile' | 'basic' | 'advanced'

type Props = {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: Props): JSX.Element | null {
  const [tab, setTab] = useState<Tab>('basic')

  useEffect(() => {
    if (!open) return
    setTab('basic') // always reset to Basic on open
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="settings-backdrop" onClick={onClose} role="presentation">
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="settings-modal__header">
          <div className="settings-modal__tabs">
            <button
              className={`settings-tab ${tab === 'profile' ? 'settings-tab--active' : ''}`}
              onClick={() => setTab('profile')}
            >
              Profile
            </button>
            <button
              className={`settings-tab ${tab === 'basic' ? 'settings-tab--active' : ''}`}
              onClick={() => setTab('basic')}
            >
              Basic
            </button>
            <button
              className={`settings-tab ${tab === 'advanced' ? 'settings-tab--active' : ''}`}
              onClick={() => setTab('advanced')}
            >
              Advanced
            </button>
          </div>
          <button className="settings-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="settings-modal__body">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'basic' && <BasicTab />}
          {tab === 'advanced' && <AdvancedTab />}
        </div>
      </div>
    </div>
  )
}

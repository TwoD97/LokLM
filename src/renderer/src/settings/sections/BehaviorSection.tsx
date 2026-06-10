import { useState } from 'react'
import type { UserSettings } from '@shared/settings'
import { Segmented } from '../Segmented'
import { useT } from '../../i18n'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function BehaviorSection({ settings, update }: Props): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(true)
  const runtime = settings.runtime
  const security = settings.security
  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">{t('settings.behavior.title')}</div>
          <div className="settings-group__sub">{t('settings.behavior.sub')}</div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.behavior.convSwitch')}</span>
              <span className="settings-row__hint">{t('settings.behavior.convSwitchHint')}</span>
            </div>
            <Segmented
              ariaLabel={t('settings.behavior.convSwitch')}
              value={runtime.conversationSwitch}
              options={[
                { value: 'keep', label: t('settings.behavior.convKeep') },
                { value: 'unload', label: t('settings.behavior.convUnload') },
              ]}
              onChange={(v) => void update({ runtime: { conversationSwitch: v } })}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.behavior.autoLock')}</span>
              <span className="settings-row__hint">{t('settings.behavior.autoLockHint')}</span>
            </div>
            <Segmented
              ariaLabel={t('settings.behavior.autoLock')}
              value={String(security.autoLockMinutes)}
              options={[
                { value: '5', label: t('settings.behavior.lock5') },
                { value: '15', label: t('settings.behavior.lock15') },
                { value: '60', label: t('settings.behavior.lock60') },
                { value: '0', label: t('settings.behavior.lockNever') },
              ]}
              onChange={(v) =>
                void update({ security: { autoLockMinutes: Number(v) as 5 | 15 | 60 | 0 } })
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

import { SectionHeader } from './SectionHeader'
import { useId, useState } from 'react'
import type { UserSettings } from '@shared/settings'
import { Segmented } from '../Segmented'
import { useT } from '../../i18n'
import { usePreferenceSave } from '../usePreferenceSave'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function BehaviorSection({ settings, update }: Props): JSX.Element {
  const t = useT()
  const sectionId = useId()
  const [open, setOpen] = useState(true)
  const { save, failed } = usePreferenceSave(update)
  const runtime = settings.runtime
  const security = settings.security
  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <SectionHeader
        id={sectionId}
        title={t('settings.behavior.title')}
        subtitle={t('settings.behavior.sub')}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      <div
        id={`${sectionId}-body`}
        role="region"
        aria-labelledby={`${sectionId}-title`}
        hidden={!open}
      >
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
              onChange={(v) => void save({ runtime: { conversationSwitch: v } })}
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
                void save({ security: { autoLockMinutes: Number(v) as 5 | 15 | 60 | 0 } })
              }
            />
          </div>
          {failed && (
            <p role="alert" className="preferences-error">
              {t('prefs.saveFailed')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

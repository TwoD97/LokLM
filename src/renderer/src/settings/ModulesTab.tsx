import { useState } from 'react'
import { isModuleVisible, type AppView } from '@shared/settings'
import { useSettings } from './useSettings'
import { useT } from '../i18n'
import { MODULE_OPTIONS } from './moduleOptions'

export function ModulesTab(): JSX.Element {
  const t = useT()
  const { settings, update } = useSettings()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  if (!settings) return <p>{t('settings.loading')}</p>
  const save = async (patch: unknown): Promise<void> => {
    setSaving(true)
    setFailed(false)
    setMessage('')
    try {
      await update(patch)
      setMessage(t('prefs.saved'))
    } catch {
      setFailed(true)
      setMessage(t('prefs.saveFailed'))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="preferences-modules">
      <h3>{t('prefs.menu')}</h3>
      <p className="preferences-description">{t('prefs.menuHint')}</p>
      <div className="preferences-module-list">
        {MODULE_OPTIONS.filter((module) => module.id !== 'library' && module.id !== 'chat').map(
          ({ id, key, Icon }) => (
            <label className="preferences-module" key={id}>
              <Icon size={20} aria-hidden="true" />
              <span className="preferences-module__copy">
                <strong>{t(key)}</strong>
                <span>{t(`prefs.${id}Hint`)}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={isModuleVisible(settings.basic.modules, id)}
                disabled={saving}
                aria-label={t(key)}
                onChange={(event) =>
                  void save({ basic: { modules: { [id]: event.target.checked } } })
                }
              />
            </label>
          ),
        )}
      </div>
      <p className="preferences-description">{t('prefs.core')}</p>
      <label className="preferences-field">
        <span>{t('prefs.startView')}</span>
        <select
          value={settings.basic.startView ?? 'library'}
          disabled={saving}
          onChange={(event) => void save({ basic: { startView: event.target.value as AppView } })}
        >
          {MODULE_OPTIONS.filter(({ id }) => isModuleVisible(settings.basic.modules, id)).map(
            ({ id, key }) => (
              <option key={id} value={id}>
                {t(key)}
              </option>
            ),
          )}
        </select>
      </label>
      <p className="preferences-description">{t('prefs.startViewHint')}</p>
      <label className="preferences-field">
        <span>{t('prefs.week')}</span>
        <select
          value={settings.basic.weekStartsOn ?? 1}
          disabled={saving}
          onChange={(event) => void save({ basic: { weekStartsOn: Number(event.target.value) } })}
        >
          <option value={1}>{t('prefs.monday')}</option>
          <option value={0}>{t('prefs.sunday')}</option>
        </select>
      </label>
      <p
        className={failed ? 'preferences-error' : 'preferences-save'}
        role={failed ? 'alert' : 'status'}
      >
        {saving ? t('prefs.saving') : message}
      </p>
    </div>
  )
}

import { useT } from '../i18n'
import { refreshSettings, useSettings } from './useSettings'

export function SettingsLoadState(): JSX.Element {
  const t = useT()
  const { loadFailed } = useSettings()
  if (!loadFailed) return <p role="status">{t('settings.loading')}</p>
  return (
    <div className="preferences-error" role="alert">
      <p>{t('settings.loadFailed')}</p>
      <button type="button" onClick={() => void refreshSettings().catch(() => undefined)}>
        {t('common.retry')}
      </button>
    </div>
  )
}

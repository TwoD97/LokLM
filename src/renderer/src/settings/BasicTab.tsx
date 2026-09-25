import { useState } from 'react'
import { Check } from 'lucide-react'
import { useSettings } from './useSettings'
import { Segmented } from './Segmented'
import { useT } from '../i18n'
export function BasicTab(): JSX.Element {
  const t = useT()
  const { settings, update, savedFlash } = useSettings()
  const [error, setError] = useState(false)
  const save = async (patch: unknown): Promise<void> => {
    setError(false)
    try {
      await update(patch)
    } catch {
      setError(true)
    }
  }
  if (!settings) return <div>{t('settings.loading')}</div>

  return (
    <div>
      <div className="settings-section-head">
        <span className="settings-section-head__title">{t('settings.basic.uiLanguage')}</span>
        <span className="settings-section-head__sub">{t('settings.basic.uiLanguageSub')}</span>
      </div>
      <Segmented
        ariaLabel={t('settings.basic.uiLanguage')}
        value={settings.basic.language}
        options={[
          { value: 'de', label: 'Deutsch' },
          { value: 'en', label: 'English' },
        ]}
        onChange={(v) => void save({ basic: { language: v } })}
      />

      <div className="settings-section-head">
        <span className="settings-section-head__title">{t('settings.basic.theme')}</span>
        <span className="settings-section-head__sub">{t('settings.basic.themeSub')}</span>
      </div>
      <Segmented
        ariaLabel={t('settings.basic.theme')}
        value={settings.basic.theme}
        options={[
          { value: 'system', label: t('settings.basic.themeSystem') },
          { value: 'light', label: t('settings.basic.themeLight') },
          { value: 'dark', label: t('settings.basic.themeDark') },
        ]}
        onChange={(v) => void save({ basic: { theme: v } })}
      />

      <div className="settings-section-head">
        <span className="settings-section-head__title">{t('settings.basic.responseLanguage')}</span>
        <span className="settings-section-head__sub">
          {t('settings.basic.responseLanguageSub')}
        </span>
      </div>
      <Segmented
        ariaLabel={t('settings.basic.responseLanguage')}
        value={settings.basic.answerLanguage}
        options={[
          { value: 'auto', label: t('settings.basic.languageAuto') },
          { value: 'de', label: 'Deutsch' },
          { value: 'en', label: 'English' },
        ]}
        onChange={(v) => void save({ basic: { answerLanguage: v } })}
      />

      <div className="settings-section-head">
        <span className="settings-section-head__title">
          {t('settings.basic.pipelineChecklist')}
        </span>
        <span className="settings-section-head__sub">
          {t('settings.basic.pipelineChecklistSub')}
        </span>
      </div>
      <Segmented
        ariaLabel={t('settings.basic.pipelineVisibility')}
        value={settings.basic.showPipelineSteps ? 'on' : 'off'}
        options={[
          { value: 'off', label: t('settings.basic.pipelineCollapse') },
          { value: 'on', label: t('settings.basic.pipelineKeepVisible') },
        ]}
        onChange={(v) => void save({ basic: { showPipelineSteps: v === 'on' } })}
      />

      {error && (
        <p className="preferences-error" role="alert">
          {t('prefs.saveFailed')}
        </p>
      )}
      <div style={{ marginTop: 14 }}>
        <span
          role="status"
          className={`settings-saved-flash ${savedFlash ? 'settings-saved-flash--on' : ''}`}
        >
          {savedFlash && (
            <>
              <Check size={14} aria-hidden="true" /> {t('settings.basic.saved')}
            </>
          )}
        </span>
      </div>
    </div>
  )
}

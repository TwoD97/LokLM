import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useSettings } from './useSettings'
import { Segmented } from './Segmented'
import { useT } from '../i18n'
import type { SystemInfo } from '@shared/documents'

/** `SystemInfo.lastLlmPlan` is typed as `unknown` on the wire because the
 *  underlying `LlmPlan` lives in the main-process module graph. Narrow it
 *  here to just the two fields we surface. */
type LlmPlanSummary = { contextSize?: number; kvCacheType?: string }
function planSummary(value: unknown): LlmPlanSummary {
  if (value && typeof value === 'object') return value as LlmPlanSummary
  return {}
}

export function BasicTab(): JSX.Element {
  const t = useT()
  const { settings, update, savedFlash } = useSettings()
  const [info, setInfo] = useState<SystemInfo | null>(null)

  useEffect(() => {
    void window.api.llm.info().then(setInfo)
  }, [])

  if (!settings) return <div>{t('settings.loading')}</div>

  const plan = planSummary(info?.lastLlmPlan)
  const ollamaActive = settings.advanced.llm.source === 'ollama'

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
        onChange={(v) => void update({ basic: { language: v } })}
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
        onChange={(v) => void update({ basic: { theme: v } })}
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
        onChange={(v) => void update({ basic: { answerLanguage: v } })}
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
        onChange={(v) => void update({ basic: { showPipelineSteps: v === 'on' } })}
      />

      <div className="settings-section-head">
        <span className="settings-section-head__title">
          {t('settings.basic.systemInfo')}{' '}
          {ollamaActive && (
            <span style={{ color: 'var(--fg-3)' }}>· {t('settings.basic.idleTag')}</span>
          )}
        </span>
        <span className="settings-section-head__sub">
          {ollamaActive ? t('settings.basic.systemInfoSubIdle') : t('settings.basic.systemInfoSub')}
        </span>
      </div>
      {info && (
        <div className="settings-stat-grid">
          <div className="settings-stat">
            <span className="settings-stat__label">{t('settings.basic.statTotalRam')}</span>
            <span className="settings-stat__value">{info.totalMemGB} GB</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">{t('settings.basic.statGpu')}</span>
            <span className="settings-stat__value">{info.gpu ?? '—'}</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">{t('settings.basic.statModel')}</span>
            <span className="settings-stat__value">{info.modelName ?? '—'}</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">{t('settings.basic.statContextSize')}</span>
            <span className="settings-stat__value">{plan.contextSize ?? '—'}</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">{t('settings.basic.statKvCache')}</span>
            <span className="settings-stat__value">{plan.kvCacheType ?? '—'}</span>
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <span className={`settings-saved-flash ${savedFlash ? 'settings-saved-flash--on' : ''}`}>
          <Check size={14} aria-hidden="true" /> {t('settings.basic.saved')}
        </span>
      </div>
    </div>
  )
}

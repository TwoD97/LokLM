import { useEffect, useState } from 'react'
import { Check, Plug } from 'lucide-react'
import { useSettings } from './useSettings'
import { Segmented } from './Segmented'
import { useT } from '../i18n'
import type { SystemInfo, LlmProfileChoice } from '@shared/documents'

const PROFILES: { value: LlmProfileChoice; label: string; sub: string }[] = [
  { value: 'auto', label: 'Auto', sub: 'Recommended — picks best fit for your hardware.' },
  { value: 'lite', label: 'Lite', sub: 'Qwen3.5 2B · 8 GB target' },
  { value: 'full', label: 'Full', sub: 'Qwen3.5 4B · 16 GB+ target' },
  { value: 'xl', label: 'XL', sub: 'Qwen3.5 9B · high-end GPU' },
]

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
  const haveGguf = (p: LlmProfileChoice): boolean => {
    if (p === 'auto') return true
    return info?.profiles?.find((x) => x.name === p)?.filename != null
  }

  const plan = planSummary(info?.lastLlmPlan)
  const ollamaActive = settings.advanced.llm.source === 'ollama'

  return (
    <div>
      <div className="settings-section-head">
        <span className="settings-section-head__title">{t('settings.basic.responseLanguage')}</span>
        <span className="settings-section-head__sub">
          {t('settings.basic.responseLanguageSub')}
        </span>
      </div>
      <Segmented
        ariaLabel={t('settings.basic.responseLanguage')}
        value={settings.basic.language}
        options={[
          { value: 'de', label: 'Deutsch' },
          { value: 'en', label: 'English' },
        ]}
        onChange={(v) => void update({ basic: { language: v } })}
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
          {t('settings.basic.modelSize')}{' '}
          {ollamaActive && (
            <span style={{ color: 'var(--fg-3)' }}>· {t('settings.basic.fallbackTag')}</span>
          )}
        </span>
        <span className="settings-section-head__sub">
          {ollamaActive
            ? t('settings.basic.modelSizeSubFallback')
            : t('settings.basic.modelSizeSub')}
        </span>
      </div>
      {ollamaActive && (
        <div className="settings-section__notice">
          <span className="settings-section__notice__icon" aria-hidden="true">
            <Plug size={16} />
          </span>
          <span>{t('settings.basic.ollamaNotice')}</span>
        </div>
      )}
      <div className="settings-model-cards">
        {PROFILES.map((p) => {
          const available = haveGguf(p.value)
          const active = settings.basic.llmProfile === p.value
          return (
            <button
              key={p.value}
              type="button"
              className={`settings-model-card ${active ? 'settings-model-card--active' : ''}`}
              disabled={!available}
              onClick={() => void update({ basic: { llmProfile: p.value } })}
            >
              <div className="settings-model-card__head">
                <span className="settings-model-card__title">{p.label}</span>
                <span
                  className={`settings-model-card__badge ${available ? 'settings-model-card__badge--ok' : 'settings-model-card__badge--missing'}`}
                >
                  {p.value === 'auto'
                    ? t('settings.basic.badgeAuto')
                    : available
                      ? t('settings.basic.badgeAvailable')
                      : t('settings.basic.badgeMissing')}
                </span>
              </div>
              <span className="settings-model-card__sub">{p.sub}</span>
            </button>
          )
        })}
      </div>

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

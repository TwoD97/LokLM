import { SectionHeader } from './SectionHeader'
import { useEffect, useId, useState } from 'react'
import type { SystemInfo } from '@shared/documents'
import { useT, type TFn } from '../../i18n'

/** `SystemInfo.lastLlmPlan` and `SystemInfo.resources` are typed as `unknown`
 *  on the wire because their underlying types live in the main-process module
 *  graph. Narrow them here to just the fields we surface. */
type LlmPlanSummary = { reason?: string; contextSize?: number; kvCacheType?: string }
type ResourcesSummary = { freeVramGB?: number }

function planSummary(value: unknown): LlmPlanSummary | null {
  if (value && typeof value === 'object') return value as LlmPlanSummary
  return null
}
function resourcesSummary(value: unknown): ResourcesSummary | null {
  if (value && typeof value === 'object') return value as ResourcesSummary
  return null
}

export function DiagnosticsSection(): JSX.Element {
  const t = useT()
  const sectionId = useId()
  const [open, setOpen] = useState(true)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open || info) return
    let current = true
    setLoadFailed(false)
    void window.api.llm
      .info()
      .then((value) => {
        if (current) setInfo(value)
      })
      .catch(() => {
        if (current) setLoadFailed(true)
      })
    return () => {
      current = false
    }
  }, [open, info, attempt])

  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <SectionHeader
        id={sectionId}
        title={t('settings.diag.title')}
        subtitle={t('settings.diag.sub')}
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
          {loadFailed ? (
            <p className="preferences-error" role="alert">
              {t('prefs.loadFailed')}{' '}
              <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                {t('prefs.retry')}
              </button>
            </p>
          ) : !info ? (
            <p role="status">{t('settings.loading')}</p>
          ) : (
            <div className="settings-stat-grid">
              {Object.entries(diagRows(info, t)).map(([k, v]) => (
                <div key={k} className="settings-stat">
                  <span className="settings-stat__label">{k}</span>
                  <span className="settings-stat__value">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function diagRows(info: SystemInfo, t: TFn): Record<string, unknown> {
  const plan = planSummary(info.lastLlmPlan)
  const resources = resourcesSummary(info.resources)
  return {
    [t('settings.diag.totalRam')]: info.totalMemGB,
    [t('settings.diag.gpu')]: info.gpu ?? '—',
    [t('settings.diag.activeModel')]: info.modelName ?? '—',
    [t('settings.diag.recommendedProfile')]: info.recommendedProfile,
    [t('settings.diag.freeVram')]: resources?.freeVramGB ?? '—',
    [t('settings.diag.contextSize')]: plan?.contextSize ?? '—',
    [t('settings.diag.kvCacheType')]: plan?.kvCacheType ?? '—',
    [t('settings.diag.planReason')]: plan?.reason ?? '—',
  }
}

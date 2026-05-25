import { useEffect, useState } from 'react'
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
  const [open, setOpen] = useState(true)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  useEffect(() => {
    if (open && !info) void window.api.llm.info().then(setInfo)
  }, [open, info])

  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">{t('settings.diag.title')}</div>
          <div className="settings-group__sub">{t('settings.diag.sub')}</div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && info && (
        <div className="settings-group__body">
          <div className="settings-stat-grid">
            {Object.entries(diagRows(info, t)).map(([k, v]) => (
              <div key={k} className="settings-stat">
                <span className="settings-stat__label">{k}</span>
                <span className="settings-stat__value">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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

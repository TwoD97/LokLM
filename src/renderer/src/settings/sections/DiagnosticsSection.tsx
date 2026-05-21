import { useEffect, useState } from 'react'
import type { SystemInfo } from '@shared/documents'

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
  const [open, setOpen] = useState(true)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  useEffect(() => {
    if (open && !info) void window.api.llm.info().then(setInfo)
  }, [open, info])

  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">Diagnostics</div>
          <div className="settings-group__sub">
            Read-only snapshot of the planner&apos;s most recent decisions.
          </div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && info && (
        <div className="settings-group__body">
          <div className="settings-stat-grid">
            {Object.entries(diagRows(info)).map(([k, v]) => (
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

function diagRows(info: SystemInfo): Record<string, unknown> {
  const plan = planSummary(info.lastLlmPlan)
  const resources = resourcesSummary(info.resources)
  return {
    'Total RAM (GB)': info.totalMemGB,
    GPU: info.gpu ?? '—',
    'Active model': info.modelName ?? '—',
    'Recommended profile': info.recommendedProfile,
    'Free VRAM (GB)': resources?.freeVramGB ?? '—',
    'Context size': plan?.contextSize ?? '—',
    'KV cache type': plan?.kvCacheType ?? '—',
    'Plan reason': plan?.reason ?? '—',
  }
}

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
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  useEffect(() => {
    if (open && !info) void window.api.llm.info().then(setInfo)
  }, [open, info])

  return (
    <div className="settings-group">
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <span>{open ? '▼' : '▶'} Diagnostics</span>
      </div>
      {open && info && (
        <div className="settings-group__body">
          <table style={{ width: '100%', fontSize: 13 }}>
            <tbody>
              {Object.entries(diagRows(info)).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td style={{ textAlign: 'right' }}>{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
    'Bundled model path': info.bundledModelPath,
    'Recommended profile': info.recommendedProfile,
    'Free VRAM (GB)': resources?.freeVramGB ?? '—',
    'Last LLM plan': plan?.reason ?? '—',
    'Context size': plan?.contextSize ?? '—',
    'KV cache type': plan?.kvCacheType ?? '—',
  }
}

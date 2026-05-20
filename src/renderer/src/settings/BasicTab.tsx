import { useEffect, useState } from 'react'
import { useSettings } from './useSettings'
import type { SystemInfo, LlmProfileChoice } from '@shared/documents'

const PROFILES: { value: LlmProfileChoice; label: string }[] = [
  { value: 'auto', label: 'Auto (recommended)' },
  { value: 'lite', label: 'Lite — 8 GB target' },
  { value: 'full', label: 'Full — 16 GB+ target' },
  { value: 'xl', label: 'XL — high-end GPU' },
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
  const { settings, update, savedFlash } = useSettings()
  const [info, setInfo] = useState<SystemInfo | null>(null)

  useEffect(() => {
    void window.api.llm.info().then(setInfo)
  }, [])

  if (!settings) return <div>Loading…</div>
  const haveGguf = (p: LlmProfileChoice): boolean => {
    if (p === 'auto') return true
    return info?.profiles?.find((x) => x.name === p)?.filename != null
  }

  const plan = planSummary(info?.lastLlmPlan)

  return (
    <div>
      <h3>Response language</h3>
      <div className="settings-row" style={{ gap: 16 }}>
        <label>
          <input
            type="radio"
            checked={settings.basic.language === 'de'}
            onChange={() => void update({ basic: { language: 'de' } })}
          />{' '}
          Deutsch
        </label>
        <label>
          <input
            type="radio"
            checked={settings.basic.language === 'en'}
            onChange={() => void update({ basic: { language: 'en' } })}
          />{' '}
          English
        </label>
      </div>

      <h3 style={{ marginTop: 18 }}>Model size</h3>
      {PROFILES.map((p) => (
        <div key={p.value} className="settings-row">
          <label style={{ opacity: haveGguf(p.value) ? 1 : 0.55 }}>
            <input
              type="radio"
              checked={settings.basic.llmProfile === p.value}
              onChange={() => void update({ basic: { llmProfile: p.value } })}
              disabled={!haveGguf(p.value)}
            />{' '}
            {p.label}
          </label>
          {!haveGguf(p.value) && (
            <span style={{ color: '#9fb3cc', fontSize: 12 }}>Download via Models panel.</span>
          )}
        </div>
      ))}

      <h3 style={{ marginTop: 18 }}>System info</h3>
      {info && (
        <table style={{ width: '100%', fontSize: 13 }}>
          <tbody>
            <tr>
              <td>Total RAM</td>
              <td style={{ textAlign: 'right' }}>{info.totalMemGB} GB</td>
            </tr>
            <tr>
              <td>GPU</td>
              <td style={{ textAlign: 'right' }}>{info.gpu ?? '—'}</td>
            </tr>
            <tr>
              <td>Model</td>
              <td style={{ textAlign: 'right' }}>{info.modelName ?? '—'}</td>
            </tr>
            <tr>
              <td>Context size</td>
              <td style={{ textAlign: 'right' }}>{plan.contextSize ?? '—'}</td>
            </tr>
            <tr>
              <td>KV cache</td>
              <td style={{ textAlign: 'right' }}>{plan.kvCacheType ?? '—'}</td>
            </tr>
          </tbody>
        </table>
      )}

      <span className={`settings-saved-flash ${savedFlash ? 'settings-saved-flash--on' : ''}`}>
        ✓ saved
      </span>
    </div>
  )
}

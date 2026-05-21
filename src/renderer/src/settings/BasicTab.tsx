import { useEffect, useState } from 'react'
import { useSettings } from './useSettings'
import { Segmented } from './Segmented'
import type { SystemInfo, LlmProfileChoice } from '@shared/documents'

const PROFILES: { value: LlmProfileChoice; label: string; sub: string }[] = [
  { value: 'auto', label: 'Auto', sub: 'Recommended — picks best fit for your hardware.' },
  { value: 'lite', label: 'Lite', sub: 'Qwen3 4B · 8 GB target' },
  { value: 'full', label: 'Full', sub: 'Qwen3 8B · 16 GB+ target' },
  { value: 'xl', label: 'XL', sub: 'Nemotron 30B-A3B · high-end GPU' },
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
  const ollamaActive = settings.advanced.llm.source === 'ollama'

  return (
    <div>
      <div className="settings-section-head">
        <span className="settings-section-head__title">Response language</span>
        <span className="settings-section-head__sub">How LokLM should reply.</span>
      </div>
      <Segmented
        ariaLabel="Response language"
        value={settings.basic.language}
        options={[
          { value: 'de', label: 'Deutsch' },
          { value: 'en', label: 'English' },
        ]}
        onChange={(v) => void update({ basic: { language: v } })}
      />

      <div className="settings-section-head">
        <span className="settings-section-head__title">
          Model size {ollamaActive && <span style={{ color: 'var(--fg-3)' }}>· fallback</span>}
        </span>
        <span className="settings-section-head__sub">
          {ollamaActive
            ? 'Loads on demand if Ollama becomes unreachable.'
            : 'Which bundled GGUF the local LLM loads.'}
        </span>
      </div>
      {ollamaActive && (
        <div className="settings-section__notice">
          <span className="settings-section__notice__icon" aria-hidden="true">
            🔌
          </span>
          <span>
            External Ollama is the active LLM source. The bundled model isn&apos;t loaded right
            now — it spins up only if Ollama fails. Pick the profile you&apos;d want serving when
            that happens.
          </span>
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
                    ? 'auto'
                    : available
                      ? 'available'
                      : 'download via Models panel'}
                </span>
              </div>
              <span className="settings-model-card__sub">{p.sub}</span>
            </button>
          )
        })}
      </div>

      <div className="settings-section-head">
        <span className="settings-section-head__title">
          System info {ollamaActive && <span style={{ color: 'var(--fg-3)' }}>· idle</span>}
        </span>
        <span className="settings-section-head__sub">
          {ollamaActive
            ? 'Empty until the local model loads. Total RAM and GPU stay live.'
            : 'Live introspection from the planner.'}
        </span>
      </div>
      {info && (
        <div className="settings-stat-grid">
          <div className="settings-stat">
            <span className="settings-stat__label">Total RAM</span>
            <span className="settings-stat__value">{info.totalMemGB} GB</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">GPU</span>
            <span className="settings-stat__value">{info.gpu ?? '—'}</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Model</span>
            <span className="settings-stat__value">{info.modelName ?? '—'}</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Context size</span>
            <span className="settings-stat__value">{plan.contextSize ?? '—'}</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">KV cache</span>
            <span className="settings-stat__value">{plan.kvCacheType ?? '—'}</span>
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <span className={`settings-saved-flash ${savedFlash ? 'settings-saved-flash--on' : ''}`}>
          ✓ saved
        </span>
      </div>
    </div>
  )
}

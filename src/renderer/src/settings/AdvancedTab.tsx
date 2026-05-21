import { useState } from 'react'
import { AlertTriangle, BarChart3, Brain, Check, Plug, Search, type LucideIcon } from 'lucide-react'
import { useSettings } from './useSettings'
import { LlmSection } from './sections/LlmSection'
import { EmbedderSection } from './sections/EmbedderSection'
import { RerankerSection } from './sections/RerankerSection'
import { DiagnosticsSection } from './sections/DiagnosticsSection'
import { OllamaSection } from './OllamaSection'
import { DEFAULT_SETTINGS } from '@shared/settings'

type SubTab = 'llm' | 'retrieval' | 'ollama' | 'diagnostics'

const SUBTABS: { id: SubTab; label: string; Icon: LucideIcon }[] = [
  { id: 'llm', label: 'LLM', Icon: Brain },
  { id: 'retrieval', label: 'Retrieval', Icon: Search },
  { id: 'ollama', label: 'Ollama', Icon: Plug },
  { id: 'diagnostics', label: 'Diagnostics', Icon: BarChart3 },
]

export function AdvancedTab(): JSX.Element {
  const { settings, update, savedFlash } = useSettings()
  const [confirmReset, setConfirmReset] = useState(false)
  const [sub, setSub] = useState<SubTab>('llm')

  if (!settings) return <div>Loading…</div>

  return (
    <div>
      <div className="settings-advanced-banner">
        <span className="settings-advanced-banner__icon" aria-hidden="true">
          <AlertTriangle size={16} />
        </span>
        <span>
          <strong>Advanced settings can break LokLM&apos;s local-first defaults.</strong> Only
          change these if you understand the implications. Use <em>Reset advanced</em> at the bottom
          to restore safe defaults.
        </span>
      </div>

      <div className="settings-subtabs" role="tablist">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={sub === t.id}
            className={`settings-subtab ${sub === t.id ? 'settings-subtab--active' : ''}`}
            onClick={() => setSub(t.id)}
          >
            <span className="settings-subtab__icon" aria-hidden="true">
              <t.Icon size={16} />
            </span>
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'llm' && <LlmSection settings={settings} update={update} />}
      {sub === 'retrieval' && (
        <>
          <EmbedderSection settings={settings} update={update} />
          <RerankerSection settings={settings} update={update} />
        </>
      )}
      {sub === 'ollama' && <OllamaSection settings={settings} update={update} />}
      {sub === 'diagnostics' && <DiagnosticsSection />}

      <div className="settings-reset-row">
        <span className="settings-reset-row__copy">
          Restores every advanced setting to its default. Profile and Basic stay untouched.
        </span>
        {!confirmReset ? (
          <button className="settings-btn--danger" onClick={() => setConfirmReset(true)}>
            Reset advanced
          </button>
        ) : (
          <button
            className="settings-btn--danger-confirm"
            onClick={async () => {
              await update({ advanced: DEFAULT_SETTINGS.advanced })
              setConfirmReset(false)
            }}
          >
            Click again to confirm
          </button>
        )}
        <span className={`settings-saved-flash ${savedFlash ? 'settings-saved-flash--on' : ''}`}>
          <Check size={14} aria-hidden="true" /> saved
        </span>
      </div>
    </div>
  )
}

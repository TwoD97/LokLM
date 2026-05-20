import { useState } from 'react'
import { useSettings } from './useSettings'
import { LlmSection } from './sections/LlmSection'
import { EmbedderSection } from './sections/EmbedderSection'
import { RerankerSection } from './sections/RerankerSection'
import { DiagnosticsSection } from './sections/DiagnosticsSection'
import { OllamaSection } from './OllamaSection'
import { DEFAULT_SETTINGS } from '@shared/settings'

export function AdvancedTab(): JSX.Element {
  const { settings, update, savedFlash } = useSettings()
  const [confirmReset, setConfirmReset] = useState(false)

  if (!settings) return <div>Loading…</div>

  return (
    <div>
      <div className="settings-advanced-banner">
        Advanced settings can break LokLM&apos;s local-first defaults. Only change these if you
        understand the implications. Use <em>Reset advanced</em> at the bottom to restore safe
        defaults.
      </div>

      <LlmSection settings={settings} update={update} />
      <OllamaSection settings={settings} update={update} />
      <EmbedderSection settings={settings} update={update} />
      <RerankerSection settings={settings} update={update} />
      <DiagnosticsSection />

      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)}>Reset advanced to defaults</button>
        ) : (
          <button
            style={{ background: '#7a2a2a', color: '#fff' }}
            onClick={async () => {
              await update({ advanced: DEFAULT_SETTINGS.advanced })
              setConfirmReset(false)
            }}
          >
            Click again to confirm
          </button>
        )}
        <span className={`settings-saved-flash ${savedFlash ? 'settings-saved-flash--on' : ''}`}>
          ✓ saved
        </span>
      </div>
    </div>
  )
}

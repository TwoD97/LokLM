import { useState } from 'react'
import type { UserSettings } from '@shared/settings'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function LlmSection({ settings, update }: Props): JSX.Element {
  const [open, setOpen] = useState(true)
  const a = settings.advanced.llm
  return (
    <div className="settings-group">
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <span>{open ? '▼' : '▶'} LLM source</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <label>Source</label>
            <select
              value={a.source}
              onChange={(e) => void update({ advanced: { llm: { source: e.target.value } } })}
            >
              <option value="bundled">Bundled (local)</option>
              <option value="ollama">External Ollama</option>
            </select>
          </div>
          <div className="settings-row">
            <label>Context size</label>
            <select
              value={a.contextChoice === 'auto' ? 'auto' : String(a.contextChoice)}
              onChange={(e) => {
                const v = e.target.value === 'auto' ? 'auto' : Number(e.target.value)
                void update({ advanced: { llm: { contextChoice: v } } })
              }}
            >
              <option value="auto">Auto</option>
              <option value="4096">4 K</option>
              <option value="8192">8 K</option>
              <option value="16384">16 K</option>
              <option value="32768">32 K</option>
              <option value="65536">64 K</option>
              <option value="131072">128 K</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

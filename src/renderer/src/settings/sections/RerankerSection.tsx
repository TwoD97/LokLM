import { useState } from 'react'
import type { UserSettings } from '@shared/settings'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function RerankerSection({ settings, update }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const a = settings.advanced.reranker
  return (
    <div className="settings-group">
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <span>{open ? '▼' : '▶'} Reranker</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <label>Source</label>
            <select
              value={a.source}
              onChange={(e) => void update({ advanced: { reranker: { source: e.target.value } } })}
            >
              <option value="bundled">Bundled (BGE Reranker v2 M3)</option>
              <option value="ollama" disabled={!settings.advanced.ollama.rerankerModel}>
                External Ollama
              </option>
            </select>
          </div>
          {a.source === 'ollama' && (
            <div
              style={{
                background: '#3a2a08',
                color: '#ffdd80',
                padding: 8,
                borderRadius: 4,
                fontSize: 13,
              }}
            >
              Ollama doesn&apos;t expose dedicated rerankers. Scores come from prompting a chat
              model — slower and less accurate than the bundled cross-encoder.
            </div>
          )}
          <div className="settings-row">
            <label>Placement</label>
            <select
              value={a.placement}
              onChange={(e) =>
                void update({ advanced: { reranker: { placement: e.target.value } } })
              }
            >
              <option value="auto">Auto</option>
              <option value="cpu">CPU</option>
              <option value="gpu">GPU</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

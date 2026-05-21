import { useState } from 'react'
import type { UserSettings } from '@shared/settings'
import { Segmented } from '../Segmented'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function RerankerSection({ settings, update }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const a = settings.advanced.reranker
  const ollamaRerankerModel = settings.advanced.ollama.rerankerModel
  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">Reranker</div>
          <div className="settings-group__sub">
            Re-orders search hits by query relevance before the LLM sees them.
          </div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">Source</span>
              <span className="settings-row__hint">
                Bundled is a real cross-encoder; Ollama prompts a chat model.
              </span>
            </div>
            <Segmented
              ariaLabel="Reranker source"
              value={a.source}
              options={[
                { value: 'bundled', label: 'Bundled' },
                {
                  value: 'ollama',
                  label: 'External Ollama',
                  disabled: !ollamaRerankerModel,
                  hint: ollamaRerankerModel ? undefined : 'Pick an Ollama reranker model first',
                },
              ]}
              onChange={(v) => void update({ advanced: { reranker: { source: v } } })}
            />
          </div>
          {a.source === 'ollama' && (
            <div className="settings-inline-warning">
              <span className="settings-inline-warning__icon" aria-hidden="true">
                ⚠
              </span>
              <span>
                Ollama doesn&apos;t expose dedicated rerankers. Scores come from prompting a chat
                model — slower and less accurate than the bundled cross-encoder.
              </span>
            </div>
          )}
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">Placement</span>
              <span className="settings-row__hint">CPU/GPU compute placement at load time.</span>
            </div>
            <Segmented
              ariaLabel="Reranker placement"
              value={a.placement}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'cpu', label: 'CPU' },
                { value: 'gpu', label: 'GPU' },
              ]}
              onChange={(v) =>
                void update({ advanced: { reranker: { placement: v } } })
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

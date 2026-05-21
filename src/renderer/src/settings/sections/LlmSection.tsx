import { useState } from 'react'
import type { UserSettings } from '@shared/settings'
import { Segmented } from '../Segmented'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

const CTX_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '4096', label: '4 K' },
  { value: '8192', label: '8 K' },
  { value: '16384', label: '16 K' },
  { value: '32768', label: '32 K' },
  { value: '65536', label: '64 K' },
  { value: '131072', label: '128 K' },
]

export function LlmSection({ settings, update }: Props): JSX.Element {
  const [open, setOpen] = useState(true)
  const a = settings.advanced.llm
  const hasOllama = Boolean(
    settings.advanced.ollama.baseUrl && settings.advanced.ollama.llmModel,
  )
  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">LLM source</div>
          <div className="settings-group__sub">
            Where chat answers and titles are generated from.
          </div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">Source</span>
              <span className="settings-row__hint">Bundled is the safe local default.</span>
            </div>
            <Segmented
              ariaLabel="LLM source"
              value={a.source}
              options={[
                { value: 'bundled', label: 'Bundled' },
                {
                  value: 'ollama',
                  label: 'External Ollama',
                  disabled: !hasOllama,
                  hint: hasOllama ? undefined : 'Configure Ollama first',
                },
              ]}
              onChange={(v) => void update({ advanced: { llm: { source: v } } })}
            />
          </div>
          <div className="settings-block">
            <div className="settings-block__head">
              <div className="settings-block__head-text">
                <span className="settings-block__label">Context size</span>
                <span className="settings-block__hint">
                  Auto sizes against free VRAM. Override only if you know your budget.
                </span>
              </div>
            </div>
            <Segmented
              ariaLabel="Context size"
              value={a.contextChoice === 'auto' ? 'auto' : String(a.contextChoice)}
              options={CTX_OPTIONS}
              onChange={(v) => {
                const next = v === 'auto' ? 'auto' : Number(v)
                void update({ advanced: { llm: { contextChoice: next } } })
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

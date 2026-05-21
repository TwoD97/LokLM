import { useState } from 'react'
import type { UserSettings } from '@shared/settings'
import { ReindexGateModal } from '../ReindexGateModal'
import { Segmented } from '../Segmented'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function EmbedderSection({ settings, update }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [gate, setGate] = useState<{
    from: string
    to: string
    targetSource: 'bundled' | 'ollama'
  } | null>(null)
  const a = settings.advanced.embedder
  const ollamaEmbedderModel = settings.advanced.ollama.embedderModel

  const startSwitch = (next: 'bundled' | 'ollama'): void => {
    if (next === a.source) return
    const fromId =
      a.source === 'ollama' ? `ollama:${ollamaEmbedderModel ?? '?'}` : 'bundled:bge-m3'
    const toId = next === 'ollama' ? `ollama:${ollamaEmbedderModel ?? '?'}` : 'bundled:bge-m3'
    setGate({ from: fromId, to: toId, targetSource: next })
  }

  const confirm = async (): Promise<void> => {
    if (!gate) return
    const res = await window.api.embedder.trySwitchSource(gate.targetSource)
    if (!res.ok) {
      const msg = 'message' in res ? `: ${res.message}` : ''
      throw new Error(`Probe failed (${res.kind})${msg}`)
    }
    const wss = await window.api.workspaces.list()
    for (const w of wss) await window.api.embedder.runBackfill(w.id)
    setGate(null)
  }

  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">Embedder</div>
          <div className="settings-group__sub">
            Produces the vectors search runs against. Switching forces a re-index.
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
                Re-index modal will open when you change this.
              </span>
            </div>
            <Segmented
              ariaLabel="Embedder source"
              value={a.source}
              options={[
                { value: 'bundled', label: 'Bundled (BGE-M3)' },
                {
                  value: 'ollama',
                  label: 'External Ollama',
                  disabled: !ollamaEmbedderModel,
                  hint: ollamaEmbedderModel ? undefined : 'Pick an Ollama embedder model first',
                },
              ]}
              onChange={(v) => startSwitch(v)}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">Placement</span>
              <span className="settings-row__hint">CPU/GPU compute placement at load time.</span>
            </div>
            <Segmented
              ariaLabel="Embedder placement"
              value={a.placement}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'cpu', label: 'CPU' },
                { value: 'gpu', label: 'GPU' },
              ]}
              onChange={(v) =>
                void update({ advanced: { embedder: { placement: v } } })
              }
            />
          </div>
        </div>
      )}
      <ReindexGateModal
        open={gate !== null}
        fromIdentity={gate?.from ?? ''}
        toIdentity={gate?.to ?? ''}
        onConfirm={confirm}
        onCancel={() => setGate(null)}
      />
    </div>
  )
}

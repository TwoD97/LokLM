import { useState } from 'react'
import type { UserSettings } from '@shared/settings'
import { ReindexGateModal } from '../ReindexGateModal'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function EmbedderSection({ settings, update }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [gate, setGate] = useState<{
    from: string
    to: string
    targetSource: 'bundled' | 'ollama'
  } | null>(null)
  const a = settings.advanced.embedder

  const startSwitch = (next: 'bundled' | 'ollama'): void => {
    if (next === a.source) return
    const fromId =
      a.source === 'ollama'
        ? `ollama:${settings.advanced.ollama.embedderModel ?? '?'}`
        : 'bundled:bge-m3'
    const toId =
      next === 'ollama'
        ? `ollama:${settings.advanced.ollama.embedderModel ?? '?'}`
        : 'bundled:bge-m3'
    setGate({ from: fromId, to: toId, targetSource: next })
  }

  const confirm = async (): Promise<void> => {
    if (!gate) return
    const res = await window.api.embedder.trySwitchSource(gate.targetSource)
    if (!res.ok) {
      const msg = 'message' in res ? `: ${res.message}` : ''
      throw new Error(`Probe failed (${res.kind})${msg}`)
    }
    // Setting already updated server-side. Now kick the backfill across all workspaces:
    const wss = await window.api.workspaces.list()
    for (const w of wss) await window.api.embedder.runBackfill(w.id)
    setGate(null)
  }

  return (
    <div className="settings-group">
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <span>{open ? '▼' : '▶'} Embedder</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <label>Source</label>
            <select
              value={a.source}
              onChange={(e) => startSwitch(e.target.value as 'bundled' | 'ollama')}
            >
              <option value="bundled">Bundled (BGE-M3)</option>
              <option value="ollama" disabled={!settings.advanced.ollama.embedderModel}>
                External Ollama
              </option>
            </select>
          </div>
          <div className="settings-row">
            <label>Placement</label>
            <select
              value={a.placement}
              onChange={(e) =>
                void update({ advanced: { embedder: { placement: e.target.value } } })
              }
            >
              <option value="auto">Auto</option>
              <option value="cpu">CPU</option>
              <option value="gpu">GPU</option>
            </select>
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

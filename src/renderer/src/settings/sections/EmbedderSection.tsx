import { useState } from 'react'
import type { UserSettings } from '@shared/settings'
import { ReindexGateModal } from '../ReindexGateModal'
import { Segmented } from '../Segmented'
import { useT } from '../../i18n'

// `update` stays in the props shape (the Settings panel passes the same shape to
// every section) but the embedder no longer has a directly-updated control here
// — source switching goes through the re-index gate.
type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function EmbedderSection({ settings }: Props): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(true)
  const [gate, setGate] = useState<{
    from: string
    to: string
    targetSource: 'bundled' | 'ollama'
  } | null>(null)
  const a = settings.advanced.embedder
  const ollamaEmbedderModel = settings.advanced.ollama.embedderModel

  const startSwitch = (next: 'bundled' | 'ollama'): void => {
    if (next === a.source) return
    const fromId = a.source === 'ollama' ? `ollama:${ollamaEmbedderModel ?? '?'}` : 'bundled:bge-m3'
    const toId = next === 'ollama' ? `ollama:${ollamaEmbedderModel ?? '?'}` : 'bundled:bge-m3'
    setGate({ from: fromId, to: toId, targetSource: next })
  }

  const confirm = async (): Promise<void> => {
    if (!gate) return
    const res = await window.api.embedder.trySwitchSource(gate.targetSource)
    if (!res.ok) {
      const msg = 'message' in res ? `: ${res.message}` : ''
      throw new Error(t('settings.embedder.probeFailed', { kind: res.kind, msg }))
    }
    const wss = await window.api.workspaces.list()
    for (const w of wss) await window.api.embedder.runBackfill(w.id)
    setGate(null)
  }

  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">{t('settings.embedder.title')}</div>
          <div className="settings-group__sub">{t('settings.embedder.sub')}</div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.embedder.source')}</span>
              <span className="settings-row__hint">{t('settings.embedder.sourceHint')}</span>
            </div>
            <Segmented
              ariaLabel={t('settings.embedder.sourceAria')}
              value={a.source}
              options={[
                { value: 'bundled', label: t('settings.embedder.bundled') },
                {
                  value: 'ollama',
                  label: t('settings.embedder.externalOllama'),
                  disabled: !ollamaEmbedderModel,
                  hint: ollamaEmbedderModel ? undefined : t('settings.embedder.pickModelFirst'),
                },
              ]}
              onChange={(v) => startSwitch(v)}
            />
          </div>
          {/* The embedder rides the LLM's primary GPU backend (one shared device),
              so it has no independent compute-device control — the LLM's
              Auto/Dedicated/Integrated choice governs it. */}
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

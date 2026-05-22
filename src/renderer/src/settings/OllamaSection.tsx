import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Globe } from 'lucide-react'
import type { UserSettings } from '@shared/settings'
import { isLoopbackBaseUrl } from '@shared/networkHelpers'
import { Segmented } from './Segmented'
import { ReindexGateModal } from './ReindexGateModal'
import { PasswordRetypeGate } from '../auth/PasswordRetypeGate'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }
type Probe =
  | { state: 'idle' }
  | { state: 'probing' }
  | { state: 'ok'; version: string; models: string[] }
  | { state: 'err'; kind: string; message: string }

const EMBED_NAME_RE = /(nomic-embed|mxbai-embed|bge|embed)/i

const TIMEOUT_PRESETS = [
  { value: '15000', label: '15s' },
  { value: '30000', label: '30s' },
  { value: '60000', label: '60s' },
  { value: '120000', label: '2m' },
  { value: '300000', label: '5m' },
]

export function OllamaSection({ settings, update }: Props): JSX.Element {
  const [open, setOpen] = useState(true)
  const [probe, setProbe] = useState<Probe>({ state: 'idle' })
  const [showAllForEmbedder, setShowAllForEmbedder] = useState(false)
  // Local copies of the text inputs so each keystroke doesn't fire the whole
  // settings round-trip (which triggers applySettings on the main side,
  // unloading providers etc.). We commit to the settings store on blur ,
  // which already runs the probe.
  const [baseUrlDraft, setBaseUrlDraft] = useState(settings.advanced.ollama.baseUrl)
  const [bearerTokenDraft, setBearerTokenDraft] = useState(
    settings.advanced.ollama.bearerToken ?? '',
  )
  // Re-sync local drafts when settings change underneath us (e.g. another
  // tab edited them, or DEFAULTS got applied).
  useEffect(() => {
    setBaseUrlDraft(settings.advanced.ollama.baseUrl)
  }, [settings.advanced.ollama.baseUrl])
  useEffect(() => {
    setBearerTokenDraft(settings.advanced.ollama.bearerToken ?? '')
  }, [settings.advanced.ollama.bearerToken])
  // Master-switch gate: opens the ReindexGateModal when the user flips ALL
  // three sources at once. The embedder leg of the flip is the part that
  // demands the gate (changing embedding model invalidates existing vectors),
  // so the modal copy keeps using the embedder-identity strings.
  const [masterGate, setMasterGate] = useState<{
    from: string
    to: string
    targetSource: 'bundled' | 'ollama'
  } | null>(null)
  // Loopback gate. Open when the user types a non-loopback baseUrl while
  // allowRemoteOllama is still false. Confirming flips the setting once and
  // re-runs the probe ; cancelling leaves the baseUrl as-typed but no probe
  // fires until the gate is satisfied.
  const [remoteGateOpen, setRemoteGateOpen] = useState(false)
  const o = settings.advanced.ollama
  const adv = settings.advanced
  const allModelsConfigured = Boolean(o.baseUrl && o.llmModel && o.embedderModel && o.rerankerModel)
  const baseIsLoopback = isLoopbackBaseUrl(o.baseUrl)
  const blockedByRemoteGate = !baseIsLoopback && !o.allowRemoteOllama
  const allOnOllama =
    adv.llm.source === 'ollama' &&
    adv.embedder.source === 'ollama' &&
    adv.reranker.source === 'ollama'

  const startMasterSwitch = (next: 'bundled' | 'ollama'): void => {
    if (next === (allOnOllama ? 'ollama' : 'bundled')) return
    const fromId =
      adv.embedder.source === 'ollama' ? `ollama:${o.embedderModel ?? '?'}` : 'bundled:bge-m3'
    const toId = next === 'ollama' ? `ollama:${o.embedderModel ?? '?'}` : 'bundled:bge-m3'
    setMasterGate({ from: fromId, to: toId, targetSource: next })
  }

  const confirmMaster = async (): Promise<void> => {
    if (!masterGate) return
    // Embedder goes first — trySwitchSource probes + dim-checks before
    // committing, so if Ollama is misconfigured we bail before flipping the
    // LLM and reranker. (Errors bubble up to the modal's error banner.)
    const res = await window.api.embedder.trySwitchSource(masterGate.targetSource)
    if (!res.ok) {
      const msg = 'message' in res ? `: ${res.message}` : ''
      throw new Error(`Probe failed (${res.kind})${msg}`)
    }
    // Embedder is now on the target source — flip LLM + reranker together via
    // settings:update so applySettings re-broadcasts both dots and unloads
    // the bundled GGUFs whose source just changed.
    await update({
      advanced: {
        llm: { source: masterGate.targetSource },
        reranker: { source: masterGate.targetSource },
      },
    })
    // Re-embed pending chunks against the new embedder identity.
    const wss = await window.api.workspaces.list()
    for (const w of wss) await window.api.embedder.runBackfill(w.id)
    setMasterGate(null)
  }

  const doProbe = useCallback(async () => {
    // Loopback gate: never roundtrip to a non-loopback host until the user
    // has acknowledged the offline-grundsatz relaxation via the retype gate.
    // Surface the block as a probe-state so the rest of the UI (chip pickers ,
    // master-switch) stays disabled.
    if (blockedByRemoteGate) {
      setProbe({
        state: 'err',
        kind: 'remote-gate',
        message: 'Externer Host nicht freigegeben.',
      })
      return
    }
    setProbe({ state: 'probing' })
    const r = await window.api.ollama.probe({
      baseUrl: o.baseUrl,
      bearerToken: o.bearerToken,
      timeoutMs: o.requestTimeoutMs,
    })
    if (r.ok) setProbe({ state: 'ok', version: r.version, models: r.models })
    else setProbe({ state: 'err', kind: r.kind, message: r.message })
  }, [o.baseUrl, o.bearerToken, o.requestTimeoutMs, blockedByRemoteGate])

  useEffect(() => {
    if (open && probe.state === 'idle') void doProbe()
  }, [open, probe.state, doProbe])

  // Re-probe whenever the gate state flips , so a freshly-confirmed remote
  // host probes immediately instead of waiting for the next user interaction.
  useEffect(() => {
    if (open) void doProbe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockedByRemoteGate])

  const models = probe.state === 'ok' ? probe.models : []
  const embedderModels = showAllForEmbedder ? models : models.filter((m) => EMBED_NAME_RE.test(m))
  const hiddenEmbedderCount = models.length - embedderModels.length

  const timeoutValue = String(o.requestTimeoutMs)
  const isCustomTimeout = !TIMEOUT_PRESETS.some((p) => p.value === timeoutValue)

  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <div className="settings-group__header" onClick={() => setOpen((s) => !s)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">External Ollama</div>
          <div className="settings-group__sub">
            Power-user opt-in. Connection + model selection for an Ollama HTTP endpoint.
          </div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-block">
            <div className="settings-block__head">
              <div className="settings-block__head-text">
                <span className="settings-block__label">Base URL</span>
                <span className="settings-block__hint">
                  Probes <code>/api/version</code> on blur. Supports proxies (https + bearer).
                </span>
              </div>
            </div>
            <input
              type="text"
              value={baseUrlDraft}
              onChange={(e) => setBaseUrlDraft(e.target.value)}
              onBlur={() => {
                if (baseUrlDraft !== o.baseUrl) {
                  // Reset the remote-host consent on every baseUrl change.
                  // Otherwise a user who once allowed remote-A could swap to
                  // remote-B and silently inherit the prior consent ; each
                  // host has to be re-confirmed independently.
                  void update({
                    advanced: {
                      ollama: { baseUrl: baseUrlDraft, allowRemoteOllama: false },
                    },
                  })
                }
                void doProbe()
              }}
              style={{ width: '100%' }}
            />
          </div>

          <div className="settings-block">
            <div className="settings-block__head">
              <div className="settings-block__head-text">
                <span className="settings-block__label">Bearer token</span>
                <span className="settings-block__hint">
                  Optional. Stored in the encrypted snapshot.
                </span>
              </div>
            </div>
            <input
              type="password"
              value={bearerTokenDraft}
              onChange={(e) => setBearerTokenDraft(e.target.value)}
              onBlur={() => {
                const next = bearerTokenDraft || null
                if (next !== (o.bearerToken ?? null)) {
                  void update({ advanced: { ollama: { bearerToken: next } } })
                }
                void doProbe()
              }}
              placeholder="(optional)"
              style={{ width: '100%' }}
            />
          </div>

          {!baseIsLoopback && o.allowRemoteOllama && (
            <div
              className="settings-probe settings-probe--ok"
              style={{ background: 'rgba(255,170,60,0.12)', color: '#ffd28a' }}
              title="Anfragen verlassen diesen Rechner. Lastenheft-Grundsatz (offline) ist hierfür ausgesetzt."
            >
              <Globe size={14} aria-hidden="true" />
              Externer Host , Daten verlassen diesen Rechner
            </div>
          )}
          {probe.state === 'probing' && (
            <div className="settings-probe settings-probe--probing">
              <span className="settings-probe__dot" aria-hidden="true" />
              Probing…
            </div>
          )}
          {probe.state === 'ok' && (
            <div className="settings-probe settings-probe--ok">
              <span className="settings-probe__dot" aria-hidden="true" />
              Connected · Ollama v{probe.version} · {probe.models.length} model
              {probe.models.length === 1 ? '' : 's'}
            </div>
          )}
          {probe.state === 'err' && probe.kind === 'remote-gate' && (
            <div className="settings-probe settings-probe--err">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>Externer Host blockiert. Verbindung erst nach Passwort-Bestätigung.</span>
              <button className="settings-probe__retry" onClick={() => setRemoteGateOpen(true)}>
                Externen Host erlauben…
              </button>
            </div>
          )}
          {probe.state === 'err' && probe.kind !== 'remote-gate' && (
            <div className="settings-probe settings-probe--err">
              <span className="settings-probe__dot" aria-hidden="true" />
              <span>
                Failed: {probe.kind} — {probe.message}
              </span>
              <button className="settings-probe__retry" onClick={() => void doProbe()}>
                Retry
              </button>
            </div>
          )}

          {probe.state === 'ok' && (
            <>
              <ChipPicker
                label="LLM model"
                hint="Used for chat answers, titles, and contextualization."
                models={models}
                value={o.llmModel}
                onChange={(v) => void update({ advanced: { ollama: { llmModel: v } } })}
              />

              <ChipPicker
                label="Embedder model"
                hint="Filtered to names matching embed-style patterns."
                models={embedderModels}
                value={o.embedderModel}
                onChange={(v) => void update({ advanced: { ollama: { embedderModel: v } } })}
                trailing={
                  !showAllForEmbedder && hiddenEmbedderCount > 0 ? (
                    <button
                      className="settings-block__inline-btn"
                      onClick={() => setShowAllForEmbedder(true)}
                    >
                      show all ({hiddenEmbedderCount} more)
                    </button>
                  ) : null
                }
              />

              <ChipPicker
                label={
                  <>
                    Reranker model{' '}
                    <AlertTriangle
                      size={14}
                      aria-hidden="true"
                      style={{ verticalAlign: 'text-bottom' }}
                    />
                  </>
                }
                ariaLabel="Reranker model"
                hint="Ollama has no dedicated reranker — any chat model works (slower)."
                models={models}
                value={o.rerankerModel}
                onChange={(v) => void update({ advanced: { ollama: { rerankerModel: v } } })}
              />

              <div className="settings-row">
                <div className="settings-row__label">
                  <span className="settings-row__label-text">Use Ollama for everything</span>
                  <span className="settings-row__hint">
                    {allModelsConfigured
                      ? 'Routes LLM, embedding, and reranking through this server. Flips all three sources at once — the per-section toggles below still work if you want to mix-and-match.'
                      : 'Pick a model for LLM, Embedder, and Reranker above to enable this switch.'}
                  </span>
                </div>
                <Segmented
                  ariaLabel="Use Ollama for everything"
                  value={allOnOllama ? 'ollama' : 'bundled'}
                  options={[
                    { value: 'bundled', label: 'Bundled (local)' },
                    {
                      value: 'ollama',
                      label: 'External Ollama',
                      disabled: !allModelsConfigured,
                      hint: allModelsConfigured ? undefined : 'Pick all three Ollama models first',
                    },
                  ]}
                  onChange={(v) => startMasterSwitch(v)}
                />
              </div>

              <div className="settings-block">
                <div className="settings-block__head">
                  <div className="settings-block__head-text">
                    <span className="settings-block__label">Request timeout</span>
                    <span className="settings-block__hint">
                      Bound on the request-start latency. The stream itself can take as long as the
                      model needs.
                    </span>
                  </div>
                </div>
                <Segmented
                  ariaLabel="Request timeout"
                  value={isCustomTimeout ? 'custom' : timeoutValue}
                  options={[
                    ...TIMEOUT_PRESETS,
                    ...(isCustomTimeout
                      ? [{ value: 'custom', label: `${Math.round(o.requestTimeoutMs / 1000)}s` }]
                      : []),
                  ]}
                  onChange={(v) => {
                    if (v === 'custom') return
                    void update({ advanced: { ollama: { requestTimeoutMs: Number(v) } } })
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}
      <ReindexGateModal
        open={masterGate !== null}
        fromIdentity={masterGate?.from ?? ''}
        toIdentity={masterGate?.to ?? ''}
        onConfirm={confirmMaster}
        onCancel={() => setMasterGate(null)}
      />
      <PasswordRetypeGate
        open={remoteGateOpen}
        title="Externer Ollama-Host"
        body={`"${o.baseUrl}" liegt außerhalb des lokalen Rechners. Daten verlassen damit das System. Passwort zur Bestätigung eingeben — die Freigabe gilt persistent , bis die URL wieder auf Loopback zurückgesetzt wird.`}
        confirmLabel="Erlauben"
        onCancel={() => setRemoteGateOpen(false)}
        onConfirm={async () => {
          await update({ advanced: { ollama: { allowRemoteOllama: true } } })
          setRemoteGateOpen(false)
        }}
      />
    </div>
  )
}

function ChipPicker({
  label,
  ariaLabel,
  hint,
  models,
  value,
  onChange,
  trailing,
}: {
  label: React.ReactNode
  ariaLabel?: string
  hint: string
  models: string[]
  value: string | null
  onChange: (next: string | null) => void
  trailing?: React.ReactNode
}): JSX.Element {
  const groupLabel = ariaLabel ?? (typeof label === 'string' ? label : undefined)
  return (
    <div className="settings-block">
      <div className="settings-block__head">
        <div className="settings-block__head-text">
          <span className="settings-block__label">{label}</span>
          <span className="settings-block__hint">{hint}</span>
        </div>
        {trailing}
      </div>
      {models.length === 0 ? (
        <div className="settings-chip-group settings-chip-group--empty">
          No matching models on this Ollama server.
        </div>
      ) : (
        <div className="settings-chip-group" role="radiogroup" aria-label={groupLabel}>
          {models.map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={m === value}
              className={`settings-chip ${m === value ? 'settings-chip--active' : ''}`}
              onClick={() => onChange(m === value ? null : m)}
              title={m === value ? 'Click to clear' : `Pick ${m}`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

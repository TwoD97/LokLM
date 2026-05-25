import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Globe } from 'lucide-react'
import type { UserSettings } from '@shared/settings'
import { isLoopbackBaseUrl } from '@shared/networkHelpers'
import { Segmented } from './Segmented'
import { ReindexGateModal } from './ReindexGateModal'
import { PasswordRetypeGate } from '../auth/PasswordRetypeGate'
import { useT, type TFn } from '../i18n'

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
  const t = useT()
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
        message: t('settings.ollama.remoteGateMessage'),
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
  }, [o.baseUrl, o.bearerToken, o.requestTimeoutMs, blockedByRemoteGate, t])

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
          <div className="settings-group__title-row">{t('settings.ollama.title')}</div>
          <div className="settings-group__sub">{t('settings.ollama.sub')}</div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-block">
            <div className="settings-block__head">
              <div className="settings-block__head-text">
                <span className="settings-block__label">{t('settings.ollama.baseUrl')}</span>
                <span className="settings-block__hint">
                  {t('settings.ollama.baseUrlHintPre')} <code>/api/version</code>{' '}
                  {t('settings.ollama.baseUrlHintPost')}
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
                <span className="settings-block__label">{t('settings.ollama.bearerToken')}</span>
                <span className="settings-block__hint">{t('settings.ollama.bearerTokenHint')}</span>
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
              placeholder={t('settings.ollama.bearerTokenPlaceholder')}
              style={{ width: '100%' }}
            />
          </div>

          {!baseIsLoopback && o.allowRemoteOllama && (
            <div
              className="settings-probe settings-probe--ok"
              style={{ background: 'rgba(255,170,60,0.12)', color: '#ffd28a' }}
              title={t('settings.ollama.remoteHostWarningTitle')}
            >
              <Globe size={14} aria-hidden="true" />
              {t('settings.ollama.remoteHostWarning')}
            </div>
          )}
          {probe.state === 'probing' && (
            <div className="settings-probe settings-probe--probing">
              <span className="settings-probe__dot" aria-hidden="true" />
              {t('settings.ollama.probing')}
            </div>
          )}
          {probe.state === 'ok' && (
            <div className="settings-probe settings-probe--ok">
              <span className="settings-probe__dot" aria-hidden="true" />
              {t(
                probe.models.length === 1
                  ? 'settings.ollama.connected'
                  : 'settings.ollama.connectedPlural',
                { version: probe.version, count: probe.models.length },
              )}
            </div>
          )}
          {probe.state === 'err' && probe.kind === 'remote-gate' && (
            <div className="settings-probe settings-probe--err">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{t('settings.ollama.remoteGateBlocked')}</span>
              <button className="settings-probe__retry" onClick={() => setRemoteGateOpen(true)}>
                {t('settings.ollama.allowRemoteHost')}
              </button>
            </div>
          )}
          {probe.state === 'err' && probe.kind !== 'remote-gate' && (
            <div className="settings-probe settings-probe--err">
              <span className="settings-probe__dot" aria-hidden="true" />
              <span>
                {t('settings.ollama.probeFailed', { kind: probe.kind, message: probe.message })}
              </span>
              <button className="settings-probe__retry" onClick={() => void doProbe()}>
                {t('common.retry')}
              </button>
            </div>
          )}

          {probe.state === 'ok' && (
            <>
              <ChipPicker
                t={t}
                label={t('settings.ollama.llmModel')}
                hint={t('settings.ollama.llmModelHint')}
                models={models}
                value={o.llmModel}
                onChange={(v) => void update({ advanced: { ollama: { llmModel: v } } })}
              />

              <ChipPicker
                t={t}
                label={t('settings.ollama.embedderModel')}
                hint={t('settings.ollama.embedderModelHint')}
                models={embedderModels}
                value={o.embedderModel}
                onChange={(v) => void update({ advanced: { ollama: { embedderModel: v } } })}
                trailing={
                  !showAllForEmbedder && hiddenEmbedderCount > 0 ? (
                    <button
                      className="settings-block__inline-btn"
                      onClick={() => setShowAllForEmbedder(true)}
                    >
                      {t('settings.ollama.showAll', { count: hiddenEmbedderCount })}
                    </button>
                  ) : null
                }
              />

              <ChipPicker
                t={t}
                label={
                  <>
                    {t('settings.ollama.rerankerModel')}{' '}
                    <AlertTriangle
                      size={14}
                      aria-hidden="true"
                      style={{ verticalAlign: 'text-bottom' }}
                    />
                  </>
                }
                ariaLabel={t('settings.ollama.rerankerModel')}
                hint={t('settings.ollama.rerankerModelHint')}
                models={models}
                value={o.rerankerModel}
                onChange={(v) => void update({ advanced: { ollama: { rerankerModel: v } } })}
              />

              <div className="settings-row">
                <div className="settings-row__label">
                  <span className="settings-row__label-text">
                    {t('settings.ollama.useForEverything')}
                  </span>
                  <span className="settings-row__hint">
                    {allModelsConfigured
                      ? t('settings.ollama.useForEverythingHintReady')
                      : t('settings.ollama.useForEverythingHintNotReady')}
                  </span>
                </div>
                <Segmented
                  ariaLabel={t('settings.ollama.useForEverything')}
                  value={allOnOllama ? 'ollama' : 'bundled'}
                  options={[
                    { value: 'bundled', label: t('settings.ollama.bundledLocal') },
                    {
                      value: 'ollama',
                      label: t('settings.ollama.external'),
                      disabled: !allModelsConfigured,
                      hint: allModelsConfigured ? undefined : t('settings.ollama.pickAllThree'),
                    },
                  ]}
                  onChange={(v) => startMasterSwitch(v)}
                />
              </div>

              <div className="settings-block">
                <div className="settings-block__head">
                  <div className="settings-block__head-text">
                    <span className="settings-block__label">
                      {t('settings.ollama.requestTimeout')}
                    </span>
                    <span className="settings-block__hint">
                      {t('settings.ollama.requestTimeoutHint')}
                    </span>
                  </div>
                </div>
                <Segmented
                  ariaLabel={t('settings.ollama.requestTimeout')}
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
        title={t('settings.ollama.remoteGateTitle')}
        body={t('settings.ollama.remoteGateBody', { url: o.baseUrl })}
        confirmLabel={t('settings.ollama.allow')}
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
  t,
  label,
  ariaLabel,
  hint,
  models,
  value,
  onChange,
  trailing,
}: {
  t: TFn
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
          {t('settings.ollama.noMatchingModels')}
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
              title={
                m === value
                  ? t('settings.ollama.clickToClear')
                  : t('settings.ollama.pickModel', { model: m })
              }
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

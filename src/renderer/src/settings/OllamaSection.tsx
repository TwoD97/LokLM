import { useCallback, useEffect, useState } from 'react'
import type { UserSettings } from '@shared/settings'
import { Segmented } from './Segmented'

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
  const o = settings.advanced.ollama

  const doProbe = useCallback(async () => {
    setProbe({ state: 'probing' })
    const r = await window.api.ollama.probe({
      baseUrl: o.baseUrl,
      bearerToken: o.bearerToken,
      timeoutMs: o.requestTimeoutMs,
    })
    if (r.ok) setProbe({ state: 'ok', version: r.version, models: r.models })
    else setProbe({ state: 'err', kind: r.kind, message: r.message })
  }, [o.baseUrl, o.bearerToken, o.requestTimeoutMs])

  useEffect(() => {
    if (open && probe.state === 'idle') void doProbe()
  }, [open, probe.state, doProbe])

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
              value={o.baseUrl}
              onChange={(e) => void update({ advanced: { ollama: { baseUrl: e.target.value } } })}
              onBlur={() => void doProbe()}
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
              value={o.bearerToken ?? ''}
              onChange={(e) =>
                void update({ advanced: { ollama: { bearerToken: e.target.value || null } } })
              }
              onBlur={() => void doProbe()}
              placeholder="(optional)"
              style={{ width: '100%' }}
            />
          </div>

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
          {probe.state === 'err' && (
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
                label="Reranker model ⚠"
                hint="Ollama has no dedicated reranker — any chat model works (slower)."
                models={models}
                value={o.rerankerModel}
                onChange={(v) => void update({ advanced: { ollama: { rerankerModel: v } } })}
              />

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
    </div>
  )
}

function ChipPicker({
  label,
  hint,
  models,
  value,
  onChange,
  trailing,
}: {
  label: string
  hint: string
  models: string[]
  value: string | null
  onChange: (next: string | null) => void
  trailing?: React.ReactNode
}): JSX.Element {
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
        <div className="settings-chip-group" role="radiogroup" aria-label={label}>
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

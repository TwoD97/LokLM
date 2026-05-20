import { useCallback, useEffect, useState } from 'react'
import type { UserSettings } from '@shared/settings'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }
type Probe =
  | { state: 'idle' }
  | { state: 'probing' }
  | { state: 'ok'; version: string; models: string[] }
  | { state: 'err'; kind: string; message: string }

const EMBED_NAME_RE = /(nomic-embed|mxbai-embed|bge|embed)/i

export function OllamaSection({ settings, update }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
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

  return (
    <div className="settings-group">
      <div className="settings-group__header" onClick={() => setOpen((s) => !s)}>
        <span>{open ? '▼' : '▶'} External Ollama</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <label>Base URL</label>
            <input
              value={o.baseUrl}
              onChange={(e) => void update({ advanced: { ollama: { baseUrl: e.target.value } } })}
              onBlur={() => void doProbe()}
              style={{
                padding: '4px 8px',
                minWidth: 320,
                background: '#0f1a2a',
                color: 'inherit',
                border: '1px solid #243a55',
                borderRadius: 4,
              }}
            />
          </div>
          <div className="settings-row">
            <label>Bearer token</label>
            <input
              type="password"
              value={o.bearerToken ?? ''}
              onChange={(e) =>
                void update({ advanced: { ollama: { bearerToken: e.target.value || null } } })
              }
              onBlur={() => void doProbe()}
              style={{
                padding: '4px 8px',
                minWidth: 320,
                background: '#0f1a2a',
                color: 'inherit',
                border: '1px solid #243a55',
                borderRadius: 4,
              }}
              placeholder="(optional)"
            />
          </div>
          {probe.state === 'probing' && <div style={{ color: '#9fb3cc' }}>Probing…</div>}
          {probe.state === 'ok' && (
            <div style={{ color: '#43c47e' }}>
              ✓ Connected (Ollama v{probe.version}, {probe.models.length} models)
            </div>
          )}
          {probe.state === 'err' && (
            <div style={{ color: '#ff8080' }}>
              Failed: {probe.kind} — {probe.message}{' '}
              <button onClick={() => void doProbe()}>retry</button>
            </div>
          )}

          {probe.state === 'ok' && (
            <>
              <div className="settings-row">
                <label>LLM model</label>
                <select
                  value={o.llmModel ?? ''}
                  onChange={(e) =>
                    void update({ advanced: { ollama: { llmModel: e.target.value || null } } })
                  }
                >
                  <option value="">— pick —</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <label>
                  Embedder model{' '}
                  {!showAllForEmbedder && (
                    <button style={{ fontSize: 11 }} onClick={() => setShowAllForEmbedder(true)}>
                      show all
                    </button>
                  )}
                </label>
                <select
                  value={o.embedderModel ?? ''}
                  onChange={(e) =>
                    void update({
                      advanced: { ollama: { embedderModel: e.target.value || null } },
                    })
                  }
                >
                  <option value="">— pick —</option>
                  {embedderModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <label>
                  Reranker model{' '}
                  <span
                    title="Ollama doesn't expose dedicated rerankers — LokLM scores passages by prompting this model."
                    style={{ cursor: 'help' }}
                  >
                    ⚠
                  </span>
                </label>
                <select
                  value={o.rerankerModel ?? ''}
                  onChange={(e) =>
                    void update({
                      advanced: { ollama: { rerankerModel: e.target.value || null } },
                    })
                  }
                >
                  <option value="">— pick —</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <details>
                <summary style={{ cursor: 'pointer', color: '#9fb3cc' }}>
                  ▶ Connection tuning
                </summary>
                <div className="settings-row">
                  <label>Request timeout (ms)</label>
                  <input
                    type="number"
                    min={5000}
                    max={300000}
                    value={o.requestTimeoutMs}
                    onChange={(e) =>
                      void update({
                        advanced: {
                          ollama: {
                            requestTimeoutMs: Math.max(
                              5000,
                              Math.min(300000, Number(e.target.value) || 60000),
                            ),
                          },
                        },
                      })
                    }
                    style={{
                      width: 120,
                      padding: '4px 8px',
                      background: '#0f1a2a',
                      color: 'inherit',
                      border: '1px solid #243a55',
                      borderRadius: 4,
                    }}
                  />
                </div>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  )
}

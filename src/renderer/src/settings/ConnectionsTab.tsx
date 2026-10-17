import { useCallback, useEffect, useRef, useState } from 'react'
import type { McpConnectionConfig, McpConnectionSummary, SkillTool } from '@shared/connections'
import { ConfirmModal } from '../chat/ConfirmModal'
import { useT } from '../i18n'
import './connections.css'

type Draft = {
  id: string
  name: string
  enabled: boolean
  transport: 'stdio' | 'http'
  command: string
  args: string
  url: string
  secrets: string
  secretKeys: string[]
  googlePreset: boolean
}
const newDraft = (): Draft => ({
  id: crypto.randomUUID(),
  name: '',
  enabled: true,
  transport: 'stdio',
  command: '',
  args: '[]',
  url: '',
  secrets: '',
  secretKeys: [],
  googlePreset: false,
})

export function ConnectionsTab(): JSX.Element {
  const t = useT()
  const [connections, setConnections] = useState<McpConnectionSummary[]>([])
  const [tools, setTools] = useState<SkillTool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [removing, setRemoving] = useState<McpConnectionSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const alive = useRef(true)
  const request = useRef(0)
  const refresh = useCallback(async () => {
    if (!alive.current) return
    const current = ++request.current
    setLoading(true)
    const [servers, catalog] = await Promise.allSettled([
      window.api.connections.list(),
      window.api.skills.tools(),
    ])
    if (!alive.current || current !== request.current) return
    if (servers.status === 'fulfilled') setConnections(servers.value)
    if (catalog.status === 'fulfilled') setTools(catalog.value)
    const failures = [servers, catalog].filter((result) => result.status === 'rejected')
    setError(
      failures.map((result) => String((result as PromiseRejectedResult).reason)).join('\n') || null,
    )
    setLoading(false)
  }, [])
  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])
  const run = async (operation: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await operation()
      await refresh()
    } catch (cause) {
      if (alive.current) setError(String(cause))
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  const patch = (fields: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...fields } : current))
  const edit = (connection: McpConnectionSummary) => {
    setError(null)
    setNotice(null)
    setDraft({
      id: connection.id,
      name: connection.name,
      enabled: connection.enabled,
      transport: connection.transport,
      command: connection.command ?? '',
      args: JSON.stringify(connection.args ?? []),
      url: connection.url ?? '',
      secrets: '',
      secretKeys: connection.secretKeys,
      googlePreset: connection.args?.includes('workspace-mcp') ?? false,
    })
  }
  const save = () => {
    if (!draft) return
    const current = draft
    void run(async () => {
      let secrets: Record<string, string> | undefined
      if (current.secrets.trim()) {
        let parsed: unknown
        try {
          parsed = JSON.parse(current.secrets)
        } catch {
          throw new Error(t('connections.invalidObject'))
        }
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          Object.values(parsed).some((value) => typeof value !== 'string')
        )
          throw new Error(t('connections.invalidObject'))
        secrets = parsed as Record<string, string>
      }
      const config: McpConnectionConfig = {
        id: current.id,
        name: current.name.trim(),
        enabled: current.enabled,
        transport: current.transport,
      }
      if (current.transport === 'stdio') {
        let args: unknown
        try {
          args = JSON.parse(current.args || '[]')
        } catch {
          throw new Error(t('connections.invalidArgs'))
        }
        if (!Array.isArray(args) || args.some((value) => typeof value !== 'string'))
          throw new Error(t('connections.invalidArgs'))
        config.command = current.command.trim()
        config.args = args
        if (secrets !== undefined) config.env = secrets
      } else {
        config.url = current.url.trim()
        if (secrets !== undefined) config.headers = secrets
      }
      await window.api.connections.save(config)
      if (alive.current) {
        setDraft(null)
        setNotice(t('connections.saved'))
      }
    })
  }
  return (
    <div className="connections" aria-busy={busy}>
      <p className="connections__privacy">{t('connections.privacy')}</p>
      <p>{t('skills.connectionsHint')}</p>
      <div className="connections__buttons">
        <button type="button" disabled={busy || loading} onClick={() => void refresh()}>
          {t('connections.refresh')}
        </button>
      </div>
      {error && (
        <div role="alert">
          <p className="connections__error">{error}</p>
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">{t('connections.loading')}</p>}
      {!draft && (
        <div className="connections__buttons">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft(newDraft())
              setError(null)
              setNotice(null)
            }}
          >
            {t('connections.new')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft({
                ...newDraft(),
                name: 'Gmail + Google Calendar',
                command: 'uvx',
                args: JSON.stringify(['workspace-mcp', '--tools', 'gmail', 'calendar']),
                googlePreset: true,
              })
              setError(null)
              setNotice(null)
            }}
          >
            {t('connections.googlePreset')}
          </button>
        </div>
      )}
      {draft && (
        <form
          className="connections__editor"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <fieldset disabled={busy}>
            <legend>
              {t(
                connections.some((item) => item.id === draft.id)
                  ? 'connections.edit'
                  : 'connections.new',
              )}
            </legend>
            {draft.googlePreset && (
              <p>
                {t('connections.googleSetup')}{' '}
                <a
                  href="https://github.com/taylorwilsdon/google_workspace_mcp#quick-start"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t('connections.setupGuide')}
                </a>
              </p>
            )}
            <label>
              {t('connections.name')}
              <input
                required
                maxLength={200}
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value })}
                autoFocus
              />
            </label>
            <label>
              {t('connections.transport')}
              <select
                value={draft.transport}
                onChange={(event) =>
                  patch({ transport: event.target.value as Draft['transport'], secrets: '' })
                }
              >
                <option value="stdio">{t('connections.stdio')}</option>
                <option value="http">{t('connections.http')}</option>
              </select>
            </label>
            {draft.transport === 'stdio' ? (
              <>
                <label>
                  {t('connections.command')}
                  <input
                    required
                    value={draft.command}
                    onChange={(event) => patch({ command: event.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label>
                  {t('connections.args')}
                  <textarea
                    value={draft.args}
                    onChange={(event) => patch({ args: event.target.value })}
                    rows={3}
                    spellCheck={false}
                  />
                </label>
              </>
            ) : (
              <label>
                {t('connections.url')}
                <input
                  required
                  type="url"
                  value={draft.url}
                  onChange={(event) => patch({ url: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            )}
            <label>
              {t(draft.transport === 'stdio' ? 'connections.env' : 'connections.headers')}
              <input
                type="password"
                value={draft.secrets}
                onChange={(event) => patch({ secrets: event.target.value })}
                autoComplete="new-password"
                spellCheck={false}
                aria-describedby="connection-credentials-hint"
              />
            </label>
            <p id="connection-credentials-hint">{t('connections.secretsHint')}</p>
            {draft.secretKeys.length > 0 && (
              <p>{t('connections.secretKeys', { keys: draft.secretKeys.join(', ') })}</p>
            )}
            <label className="connections__enabled">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => patch({ enabled: event.target.checked })}
              />
              {t('connections.enabled')}
            </label>
            <div className="connections__buttons">
              <button type="submit">{t('connections.save')}</button>
              <button type="button" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {!loading && connections.length === 0 && <p>{t('connections.empty')}</p>}
      <ul className="connections__list">
        {connections.map((connection) => (
          <li key={connection.id}>
            <div>
              <strong>{connection.name}</strong>{' '}
              <span role="status">{t(`connections.${connection.status}`)}</span>
              <span>{t('connections.tools', { count: connection.toolCount })}</span>
            </div>
            <p>{connection.transport === 'stdio' ? connection.command : connection.url}</p>
            {connection.error && <p role="alert">{connection.error}</p>}
            <div className="connections__buttons">
              <button
                type="button"
                disabled={busy || draft !== null}
                onClick={() => edit(connection)}
              >
                {t('connections.edit')}
              </button>
              <button
                type="button"
                disabled={busy || connection.status === 'connecting'}
                onClick={() =>
                  void run(async () => {
                    if (connection.status === 'connected')
                      await window.api.connections.disconnect(connection.id)
                    else await window.api.connections.connect(connection.id)
                  })
                }
              >
                {t(
                  connection.status === 'connected'
                    ? 'connections.disconnect'
                    : 'connections.connect',
                )}
              </button>
              <button type="button" disabled={busy} onClick={() => setRemoving(connection)}>
                {t('connections.remove')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <section className="connections__catalog">
        <h3>{t('connections.catalog')}</h3>
        <p>{t('connections.catalogHint')}</p>
        <ul>
          {tools.map((tool) => (
            <li key={tool.id}>
              <strong>{tool.name}</strong>
              <p>{tool.description}</p>
              <small>
                {tool.source === 'organizer'
                  ? t('connections.builtIn')
                  : connections.find((connection) => connection.id === tool.connectionId)?.name}
              </small>
            </li>
          ))}
        </ul>
      </section>
      {removing && (
        <ConfirmModal
          title={t('connections.removeTitle')}
          body={t('connections.removeBody', { name: removing.name })}
          confirmLabel={t('connections.remove')}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.id
            setRemoving(null)
            void run(async () => {
              await window.api.connections.remove(id)
              if (alive.current && draft?.id === id) setDraft(null)
            })
          }}
        />
      )}
    </div>
  )
}

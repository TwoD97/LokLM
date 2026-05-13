import { useEffect, useState } from 'react'

type ProbeState =
  | { kind: 'pending' }
  | { kind: 'ok'; status: unknown }
  | { kind: 'unavailable'; reason: string }

export function App() {
  const [probe, setProbe] = useState<ProbeState>({ kind: 'pending' })

  useEffect(() => {
    const api = window.api
    if (!api?.auth?.status) {
      setProbe({
        kind: 'unavailable',
        reason: 'window.api.auth.status nicht bereit (AP-2.1 offen)',
      })
      return
    }
    api.auth
      .status()
      .then((status) => setProbe({ kind: 'ok', status }))
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err)
        setProbe({ kind: 'unavailable', reason })
      })
  }, [])

  return (
    <main className="app">
      <h1>LokLM</h1>
      <p className="app__sub">Lokaler KI-Wissensassistent — Skelett (AP-1.1)</p>
      <section className="app__probe" aria-label="IPC-Probe">
        <h2>IPC-Probe</h2>
        {probe.kind === 'pending' && <p>Prüfe window.api …</p>}
        {probe.kind === 'ok' && (
          <pre className="app__probe-result">{JSON.stringify(probe.status, null, 2)}</pre>
        )}
        {probe.kind === 'unavailable' && (
          <p className="app__probe-pending">Noch nicht verdrahtet — {probe.reason}</p>
        )}
      </section>
    </main>
  )
}

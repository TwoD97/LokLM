import { useCallback, useEffect, useState } from 'react'
import type { AuthStatus } from '@shared/authTypes'
import { LoginView } from './auth/LoginView'
import { PassphraseReveal } from './auth/PassphraseReveal'
import { RegisterView } from './auth/RegisterView'
import { ResetView } from './auth/ResetView'
import { UnlockedView } from './auth/UnlockedView'
import { BackgroundFx } from './BackgroundFx'
import { TitleBar } from './TitleBar'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'register' }
  | { kind: 'login' }
  | { kind: 'reset' }
  | { kind: 'reveal'; words: string[] }
  | { kind: 'unlocked' }

function pickPhaseFromStatus(status: AuthStatus, current: Phase): Phase {
  if (!status.registered) return { kind: 'register' }
  if (!status.locked) {
    if (current.kind === 'reveal') return current
    return { kind: 'unlocked' }
  }
  // registered & locked: stay on reset if user is in the middle of it,
  // otherwise show login.
  if (current.kind === 'reset' || current.kind === 'reveal') return current
  return { kind: 'login' }
}

export function App(): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const s = await window.api.auth.status()
      setStatus(s)
      setPhase((current) => pickPhaseFromStatus(s, current))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setPhase({ kind: 'error', message })
    }
  }, [])

  useEffect(() => {
    void refresh()
    const off = window.api.auth.onState((s) => {
      setStatus(s)
      setPhase((current) => pickPhaseFromStatus(s, current))
    })
    return () => off()
  }, [refresh])

  let content: JSX.Element
  if (phase.kind === 'loading') {
    content = (
      <section className="auth-card">
        <p>Lade …</p>
      </section>
    )
  } else if (phase.kind === 'error') {
    content = (
      <section className="auth-card">
        <h1>Fehler</h1>
        <p className="auth-card__error">{phase.message}</p>
        <button type="button" onClick={() => void refresh()}>
          Erneut versuchen
        </button>
      </section>
    )
  } else if (phase.kind === 'register') {
    content = (
      <RegisterView
        onRegistered={(words) => setPhase({ kind: 'reveal', words })}
        onSwitchToLogin={() => setPhase({ kind: 'login' })}
      />
    )
  } else if (phase.kind === 'login' && status) {
    content = (
      <LoginView
        status={status}
        onUnlocked={() => setPhase({ kind: 'unlocked' })}
        onForgotPassword={() => setPhase({ kind: 'reset' })}
      />
    )
  } else if (phase.kind === 'reset' && status) {
    content = (
      <ResetView
        status={status}
        onReset={(words) => setPhase({ kind: 'reveal', words })}
        onCancel={() => setPhase({ kind: 'login' })}
      />
    )
  } else if (phase.kind === 'reveal') {
    content = (
      <PassphraseReveal
        words={phase.words}
        title="Wiederherstellungs-Wörter"
        onAcknowledge={() => setPhase({ kind: 'unlocked' })}
      />
    )
  } else if (phase.kind === 'unlocked' && status) {
    content = <UnlockedView status={status} onLocked={() => setPhase({ kind: 'login' })} />
  } else {
    content = (
      <section className="auth-card">
        <p>Lade …</p>
      </section>
    )
  }

  return (
    <>
      <BackgroundFx />
      <TitleBar />
      <main className="app">
        <header className="app__header" aria-label="LokLM">
          <p className="app__brand">LokLM</p>
          <p className="app__sub">Lokaler KI-Wissensassistent</p>
        </header>
        {content}
      </main>
    </>
  )
}

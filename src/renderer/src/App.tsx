import { useCallback, useEffect, useState } from 'react'
import type { AuthStatus } from '@shared/authTypes'
import { LoginView } from './auth/LoginView'
import { PassphraseReveal } from './auth/PassphraseReveal'
import { RegisterView } from './auth/RegisterView'
import { ResetView } from './auth/ResetView'
import { AppShell } from './shell/AppShell'
import { BackgroundFx } from './BackgroundFx'
import { TitleBar } from './TitleBar'
import { ModelDownloadView } from './models/ModelDownloadView'
import { SettingsModal } from './settings/SettingsModal'
import { FallbackToast } from './settings/FallbackToast'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'models' }
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
  // registered & locked , stay on reset if the user is in the middle of it ,
  // otherwise show login.
  if (current.kind === 'reset' || current.kind === 'reveal') return current
  return { kind: 'login' }
}

export function App(): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [settingsOpen, setSettingsOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [s, models] = await Promise.all([window.api.auth.status(), window.api.models.status()])
      setStatus(s)
      setPhase((current) => {
        // Required GGUFs missing? Show the downloader first — register/login
        // would just lead to a broken chat anyway.
        if (!models.allRequiredReady) return { kind: 'models' }
        return pickPhaseFromStatus(s, current)
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setPhase({ kind: 'error', message })
    }
  }, [])

  // Called by ModelDownloadView once all required models are on disk. Re-runs
  // the full refresh so the next phase falls out of the existing auth logic.
  const onModelsReady = useCallback(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
    const off = window.api.auth.onState((s) => {
      setStatus(s)
      setPhase((current) => {
        // While the user is staring at the model-download view, don't let a
        // background auth state change yank them out. `refresh()` is the only
        // path that's allowed to transition OUT of the models phase, and it
        // does so explicitly after re-checking `models:status`.
        if (current.kind === 'models') return current
        return pickPhaseFromStatus(s, current)
      })
    })
    return () => off()
  }, [refresh])

  if (phase.kind === 'unlocked') {
    return (
      <>
        <BackgroundFx />
        <TitleBar unlocked onOpenSettings={() => setSettingsOpen(true)} />
        <AppShell />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <FallbackToast onOpenSettings={() => setSettingsOpen(true)} />
      </>
    )
  }

  let content: JSX.Element
  if (phase.kind === 'loading') {
    content = (
      <section className="auth-card">
        <p>Lade …</p>
      </section>
    )
  } else if (phase.kind === 'models') {
    content = <ModelDownloadView onReady={onModelsReady} />
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
          <div className="app__brand-row">
            <svg
              className="app__mark"
              viewBox="0 0 64 64"
              width="40"
              height="40"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="14"
                y="22"
                width="36"
                height="30"
                rx="2"
                stroke="#F6F4EF"
                strokeWidth="3"
                opacity="0.4"
              />
              <rect
                x="11"
                y="17"
                width="36"
                height="30"
                rx="2"
                stroke="#F6F4EF"
                strokeWidth="3"
                opacity="0.7"
              />
              <rect
                x="8"
                y="12"
                width="36"
                height="30"
                rx="2"
                fill="#0B1B2B"
                stroke="#F6F4EF"
                strokeWidth="3"
              />
              <circle cx="38" cy="20" r="2.6" fill="#7DD3FC" />
            </svg>
            <p className="app__brand">LokLM</p>
          </div>
          <p className="app__sub">Lokaler KI-Wissensassistent</p>
        </header>
        {content}
      </main>
    </>
  )
}

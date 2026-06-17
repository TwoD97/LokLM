import { useCallback, useEffect, useState } from 'react'
import type { AuthStatus } from '@shared/authTypes'
import { LoginView } from './auth/LoginView'
import { PassphraseReveal } from './auth/PassphraseReveal'
import { RegisterView } from './auth/RegisterView'
import { ResetView } from './auth/ResetView'
import { AppShell } from './shell/AppShell'
import { BackgroundFx } from './BackgroundFx'
import { TitleBar } from './TitleBar'
import { SettingsModal } from './settings/SettingsModal'
import { FallbackToast } from './settings/FallbackToast'
import { ErrorBoundary } from './ErrorBoundary'
import { isLockedError } from './lib/lockedError'
import { useT } from './i18n'
import { useThemeEffect } from './theme/useTheme'

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
  // registered & locked , stay on reset if the user is in the middle of it ,
  // otherwise show login.
  if (current.kind === 'reset' || current.kind === 'reveal') return current
  return { kind: 'login' }
}

export function App(): JSX.Element {
  useThemeEffect()
  const t = useT()
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [settingsOpen, setSettingsOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      // Models are provided by the installer (wizard tier bundle), so the app
      // never gates on them or offers an in-app download — go straight to the
      // auth phase. A missing model surfaces later as a not-ready service, not
      // a download prompt.
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

  // Global LockedError → re-route to login. The inactivity timer in main can
  // fire at any moment; without this, the first IPC call after that lock
  // throws "locked" and the user sees a stray error toast somewhere instead
  // of being sent back to the unlock screen. refresh() reads the new
  // (locked) auth state and pickPhaseFromStatus routes from there.
  useEffect(() => {
    const onRejection = (ev: PromiseRejectionEvent): void => {
      if (isLockedError(ev.reason)) {
        ev.preventDefault()
        void refresh()
      }
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [refresh])

  // Chrome (BackgroundFx + TitleBar + Settings/Toast) is hoisted above the
  // phase switch so unlocking the vault doesn't tear down and re-mount the
  // shared shell — that used to re-fetch all three model statuses through
  // the TitleBar and restart BackgroundFx's pointer listener on every unlock.
  const isUnlocked = phase.kind === 'unlocked'

  let content: JSX.Element
  if (isUnlocked) {
    content = (
      <ErrorBoundary label="Workspace">
        <AppShell />
      </ErrorBoundary>
    )
  } else if (phase.kind === 'loading') {
    content = (
      <section className="auth-card">
        <p>{t('shell.loading')}</p>
      </section>
    )
  } else if (phase.kind === 'error') {
    content = (
      <section className="auth-card">
        <h1>{t('shell.errorTitle')}</h1>
        <p className="auth-card__error">{phase.message}</p>
        <button type="button" onClick={() => void refresh()}>
          {t('common.retry')}
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
        title={t('shell.recoveryWordsTitle')}
        onAcknowledge={() => setPhase({ kind: 'unlocked' })}
      />
    )
  } else {
    content = (
      <section className="auth-card">
        <p>{t('shell.loading')}</p>
      </section>
    )
  }

  return (
    <>
      <BackgroundFx />
      <TitleBar
        unlocked={isUnlocked}
        {...(isUnlocked ? { onOpenSettings: () => setSettingsOpen(true) } : {})}
      />
      {isUnlocked ? (
        <>
          {content}
          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          <FallbackToast onOpenSettings={() => setSettingsOpen(true)} />
        </>
      ) : (
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
            <p className="app__sub">{t('shell.tagline')}</p>
          </header>
          {content}
        </main>
      )}
    </>
  )
}

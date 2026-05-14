import { useState } from 'react'
import type { AuthStatus } from '@shared/authTypes'

type Props = {
  status: AuthStatus
  onLocked: () => void
}

export function UnlockedView({ status, onLocked }: Props): JSX.Element {
  const [busy, setBusy] = useState(false)

  const lock = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.auth.lock()
      onLocked()
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.auth.logout()
      onLocked()
    } finally {
      setBusy(false)
    }
  }

  const initial = status.displayName?.trim().charAt(0).toUpperCase() ?? '?'

  return (
    <section className="auth-card auth-card--lobby" aria-labelledby="lobby-title">
      <div className="auth-avatar" aria-hidden="true">
        <span className="auth-avatar__letter">{initial}</span>
        <span className="auth-avatar__status" />
      </div>
      <h1 id="lobby-title">{status.displayName ?? 'Eingeloggt'}</h1>
      <span className="lobby__status">Tresor entsperrt</span>
      <p className="auth-card__lead auth-card__lead--centered">
        Die App-Funktionen kommen mit den nächsten APs. Bis dahin kannst du den Tresor sperren oder
        dich abmelden.
      </p>
      <div className="lobby__actions">
        <button type="button" onClick={() => void lock()} disabled={busy}>
          Sperren
        </button>
        <button type="button" className="link" onClick={() => void logout()} disabled={busy}>
          Abmelden
        </button>
      </div>
    </section>
  )
}

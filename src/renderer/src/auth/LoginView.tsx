import { useState } from 'react'
import type { AuthStatus } from '@shared/authTypes'

type Props = {
  status: AuthStatus
  onUnlocked: () => void
  onForgotPassword: () => void
}

export function LoginView({ status, onUnlocked, onForgotPassword }: Props): JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy || password.length === 0) return
    setError(null)
    setBusy(true)
    try {
      const result = await window.api.auth.login(password)
      if (result.ok) {
        setPassword('')
        onUnlocked()
        return
      }
      if (result.reason === 'no_user') setError('Auf diesem Gerät ist kein Konto registriert.')
      else if (result.reason === 'bad_password') setError('Falsches Passwort.')
      else if (result.reason === 'rate_limited') {
        const mins = result.retryAfterMs ? Math.ceil(result.retryAfterMs / 60_000) : 5
        setError(`Zu viele Fehlversuche. Bitte ${mins} Minuten warten.`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.replace(/^Error invoking remote method [^:]+: Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  const initial = status.displayName?.trim().charAt(0).toUpperCase() ?? '?'

  return (
    <section className="auth-card auth-card--compact" aria-labelledby="login-title">
      <div className="auth-avatar" aria-hidden="true">
        <span className="auth-avatar__letter">{initial}</span>
        <span className="auth-avatar__status" />
      </div>
      <h1 id="login-title" className="auth-card__title-centered">
        {status.displayName ?? 'LokLM'}
      </h1>
      <p className="auth-card__lead auth-card__lead--centered">
        Passwort eingeben, um den Tresor zu entsperren.
      </p>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="auth-card__field auth-card__field--hero">
          <span className="sr-only">Passwort</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            placeholder="••••••••••"
            required
          />
        </label>

        {error && <p className="auth-card__error">{error}</p>}

        <button
          type="submit"
          className="primary primary--full"
          disabled={busy || password.length === 0}
        >
          {busy ? 'Entsperre …' : 'Entsperren →'}
        </button>
        <button type="button" className="link link--centered" onClick={onForgotPassword}>
          Passwort vergessen?
        </button>
      </form>
    </section>
  )
}

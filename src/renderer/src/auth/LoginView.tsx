import { useState } from 'react'
import type { AuthLoginStage, AuthStatus } from '@shared/authTypes'
import { useT } from '../i18n'
import { formatCooldown, useAuthForm } from './useAuthForm'

type Props = {
  status: AuthStatus
  onUnlocked: () => void
  onForgotPassword: () => void
}

const STAGE_KEY: Record<AuthLoginStage, string> = {
  deriving: 'auth.stageDeriving',
  decrypting: 'auth.stageDecrypting',
  restoring: 'auth.stageRestoring',
  ready: 'auth.stageReady',
}

export function LoginView({ status, onUnlocked, onForgotPassword }: Props): JSX.Element {
  const t = useT()
  const [password, setPassword] = useState('')
  const [stage, setStage] = useState<AuthLoginStage | null>(null)
  const form = useAuthForm()
  const { busy, error, cooldownMs, setBusy, setError, setCooldownUntil, setRpcError } = form

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy || password.length === 0 || cooldownMs > 0) return
    setError(null)
    setBusy(true)
    setStage(null)
    // Subscribe just for the lifetime of this login attempt — the unsubscribe
    // fires in the `finally` below so a re-entered submit doesn't pile up
    // listeners on the preload bridge.
    const offProgress = window.api.auth.onLoginProgress((ev) => setStage(ev.stage))
    try {
      const result = await window.api.auth.login(password)
      if (result.ok) {
        setPassword('')
        onUnlocked()
        return
      }
      // Collapse no_user + bad_password to the SAME message. Distinct text
      // would let a local attacker confirm whether an account exists on this
      // device (privacy leak, free fix).
      if (result.reason === 'no_user' || result.reason === 'bad_password') {
        setError(t('auth.badCredentials'))
      } else if (result.reason === 'rate_limited') {
        setCooldownUntil(Date.now() + (result.retryAfterMs ?? 5 * 60_000))
      }
    } catch (err: unknown) {
      setRpcError(err)
    } finally {
      offProgress()
      setBusy(false)
      setStage(null)
    }
  }

  const busyLabel = busy ? (stage ? t(STAGE_KEY[stage]) : t('auth.unlocking')) : t('auth.unlock')

  const initial = status.displayName?.trim().charAt(0).toUpperCase() ?? '?'

  return (
    <section className="auth-card auth-card--compact" aria-labelledby="login-title">
      <div className="auth-avatar" aria-hidden="true">
        <span className="auth-avatar__letter">{initial}</span>
        <span className="auth-avatar__status" />
      </div>
      <h1 id="login-title" className="auth-card__title-centered">
        {status.displayName ?? t('auth.fallbackName')}
      </h1>
      <p className="auth-card__lead auth-card__lead--centered">{t('auth.loginLead')}</p>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="auth-card__field auth-card__field--hero">
          <span className="sr-only">{t('auth.passwordLabel')}</span>
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

        {error && !cooldownMs && (
          <p className="auth-card__error" role="alert">
            {error}
          </p>
        )}
        {cooldownMs > 0 && (
          <p className="auth-card__error" role="alert">
            {t('auth.tooManyAttempts', { time: formatCooldown(cooldownMs) })}
          </p>
        )}

        <button
          type="submit"
          className="primary primary--full"
          disabled={busy || password.length === 0 || cooldownMs > 0}
        >
          {busyLabel}
        </button>
        <button type="button" className="link link--centered" onClick={onForgotPassword}>
          {t('auth.forgotPassword')}
        </button>
      </form>
    </section>
  )
}

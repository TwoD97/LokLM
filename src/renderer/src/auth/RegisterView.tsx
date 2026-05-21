import { useState } from 'react'
import { countCharacterClasses } from '@shared/authHelpers'
import { useAuthForm } from './useAuthForm'

type Props = {
  onRegistered: (words: string[]) => void
  onSwitchToLogin: () => void
}

export function RegisterView({ onRegistered, onSwitchToLogin }: Props): JSX.Element {
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [recoveryLang, setRecoveryLang] = useState<'de' | 'en'>('de')
  const { busy, error, setBusy, setError, setRpcError } = useAuthForm()

  const nameOk = displayName.trim().length >= 3 && displayName.trim().length <= 32
  const pwLong = password.length >= 10
  const pwClasses = countCharacterClasses(password)
  const pwOk = pwLong && pwClasses >= 3
  const matches = confirm.length > 0 && password === confirm
  const canSubmit = nameOk && pwOk && matches && !busy

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setBusy(true)
    try {
      const { passphrase } = await window.api.auth.register(
        displayName.trim(),
        password,
        recoveryLang,
      )
      // Drop the password from component state on success — argon2 already
      // ran, vault is open, the React tree no longer needs it. Doesn't fully
      // zero (JS strings are interned + immutable) but caps the lifetime.
      setPassword('')
      setConfirm('')
      onRegistered(passphrase)
    } catch (err: unknown) {
      setRpcError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="auth-card auth-card--steps">
      <h1>Konto anlegen</h1>
      <p className="auth-card__lead">
        Einmaliges Konto auf diesem Gerät. Die Daten bleiben lokal und werden verschlüsselt
        abgelegt.
      </p>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="auth-section">
          <span className="auth-section__label">01 · Identität</span>

          <label className="auth-card__field">
            <span>Anzeigename</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="off"
              autoFocus
              minLength={3}
              maxLength={32}
              required
            />
            <small className={nameOk || displayName.length === 0 ? 'hint' : 'hint hint--error'}>
              3–32 Zeichen.
            </small>
          </label>

          <fieldset className="auth-card__field">
            <legend>Sprache der Wiederherstellungs-Wörter</legend>
            <label className="auth-card__radio">
              <input
                type="radio"
                name="lang"
                checked={recoveryLang === 'de'}
                onChange={() => setRecoveryLang('de')}
              />
              Deutsch
            </label>
            <label className="auth-card__radio">
              <input
                type="radio"
                name="lang"
                checked={recoveryLang === 'en'}
                onChange={() => setRecoveryLang('en')}
              />
              English
            </label>
          </fieldset>
        </div>

        <div className="auth-section">
          <span className="auth-section__label">02 · Sicherheit</span>

          <label className="auth-card__field">
            <span>Passwort</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
            <small className={pwOk || password.length === 0 ? 'hint' : 'hint hint--error'}>
              Mindestens 10 Zeichen, drei der vier Klassen (Groß-, Kleinbuchstabe, Ziffer,
              Sonderzeichen). Aktuell: {password.length} Zeichen, {pwClasses} Klassen.
            </small>
          </label>

          <label className="auth-card__field">
            <span>Passwort wiederholen</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
            <small className={matches || confirm.length === 0 ? 'hint' : 'hint hint--error'}>
              {confirm.length === 0
                ? 'Zur Sicherheit nochmal.'
                : matches
                  ? 'Passt.'
                  : 'Stimmt nicht überein.'}
            </small>
          </label>
        </div>

        {error && (
          <p className="auth-card__error" role="alert">
            {error}
          </p>
        )}

        <div className="auth-card__row">
          <button type="submit" className="primary" disabled={!canSubmit}>
            {busy ? 'Registriere …' : 'Konto anlegen'}
          </button>
          <button type="button" className="link" onClick={onSwitchToLogin}>
            Schon registriert? Anmelden.
          </button>
        </div>
      </form>
    </section>
  )
}

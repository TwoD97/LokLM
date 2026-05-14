import { useMemo, useState } from 'react'
import {
  PASSPHRASE_WORDS,
  countCharacterClasses,
  getWordlist,
  normalisePassphrase,
  validatePassphrase,
} from '@shared/authHelpers'
import type { AuthStatus } from '@shared/authTypes'

type Props = {
  status: AuthStatus
  onReset: (words: string[]) => void
  onCancel: () => void
}

export function ResetView({ status, onReset, onCancel }: Props): JSX.Element {
  const [passphrase, setPassphrase] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const lang = status.recoveryLang ?? 'de'
  const wordlist = useMemo(() => getWordlist(lang), [lang])

  const words = normalisePassphrase(passphrase)
    .split(' ')
    .filter((s) => s.length > 0)
  const phraseCheck = words.length === 0 ? null : validatePassphrase(words, wordlist)

  const pwOk = password.length >= 10 && countCharacterClasses(password) >= 3
  const matches = confirm.length > 0 && password === confirm

  const canSubmit = phraseCheck?.ok === true && pwOk && matches && !busy

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setBusy(true)
    try {
      const result = await window.api.auth.reset(passphrase, password)
      if (result.ok) {
        setPassphrase('')
        setPassword('')
        setConfirm('')
        onReset(result.passphrase)
        return
      }
      if (result.reason === 'no_user') setError('Auf diesem Gerät ist kein Konto registriert.')
      else if (result.reason === 'bad_code') setError('Wiederherstellungs-Wörter stimmen nicht.')
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

  return (
    <section className="auth-card">
      <h1>Passwort zurücksetzen</h1>
      <p className="auth-card__lead">
        Gib die {PASSPHRASE_WORDS} Wiederherstellungs-Wörter (
        {lang === 'de' ? 'Deutsch' : 'English'}) und ein neues Passwort ein. Nach erfolgreichem
        Reset bekommst du neue Wörter — die alten verfallen.
      </p>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <ol className="auth-steps">
          <li className="auth-steps__item">
            <span className="auth-steps__num" aria-hidden="true">
              1
            </span>
            <div className="auth-steps__body">
              <span className="auth-steps__title">Wiederherstellungs-Wörter</span>
              <label className="auth-card__field">
                <span className="sr-only">Wiederherstellungs-Wörter</span>
                <textarea
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder="18 Wörter durch Leerzeichen getrennt"
                  required
                />
                <small
                  className={
                    !phraseCheck ? 'hint' : phraseCheck.ok ? 'hint hint--ok' : 'hint hint--error'
                  }
                >
                  {!phraseCheck && `${words.length} / ${PASSPHRASE_WORDS} Wörter`}
                  {phraseCheck?.ok && `Alle ${PASSPHRASE_WORDS} Wörter erkannt.`}
                  {phraseCheck?.ok === false &&
                    phraseCheck.reason === 'wrong-length' &&
                    `Erwarte ${PASSPHRASE_WORDS} Wörter, gefunden ${words.length}.`}
                  {phraseCheck?.ok === false &&
                    phraseCheck.reason === 'unknown-word' &&
                    `Wort ${phraseCheck.badIndex + 1} ist unbekannt: "${words[phraseCheck.badIndex] ?? ''}".`}
                </small>
              </label>
            </div>
          </li>

          <li className="auth-steps__item">
            <span className="auth-steps__num" aria-hidden="true">
              2
            </span>
            <div className="auth-steps__body">
              <span className="auth-steps__title">Neues Passwort</span>
              <label className="auth-card__field">
                <span className="sr-only">Neues Passwort</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={10}
                  placeholder="Neues Passwort"
                  required
                />
                <small className={pwOk || password.length === 0 ? 'hint' : 'hint hint--error'}>
                  Mindestens 10 Zeichen, drei der vier Klassen.
                </small>
              </label>
              <label className="auth-card__field">
                <span className="sr-only">Neues Passwort wiederholen</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Passwort wiederholen"
                  required
                />
                <small className={matches || confirm.length === 0 ? 'hint' : 'hint hint--error'}>
                  {confirm.length === 0 ? '—' : matches ? 'Passt.' : 'Stimmt nicht überein.'}
                </small>
              </label>
            </div>
          </li>
        </ol>

        {error && <p className="auth-card__error">{error}</p>}

        <div className="auth-card__row">
          <button type="submit" className="primary" disabled={!canSubmit}>
            {busy ? 'Setze zurück …' : 'Zurücksetzen'}
          </button>
          <button type="button" className="link" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </form>
    </section>
  )
}

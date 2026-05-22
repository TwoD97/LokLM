import { useEffect, useRef, useState } from 'react'
// the gate can fire from contexts that haven't already loaded SettingsModal.css
// (e.g. the library Exportieren action) , so pull the backdrop chrome in
// directly. import is idempotent — vite dedupes css side-effects.
import '../settings/SettingsModal.css'

type Props = {
  open: boolean
  title: string
  /** Short copy explaining why the retype is being asked. Rendered as the
   *  modal body above the password input. Plain string keeps the surface
   *  small ; if a future caller wants richer content, swap to ReactNode. */
  body: string
  /** Label on the confirm button when idle. Defaults to "Bestätigen". */
  confirmLabel?: string
  /** Called after the password verifies successfully. Resolves to perform the
   *  gated action ; thrown errors are surfaced as the modal error banner. */
  onConfirm: () => Promise<void>
  onCancel: () => void
}

/** Reusable retype gate for destructive / exfiltrating actions. Reuses the
 *  `.auth-card.auth-card--compact` chrome from LoginView so the gesture
 *  reads as "the same password prompt , just without the avatar" — keeps
 *  muscle memory + visual language consistent across the app. */
export function PasswordRetypeGate({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props): JSX.Element | null {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) {
      setPassword('')
      setBusy(false)
      setError(null)
      return
    }
    // microtask delay so the input mounts before focus()
    queueMicrotask(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy || password.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.auth.verifyPassword(password)
      if (!res.ok) {
        if (res.reason === 'bad_password') setError('Falsches Passwort.')
        else if (res.reason === 'rate_limited') {
          const secs = Math.ceil(res.retryAfterMs / 1000)
          setError(`Zu viele Fehlversuche. In ${secs}s erneut versuchen.`)
        } else if (res.reason === 'locked_session') setError('Sitzung ist gesperrt.')
        else setError('Kein Tresor registriert.')
        return
      }
      setPassword('')
      await onConfirm()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <section
        className="auth-card auth-card--compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="retype-title"
      >
        <h1 id="retype-title" className="auth-card__title-centered">
          {title}
        </h1>
        <p className="auth-card__lead auth-card__lead--centered">{body}</p>
        <form onSubmit={(e) => void submit(e)} noValidate>
          <label className="auth-card__field auth-card__field--hero">
            <span className="sr-only">Passwort</span>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••••"
              disabled={busy}
              required
            />
          </label>

          {error && (
            <p className="auth-card__error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="primary primary--full"
            disabled={busy || password.length === 0}
          >
            {busy ? 'Prüfe …' : (confirmLabel ?? 'Bestätigen')}
          </button>
          <button type="button" className="link link--centered" onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
        </form>
      </section>
    </div>
  )
}

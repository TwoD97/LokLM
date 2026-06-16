import { useEffect, useRef, useState } from 'react'
import { PassphraseReveal } from '../auth/PassphraseReveal'
import { useT } from '../i18n'

type Props = { onClose: () => void }

/**
 * AP-9 Account §3.8 "neue Recovery-Codes anfordern". Two steps:
 *   1. re-authenticate with the current password, then
 *   2. reveal the fresh passphrase once (reuses PassphraseReveal — copy +
 *      acknowledge checkbox).
 * Renders its own `.settings-backdrop`, which stacks above the Settings modal.
 */
export function RecoveryCodesModal({ onClose }: Props): JSX.Element {
  const t = useT()
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [words, setWords] = useState<string[] | null>(null)
  const backdropPressed = useRef(false)

  // Escape handling, capture phase so it runs BEFORE SettingsModal's window
  // listener (which closes the whole settings tree). On the password step
  // Escape closes just this modal; once the passphrase is revealed the old
  // codes are already invalid, so Escape must not dismiss the one-time view —
  // swallow it entirely.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (words === null) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [words, onClose])

  const generate = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const res = await window.api.auth.regenerateRecovery(pw)
      if (res.ok) {
        setWords(res.passphrase)
        return
      }
      if (res.reason === 'bad_password') setError(t('settings.profile.pwWrongCurrent'))
      else if (res.reason === 'rate_limited') setError(t('settings.profile.pwRateLimited'))
      else setError(t('settings.profile.recoveryError'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="settings-backdrop settings-recovery-scope"
      onMouseDown={(e) => {
        backdropPressed.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        // Backdrop closes only on the password step — once the codes are
        // revealed they're shown once, so a stray click must not dismiss them.
        if (e.target === e.currentTarget && backdropPressed.current && words === null) onClose()
        backdropPressed.current = false
      }}
      role="presentation"
    >
      {words ? (
        <PassphraseReveal
          words={words}
          title={t('settings.profile.newRecoveryTitle')}
          onAcknowledge={onClose}
        />
      ) : (
        <section className="auth-card auth-card--compact" role="dialog" aria-modal="true">
          <h1>{t('settings.profile.newRecoveryTitle')}</h1>
          <p className="auth-card__lead">{t('settings.profile.newRecoveryWarn')}</p>
          <label className="auth-card__field">
            <span>{t('settings.profile.currentPassword')}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pw && !busy) void generate()
              }}
            />
          </label>
          {error && <div className="auth-card__error">{error}</div>}
          <div className="auth-card__row">
            <button type="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!pw || busy}
              onClick={() => void generate()}
            >
              {t('settings.profile.newRecoveryGenerate')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { PassphraseReveal } from '../auth/PassphraseReveal'
import { useT } from '../i18n'
import { useModalFocus } from '../ui/useModalFocus'

type Props = { onClose: () => void }

/**
 * AP-9 Account "neue Recovery-Codes anfordern". Two steps:
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
  const scope = useRef<HTMLDivElement>(null)
  const generating = useRef(false)
  useModalFocus(scope, true)
  useEffect(() => {
    if (words) scope.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [words])

  // Escape handling, capture phase so it runs BEFORE SettingsModal's window
  // listener (which closes the whole settings tree). On the password step
  // Escape closes just this modal; once the passphrase is revealed the old
  // codes are already invalid, so Escape must not dismiss the one-time view —
  // swallow it entirely.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (words === null && !generating.current) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [words, onClose])

  const generate = async (): Promise<void> => {
    if (generating.current || !pw) return
    generating.current = true
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
      generating.current = false
      setBusy(false)
    }
  }

  return (
    <div
      className="settings-backdrop settings-recovery-scope"
      ref={scope}
      tabIndex={-1}
      onMouseDown={(e) => {
        backdropPressed.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        // Backdrop closes only on the password step — once the codes are
        // revealed they're shown once, so a stray click must not dismiss them.
        if (
          e.target === e.currentTarget &&
          backdropPressed.current &&
          words === null &&
          !generating.current
        )
          onClose()
        backdropPressed.current = false
      }}
      role="presentation"
    >
      {words ? (
        <div role="dialog" aria-modal="true" aria-label={t('settings.profile.newRecoveryTitle')}>
          <PassphraseReveal
            words={words}
            title={t('settings.profile.newRecoveryTitle')}
            onAcknowledge={onClose}
          />
        </div>
      ) : (
        <section
          className="auth-card auth-card--compact"
          role="dialog"
          aria-modal="true"
          aria-label={t('settings.profile.newRecoveryTitle')}
        >
          <h1>{t('settings.profile.newRecoveryTitle')}</h1>
          <p className="auth-card__lead">{t('settings.profile.newRecoveryWarn')}</p>
          <label className="auth-card__field">
            <span>{t('settings.profile.currentPassword')}</span>
            <input
              type="password"
              autoComplete="current-password"
              name="recovery-current-password"
              disabled={busy}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && pw && !busy) {
                  e.preventDefault()
                  void generate()
                }
              }}
            />
          </label>
          {error && (
            <div className="auth-card__error" role="alert">
              {error}
            </div>
          )}
          <div className="auth-card__row">
            <button type="button" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!pw || busy}
              onClick={() => void generate()}
            >
              {t(busy ? 'prefs.saving' : 'settings.profile.newRecoveryGenerate')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

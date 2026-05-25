import { useMemo, useState } from 'react'
import {
  PASSPHRASE_WORDS,
  countCharacterClasses,
  getWordlist,
  normalisePassphrase,
  validatePassphrase,
} from '@shared/authHelpers'
import type { AuthStatus } from '@shared/authTypes'
import { useT } from '../i18n'
import { formatCooldown, useAuthForm } from './useAuthForm'

type Props = {
  status: AuthStatus
  onReset: (words: string[]) => void
  onCancel: () => void
}

export function ResetView({ status, onReset, onCancel }: Props): JSX.Element {
  const t = useT()
  const [passphrase, setPassphrase] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const { busy, error, cooldownMs, setBusy, setError, setCooldownUntil, setRpcError } =
    useAuthForm()

  const lang = status.recoveryLang ?? 'de'
  const wordlist = useMemo(() => getWordlist(lang), [lang])

  const words = normalisePassphrase(passphrase)
    .split(' ')
    .filter((s) => s.length > 0)
  const phraseCheck = words.length === 0 ? null : validatePassphrase(words, wordlist)

  const pwOk = password.length >= 10 && countCharacterClasses(password) >= 3
  const matches = confirm.length > 0 && password === confirm

  const canSubmit = phraseCheck?.ok === true && pwOk && matches && !busy && cooldownMs === 0

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
      if (result.reason === 'no_user' || result.reason === 'bad_code') {
        setError(t('auth.resetBadCode'))
      } else if (result.reason === 'rate_limited') {
        setCooldownUntil(Date.now() + (result.retryAfterMs ?? 5 * 60_000))
      }
    } catch (err: unknown) {
      setRpcError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="auth-card">
      <h1>{t('auth.resetTitle')}</h1>
      <p className="auth-card__lead">
        {t('auth.resetLead', {
          count: PASSPHRASE_WORDS,
          lang: lang === 'de' ? t('auth.langGerman') : t('auth.langEnglish'),
        })}
      </p>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <ol className="auth-steps">
          <li className="auth-steps__item">
            <span className="auth-steps__num" aria-hidden="true">
              1
            </span>
            <div className="auth-steps__body">
              <span className="auth-steps__title">{t('auth.recoveryWords')}</span>
              <label className="auth-card__field">
                <span className="sr-only">{t('auth.recoveryWords')}</span>
                <textarea
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder={t('auth.recoveryWordsPlaceholder')}
                  required
                />
                <small
                  className={
                    !phraseCheck ? 'hint' : phraseCheck.ok ? 'hint hint--ok' : 'hint hint--error'
                  }
                >
                  {!phraseCheck &&
                    t('auth.wordsCount', { count: words.length, total: PASSPHRASE_WORDS })}
                  {phraseCheck?.ok && t('auth.wordsAllRecognized', { total: PASSPHRASE_WORDS })}
                  {phraseCheck?.ok === false &&
                    phraseCheck.reason === 'wrong-length' &&
                    t('auth.wordsWrongLength', { total: PASSPHRASE_WORDS, count: words.length })}
                  {phraseCheck?.ok === false &&
                    phraseCheck.reason === 'unknown-word' &&
                    t('auth.wordsUnknown', {
                      index: phraseCheck.badIndex + 1,
                      word: words[phraseCheck.badIndex] ?? '',
                    })}
                </small>
              </label>
            </div>
          </li>

          <li className="auth-steps__item">
            <span className="auth-steps__num" aria-hidden="true">
              2
            </span>
            <div className="auth-steps__body">
              <span className="auth-steps__title">{t('auth.newPassword')}</span>
              <label className="auth-card__field">
                <span className="sr-only">{t('auth.newPassword')}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={10}
                  placeholder={t('auth.newPasswordPlaceholder')}
                  required
                />
                <small className={pwOk || password.length === 0 ? 'hint' : 'hint hint--error'}>
                  {t('auth.newPasswordHint')}
                </small>
              </label>
              <label className="auth-card__field">
                <span className="sr-only">{t('auth.newPasswordRepeat')}</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder={t('auth.repeatPassword')}
                  required
                />
                <small className={matches || confirm.length === 0 ? 'hint' : 'hint hint--error'}>
                  {confirm.length === 0
                    ? t('auth.resetMismatchPlaceholder')
                    : matches
                      ? t('auth.repeatHintMatch')
                      : t('auth.repeatHintMismatch')}
                </small>
              </label>
            </div>
          </li>
        </ol>

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

        <div className="auth-card__row">
          <button type="submit" className="primary" disabled={!canSubmit}>
            {busy ? t('auth.resetting') : t('auth.resetSubmit')}
          </button>
          <button type="button" className="link" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </section>
  )
}

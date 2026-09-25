import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { useT } from '../i18n'

type Props = {
  words: string[]
  title: string
  onAcknowledge: () => void
}

export function PassphraseReveal({ words, title, onAcknowledge }: Props): JSX.Element {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const copyPending = useRef(false)
  const mounted = useRef(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [])

  const copy = async (): Promise<void> => {
    if (copyPending.current) return
    copyPending.current = true
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    setCopying(true)
    setCopyFailed(false)
    setCopied(false)
    try {
      // Main-process copy: auto-clears the clipboard after ~60 s so the
      // passphrase doesn't linger for clipboard history / cloud sync.
      await window.api.auth.copySecret(words.join(' '))
      if (!mounted.current) return
      setCopied(true)
      copiedTimer.current = setTimeout(() => {
        copiedTimer.current = null
        setCopied(false)
      }, 2000)
    } catch {
      if (mounted.current) setCopyFailed(true)
    } finally {
      copyPending.current = false
      if (mounted.current) setCopying(false)
    }
  }

  return (
    <section className="auth-card auth-card--reveal">
      <div className="reveal-header">
        <span className="reveal-header__badge">
          {t('auth.revealBadge', { count: words.length })}
        </span>
        <h1>{title}</h1>
      </div>
      <p className="auth-card__lead">{t('auth.revealLead', { count: words.length })}</p>
      <ol className="passphrase-grid">
        {words.map((w, i) => (
          <li key={`${i}-${w}`}>
            <span className="passphrase-grid__num">{i + 1}</span>
            <span className="passphrase-grid__word">{w}</span>
          </li>
        ))}
      </ol>
      <div className="auth-card__row">
        <button
          type="button"
          disabled={copying}
          onClick={() => void copy()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {copied ? (
            <>
              {t('auth.copiedToClipboard')} <Check size={14} aria-hidden="true" />
            </>
          ) : copying ? (
            t('auth.copyingToClipboard')
          ) : copyFailed ? (
            t('auth.retryCopy')
          ) : (
            t('auth.copyToClipboard')
          )}
        </button>
      </div>
      {copyFailed && (
        <p className="auth-card__error" role="alert">
          {t('auth.copyFailed')}
        </p>
      )}
      <label className="auth-card__checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {t('auth.revealConfirm')}
      </label>
      <div className="auth-card__row">
        <button
          type="button"
          className="primary"
          disabled={!confirmed || copying}
          onClick={onAcknowledge}
        >
          {t('common.next')}
        </button>
      </div>
    </section>
  )
}

import { useState } from 'react'
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
  const [confirmed, setConfirmed] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      // Main-process copy: auto-clears the clipboard after ~60 s so the
      // passphrase doesn't linger for clipboard history / cloud sync.
      await window.api.auth.copySecret(words.join(' '))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — user can read it off the screen */
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
          onClick={() => void copy()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {copied ? (
            <>
              {t('auth.copiedToClipboard')} <Check size={14} aria-hidden="true" />
            </>
          ) : (
            t('auth.copyToClipboard')
          )}
        </button>
      </div>
      <label className="auth-card__checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {t('auth.revealConfirm')}
      </label>
      <div className="auth-card__row">
        <button type="button" className="primary" disabled={!confirmed} onClick={onAcknowledge}>
          {t('common.next')}
        </button>
      </div>
    </section>
  )
}

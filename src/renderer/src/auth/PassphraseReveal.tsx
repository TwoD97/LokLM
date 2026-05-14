import { useState } from 'react'

type Props = {
  words: string[]
  title: string
  onAcknowledge: () => void
}

export function PassphraseReveal({ words, title, onAcknowledge }: Props): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(words.join(' '))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — user can read it off the screen */
    }
  }

  return (
    <section className="auth-card auth-card--reveal">
      <div className="reveal-header">
        <span className="reveal-header__badge">{words.length} Wörter</span>
        <h1>{title}</h1>
      </div>
      <p className="auth-card__lead">
        Diese {words.length} Wörter sind dein einziger Weg zurück, falls du das Passwort vergisst.
        Notiere sie jetzt — sie werden nirgendwo gespeichert und können nicht erneut angezeigt
        werden.
      </p>
      <ol className="passphrase-grid">
        {words.map((w, i) => (
          <li key={`${i}-${w}`}>
            <span className="passphrase-grid__num">{i + 1}</span>
            <span className="passphrase-grid__word">{w}</span>
          </li>
        ))}
      </ol>
      <div className="auth-card__row">
        <button type="button" onClick={() => void copy()}>
          {copied ? 'In Zwischenablage ✓' : 'In Zwischenablage kopieren'}
        </button>
      </div>
      <label className="auth-card__checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Ich habe die 18 Wörter sicher notiert.
      </label>
      <div className="auth-card__row">
        <button type="button" className="primary" disabled={!confirmed} onClick={onAcknowledge}>
          Weiter
        </button>
      </div>
    </section>
  )
}

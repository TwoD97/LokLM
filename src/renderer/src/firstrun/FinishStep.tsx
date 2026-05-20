/**
 * Finish-Step — Bestätigung dass alles eingerichtet ist.
 *
 * Zeigt eine kurze Zusammenfassung der gewählten Optionen und einen
 * "Loslegen" Button (gerendert im Wizard-Footer).
 */

import type { FirstRunOptions } from './FirstRunWizard'

type Props = {
  options: FirstRunOptions
}

export function FinishStep({ options }: Props): JSX.Element {
  return (
    <div className="firstrun-finish">
      <div className="firstrun-finish__badge" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
          <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2" opacity="0.4" />
          <path
            d="M20 33l8 8 16-18"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h2 className="firstrun-step-title">LokLM ist bereit</h2>
      <p className="firstrun-step-sub">
        Die Einrichtung ist abgeschlossen. Klicke auf „Loslegen“, um dein Konto anzulegen.
      </p>

      <dl className="firstrun-finish__summary">
        <SummaryRow label="Desktop-Verknüpfung" value={options.createDesktopShortcut} />
        <SummaryRow label="Startmenü-Verknüpfung" value={options.createStartMenuShortcut} />
        <SummaryRow label="Mit Windows starten" value={options.enableAutostart} />
      </dl>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: boolean }): JSX.Element {
  return (
    <div className="firstrun-finish__row">
      <dt>{label}</dt>
      <dd className={value ? 'is-on' : 'is-off'}>{value ? 'Ja' : 'Nein'}</dd>
    </div>
  )
}

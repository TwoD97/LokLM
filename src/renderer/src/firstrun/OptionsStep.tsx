/**
 * Options-Step — Toggles für Shortcuts und Autostart.
 *
 * Diese Werte werden im FirstRunWizard-State gehalten und beim Finish-Step
 * (oder explizit beim Verlassen dieser Page) per IPC an den Main-Process
 * geschickt. Der Main-Process schreibt sie nach HKCU\Software\LokLM\Setup.
 */

import type { FirstRunOptions } from './FirstRunWizard'

type Props = {
  options: FirstRunOptions
  onChange: (next: FirstRunOptions) => void
}

export function OptionsStep({ options, onChange }: Props): JSX.Element {
  const update = (patch: Partial<FirstRunOptions>): void => {
    onChange({ ...options, ...patch })
  }

  return (
    <div className="firstrun-options">
      <h2 className="firstrun-step-title">Optionen</h2>
      <p className="firstrun-step-sub">
        Diese Einstellungen kannst du später jederzeit in den App-Einstellungen ändern.
      </p>

      <section className="firstrun-options__section">
        <h3 className="firstrun-options__section-title">Verknüpfungen</h3>

        <label className="firstrun-toggle">
          <input
            type="checkbox"
            checked={options.createDesktopShortcut}
            onChange={(e) => update({ createDesktopShortcut: e.target.checked })}
          />
          <span>Desktop-Verknüpfung erstellen</span>
        </label>

        <label className="firstrun-toggle">
          <input
            type="checkbox"
            checked={options.createStartMenuShortcut}
            onChange={(e) => update({ createStartMenuShortcut: e.target.checked })}
          />
          <span>Startmenü-Verknüpfung erstellen</span>
        </label>
      </section>

      <section className="firstrun-options__section">
        <h3 className="firstrun-options__section-title">Beim Windows-Start</h3>

        <label className="firstrun-toggle">
          <input
            type="checkbox"
            checked={options.enableAutostart}
            onChange={(e) => update({ enableAutostart: e.target.checked })}
          />
          <span>LokLM automatisch mit Windows starten</span>
        </label>
        <p className="firstrun-options__hint">
          Empfohlen für tägliche Nutzung. LokLM startet im Hintergrund und ist sofort verfügbar.
        </p>
      </section>
    </div>
  )
}

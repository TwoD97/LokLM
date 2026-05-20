export function WelcomeStep(): JSX.Element {
  return (
    <div className="firstrun-welcome">
      <p className="firstrun-eyebrow">Willkommen bei</p>
      <h1 className="firstrun-title">LokLM</h1>
      <p className="firstrun-lead">Lokaler KI-Wissensassistent mit Quellenverifikation</p>

      <ul className="firstrun-feature-list" aria-label="Was LokLM ausmacht">
        <li>
          <span className="firstrun-feature__dot" aria-hidden="true" />
          <span>
            <strong>100% lokal.</strong> Deine Dokumente verlassen niemals dein Gerät.
          </span>
        </li>
        <li>
          <span className="firstrun-feature__dot" aria-hidden="true" />
          <span>
            <strong>Quellen-verifizierte Antworten.</strong> Jede Aussage zeigt die Belegstelle im
            Original.
          </span>
        </li>
        <li>
          <span className="firstrun-feature__dot" aria-hidden="true" />
          <span>
            <strong>Keine Cloud, keine Telemetrie.</strong> Kein Account-Login bei externen
            Anbietern nötig.
          </span>
        </li>
      </ul>

      <p className="firstrun-hint">
        Die nächsten Schritte dauern ungefähr 2 Minuten — danach kannst du loslegen.
      </p>
    </div>
  )
}

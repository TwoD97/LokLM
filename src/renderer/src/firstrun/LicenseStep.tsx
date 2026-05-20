/**
 * License-Step — zeigt den MIT-Lizenztext und verlangt explizite Zustimmung
 * bevor weitergeklickt werden kann.
 *
 * Die Lizenz-Datei wird zur Build-Zeit aus dem Repo-Root in den Renderer
 * gebundlet — siehe @assets/LICENSE.txt unten. Bei Lizenz-Änderung den
 * Build neu anstoßen.
 */

import licenseText from '../../../../LICENSE?raw'

type Props = {
  accepted: boolean
  onAcceptedChange: (next: boolean) => void
}

export function LicenseStep({ accepted, onAcceptedChange }: Props): JSX.Element {
  return (
    <div className="firstrun-license">
      <h2 className="firstrun-step-title">Lizenzvereinbarung</h2>
      <p className="firstrun-step-sub">
        LokLM steht unter der MIT-Lizenz. Bitte zur Kenntnis nehmen, danach geht es weiter.
      </p>

      <pre className="firstrun-license__body" tabIndex={0} aria-label="MIT-Lizenztext">
        {licenseText}
      </pre>

      <label className="firstrun-toggle">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onAcceptedChange(e.target.checked)}
        />
        <span>Ich akzeptiere die MIT-Lizenzbedingungen.</span>
      </label>
    </div>
  )
}

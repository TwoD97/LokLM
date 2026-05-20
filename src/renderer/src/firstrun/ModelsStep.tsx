/**
 * Models-Step — wraps the existing ModelDownloadView for visual integration
 * inside the wizard frame.
 *
 * ModelDownloadView handles all the IPC + progress logic itself; we just
 * provide it the `onReady` callback to advance the wizard once required
 * GGUFs are on disk.
 */

import { ModelDownloadView } from '../models/ModelDownloadView'

type Props = {
  onReady: () => void
}

export function ModelsStep({ onReady }: Props): JSX.Element {
  return (
    <div className="firstrun-models">
      <h2 className="firstrun-step-title">Modelle herunterladen</h2>
      <p className="firstrun-step-sub">
        Diese GGUF-Modelldateien werden für die lokale Verarbeitung benötigt. Der Download läuft
        einmalig — danach bleibt alles offline.
      </p>

      <div className="firstrun-models__embed">
        <ModelDownloadView onReady={onReady} />
      </div>
    </div>
  )
}

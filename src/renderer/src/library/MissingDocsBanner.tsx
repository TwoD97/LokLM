import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, FileX, Check, Trash2 } from 'lucide-react'
import type { Document } from '@shared/documents'

type Props = {
  workspaceId: number
  /** Bumped by the parent after a sync run or doc mutation so the banner
   *  refetches without us needing to subscribe to every event channel. */
  refreshKey: number
  /** Called after Keep / Remove so the parent can refresh its doc list. */
  onChanged: () => void
}

/**
 * Soft-missing banner. Surfaces docs whose source file vanished from disk —
 * sync no longer auto-deletes, it stamps a marker and lets the user choose
 * Keep (dismiss the warning, keep chunks searchable) or Remove (delete the
 * doc row + chunks). Spelling each path out explicitly per the
 * "destructive confirmations" rule — no bulk Remove-all that bundles the list.
 */
export function MissingDocsBanner({
  workspaceId,
  refreshKey,
  onChanged,
}: Props): JSX.Element | null {
  const [missing, setMissing] = useState<Document[]>([])

  const reload = useCallback(async () => {
    // Guard against a stale preload bundle — Electron's preload doesn't hot-
    // reload alongside the renderer, so an in-flight dev session that updated
    // index.ts but didn't restart will hit this. Treat as "no missing docs"
    // rather than crashing the LibraryView mount effect.
    const api = window.api.documents as typeof window.api.documents & {
      listMissing?: (id: number) => Promise<Document[]>
    }
    if (typeof api.listMissing !== 'function') {
      setMissing([])
      return
    }
    setMissing(await api.listMissing(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  const onKeep = useCallback(
    async (id: number) => {
      await window.api.documents.keepMissing(id)
      await reload()
      onChanged()
    },
    [reload, onChanged],
  )

  const onRemove = useCallback(
    async (id: number) => {
      await window.api.documents.delete(id)
      await reload()
      onChanged()
    },
    [reload, onChanged],
  )

  if (missing.length === 0) return null
  return (
    <div className="library__missing">
      <div className="library__missing-header">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>
          {missing.length === 1
            ? '1 Datei nicht mehr gefunden'
            : `${missing.length} Dateien nicht mehr gefunden`}
        </span>
      </div>
      <ul className="library__missing-list">
        {missing.map((d) => (
          <li key={d.id} className="library__missing-item">
            <FileX size={14} aria-hidden="true" />
            <div className="library__missing-meta">
              <span className="library__missing-title">{d.title}</span>
              <span className="library__missing-path" title={d.sourcePath}>
                {d.sourcePath}
              </span>
            </div>
            <button
              type="button"
              className="library__missing-action"
              onClick={() => void onKeep(d.id)}
              title="In Bibliothek belassen (Suche funktioniert weiter, Quelle fehlt)"
            >
              <Check size={14} aria-hidden="true" />
              Behalten
            </button>
            <button
              type="button"
              className="library__missing-action library__missing-action--danger"
              onClick={() => void onRemove(d.id)}
              title="Dokument samt Chunks aus der Bibliothek entfernen"
            >
              <Trash2 size={14} aria-hidden="true" />
              Entfernen
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

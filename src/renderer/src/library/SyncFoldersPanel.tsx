import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FolderSync,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  RefreshCw,
  X,
} from 'lucide-react'

type Props = {
  workspaceId: number
  /** Called once a sync run finishes so the parent can refresh its doc list. */
  onSyncDone: () => void
}

type SyncEvent = {
  workspaceId: number
  phase: 'start' | 'progress' | 'done' | 'failed'
  imported: number
  reindexed: number
  /** Docs marked soft-missing this pass — sync never auto-deletes; the
   *  library banner surfaces a keep/remove choice. */
  markedMissing: number
  unchanged: number
  detail?: string
}

export function SyncFoldersPanel({ workspaceId, onSyncDone }: Props): JSX.Element {
  const [folders, setFolders] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [activeEvent, setActiveEvent] = useState<SyncEvent | null>(null)
  const [open, setOpen] = useState(false)

  const reload = useCallback(async () => {
    setFolders(await window.api.workspaces.listSyncFolders(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    void reload()
  }, [reload])

  // Ref the latest onSyncDone so the subscription stays mounted across
  // parent renders. Parent passes a fresh arrow each render; without this
  // ref the effect would unsub + resub on every render and progress events
  // arriving in the gap would be lost (the symptom: stuck "syncing…" UI).
  const onSyncDoneRef = useRef(onSyncDone)
  useEffect(() => {
    onSyncDoneRef.current = onSyncDone
  }, [onSyncDone])

  useEffect(() => {
    const off = window.api.workspaces.onSyncProgress((ev) => {
      if (ev.workspaceId !== workspaceId) return
      setActiveEvent(ev)
      if (ev.phase === 'done') {
        setBusy(false)
        onSyncDoneRef.current()
      } else if (ev.phase === 'failed') {
        setBusy(false)
      } else {
        setBusy(true)
      }
    })
    return () => off()
  }, [workspaceId])

  const onAdd = useCallback(async () => {
    const next = await window.api.workspaces.addSyncFolder(workspaceId)
    if (next != null) setFolders(next)
  }, [workspaceId])

  const onRemove = useCallback(
    async (folder: string) => {
      const next = await window.api.workspaces.removeSyncFolder(workspaceId, folder)
      setFolders(next)
    },
    [workspaceId],
  )

  const onSyncNow = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.workspaces.syncNow(workspaceId)
    } finally {
      // 'done' event also flips busy=false; this guard covers the case where
      // the event was dropped (renderer reload mid-sync).
      setBusy(false)
    }
  }, [workspaceId])

  const summary =
    folders.length === 0 ? 'Kein Ordner verbunden' : `${folders.length} Ordner verbunden`

  return (
    <div className="library__sync">
      <button
        type="button"
        className="library__sync-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="library__sync-toggle-label">
          <FolderSync size={16} aria-hidden="true" />
          Ordner-Sync · {summary}
        </span>
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="library__sync-body">
          {folders.length === 0 ? (
            <div className="library__sync-empty">
              Verbinde Ordner und LokLM importiert neue Dateien automatisch und reindiziert
              geänderte. Gelöschte Dateien werden als „nicht mehr gefunden“ markiert – du
              entscheidest selbst über behalten oder entfernen.
            </div>
          ) : (
            <ul className="library__sync-list">
              {folders.map((f) => (
                <li key={f} className="library__sync-item">
                  <Folder size={14} aria-hidden="true" />
                  <span className="library__sync-path" title={f}>
                    {f}
                  </span>
                  <button
                    type="button"
                    className="library__sync-item-remove"
                    onClick={() => void onRemove(f)}
                    aria-label={`Remove ${f}`}
                    title="Aus Sync entfernen (Dokumente bleiben in der Bibliothek)"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="library__sync-actions">
            <button type="button" onClick={() => void onAdd()} disabled={busy}>
              <FolderPlus size={14} aria-hidden="true" />
              Ordner hinzufügen
            </button>
            <button
              type="button"
              onClick={() => void onSyncNow()}
              disabled={busy || folders.length === 0}
            >
              <RefreshCw size={14} aria-hidden="true" className={busy ? 'spin' : ''} />
              {busy ? 'Synchronisiere…' : 'Jetzt synchronisieren'}
            </button>
          </div>
          {activeEvent && activeEvent.phase !== 'done' && activeEvent.phase !== 'failed' && (
            <div className="library__sync-progress">
              {activeEvent.detail ?? 'Scanne…'} · neu {activeEvent.imported} · reindex{' '}
              {activeEvent.reindexed} · fehlt {activeEvent.markedMissing}
            </div>
          )}
          {activeEvent?.phase === 'done' && (
            <div className="library__sync-progress library__sync-progress--done">
              Fertig · neu {activeEvent.imported} · reindex {activeEvent.reindexed} · fehlt{' '}
              {activeEvent.markedMissing} · unverändert {activeEvent.unchanged}
            </div>
          )}
          {activeEvent?.phase === 'failed' && (
            <div className="library__sync-progress library__sync-progress--failed">
              Fehler: {activeEvent.detail ?? 'unbekannt'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

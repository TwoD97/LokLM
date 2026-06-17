import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FolderSync,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  ListChecks,
  RefreshCw,
  X,
} from 'lucide-react'
import { useT } from '../i18n'

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
  const t = useT()
  const [folders, setFolders] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [activeEvent, setActiveEvent] = useState<SyncEvent | null>(null)
  const [open, setOpen] = useState(false)
  // ADR-0006: directory picker for a codebase folder with no .gitignore.
  // mode 'add' = first sync after adding the folder; 'edit' = re-picking later.
  // governed = the folder is scoped by its .gitignore, so manual picking is moot.
  const [picker, setPicker] = useState<{
    folder: string
    topLevelDirs: string[]
    mode: 'add' | 'edit'
    governed: boolean
  } | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

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
    const res = await window.api.workspaces.addSyncFolder(workspaceId)
    if (res == null) return // user cancelled the folder picker
    setFolders(res.folders)
    if (res.needsDirSelection) {
      // Codebase folder without a .gitignore — let the user choose what to index
      // before the first sync. Default to all dirs checked.
      setPicker({ ...res.needsDirSelection, mode: 'add', governed: false })
      setPicked(new Set(res.needsDirSelection.topLevelDirs))
    }
  }, [workspaceId])

  const onEdit = useCallback(
    async (folder: string) => {
      const sel = await window.api.workspaces.getDirSelection(workspaceId, folder)
      setPicker({
        folder,
        topLevelDirs: sel.topLevelDirs,
        mode: 'edit',
        governed: sel.hasGitignore,
      })
      // Stored empty selection means "index all" → pre-check everything.
      setPicked(new Set(sel.selected.length > 0 ? sel.selected : sel.topLevelDirs))
    },
    [workspaceId],
  )

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

  const togglePicked = useCallback((dir: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }, [])

  // Save the checked dirs and re-sync (used by "Index selected" on add and "Save"
  // on edit).
  const onPickerSave = useCallback(async () => {
    if (!picker) return
    await window.api.workspaces.setIndexDirs(workspaceId, picker.folder, [...picked])
    setPicker(null)
    void onSyncNow()
  }, [picker, picked, workspaceId, onSyncNow])

  // "Index everything": clear any restriction, then sync (add flow).
  const onPickerIndexAll = useCallback(async () => {
    if (!picker) return
    await window.api.workspaces.setIndexDirs(workspaceId, picker.folder, [])
    setPicker(null)
    void onSyncNow()
  }, [picker, workspaceId, onSyncNow])

  // Close without changes (edit "Cancel" / governed "Close") — no re-sync.
  const onPickerDismiss = useCallback(() => setPicker(null), [])

  const summary =
    folders.length === 0
      ? t('library.noFolderConnected')
      : t('library.foldersConnected', { count: folders.length })

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
          {t('library.folderSync', { summary })}
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
            <div className="library__sync-empty">{t('library.syncIntro')}</div>
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
                    onClick={() => void onEdit(f)}
                    aria-label={t('library.editDirs')}
                    title={t('library.editDirs')}
                  >
                    <ListChecks size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="library__sync-item-remove"
                    onClick={() => void onRemove(f)}
                    aria-label={t('library.removeFolder', { folder: f })}
                    title={t('library.removeFromSyncTitle')}
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
              {t('library.addFolder')}
            </button>
            <button
              type="button"
              onClick={() => void onSyncNow()}
              disabled={busy || folders.length === 0}
            >
              <RefreshCw size={14} aria-hidden="true" className={busy ? 'spin' : ''} />
              {busy ? t('library.syncing') : t('library.syncNow')}
            </button>
          </div>
          {activeEvent && activeEvent.phase !== 'done' && activeEvent.phase !== 'failed' && (
            <div className="library__sync-progress">
              {t('library.syncProgress', {
                detail: activeEvent.detail ?? t('library.scanning'),
                imported: activeEvent.imported,
                reindexed: activeEvent.reindexed,
                missing: activeEvent.markedMissing,
              })}
            </div>
          )}
          {activeEvent?.phase === 'done' && (
            <div className="library__sync-progress library__sync-progress--done">
              {t('library.syncDone', {
                imported: activeEvent.imported,
                reindexed: activeEvent.reindexed,
                missing: activeEvent.markedMissing,
                unchanged: activeEvent.unchanged,
              })}
            </div>
          )}
          {activeEvent?.phase === 'failed' && (
            <div className="library__sync-progress library__sync-progress--failed">
              {t('library.syncFailed', {
                detail: activeEvent.detail ?? t('library.syncFailedUnknown'),
              })}
            </div>
          )}
        </div>
      )}
      {picker && (
        <div
          className="dirpicker__backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t('library.pickDirsTitle')}
        >
          <div className="dirpicker">
            <h3 className="dirpicker__title">{t('library.pickDirsTitle')}</h3>
            <p className="dirpicker__intro">
              {picker.governed ? t('library.pickDirsGoverned') : t('library.pickDirsIntro')}
            </p>
            {!picker.governed && (
              <ul className="dirpicker__list">
                {picker.topLevelDirs.map((d) => (
                  <li key={d} className="dirpicker__item">
                    <label className="dirpicker__label">
                      <input
                        type="checkbox"
                        checked={picked.has(d)}
                        onChange={() => togglePicked(d)}
                      />
                      <Folder size={14} aria-hidden="true" />
                      <span className="dirpicker__name">{d}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="dirpicker__actions">
              {picker.governed ? (
                <button type="button" className="primary" onClick={() => onPickerDismiss()}>
                  {t('library.pickDirsClose')}
                </button>
              ) : picker.mode === 'edit' ? (
                <>
                  <button type="button" onClick={() => onPickerDismiss()}>
                    {t('library.pickDirsCancel')}
                  </button>
                  <button type="button" className="primary" onClick={() => void onPickerSave()}>
                    {t('library.pickDirsSave')}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => void onPickerIndexAll()}>
                    {t('library.pickDirsAll')}
                  </button>
                  <button type="button" className="primary" onClick={() => void onPickerSave()}>
                    {t('library.pickDirsConfirm')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

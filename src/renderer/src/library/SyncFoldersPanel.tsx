import { useCallback, useEffect, useId, useRef, useState } from 'react'
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
import { ConfirmModal } from '../chat/ConfirmModal'
import { useModalFocus } from '../ui/useModalFocus'

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
  // Workspace-local transient state must never survive a workspace switch.
  return <SyncFoldersContent key={workspaceId} workspaceId={workspaceId} onSyncDone={onSyncDone} />
}

function SyncFoldersContent({ workspaceId, onSyncDone }: Props): JSX.Element {
  const t = useT()
  const [folders, setFolders] = useState<string[]>([])
  const [syncing, setSyncing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ message: string; reload: boolean } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const alive = useRef(true)
  const operationPending = useRef(false)
  const reloadRequest = useRef(0)
  const busy = syncing || pending
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
  const pickerRef = useRef<HTMLDivElement>(null)
  const pickerTitleId = useId()
  const bodyId = useId()
  useModalFocus(pickerRef, picker !== null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    const request = ++reloadRequest.current
    try {
      const next = await window.api.workspaces.listSyncFolders(workspaceId)
      if (!alive.current || request !== reloadRequest.current) return
      setFolders(next)
      setError(null)
    } catch (cause) {
      if (alive.current && request === reloadRequest.current) {
        setError({ message: String(cause), reload: true })
      }
    }
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
        setSyncing(false)
        onSyncDoneRef.current()
      } else if (ev.phase === 'failed') {
        setSyncing(false)
      } else {
        setSyncing(true)
      }
    })
    return () => off()
  }, [workspaceId])

  // One operation at a time, including the native directory picker. Keep
  // failures in the current UI and never continue an old workspace's flow.
  const run = useCallback(async (action: () => Promise<void>) => {
    if (operationPending.current || !alive.current) return
    operationPending.current = true
    reloadRequest.current++
    setPending(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      if (alive.current) setError({ message: String(cause), reload: false })
    } finally {
      operationPending.current = false
      if (alive.current) setPending(false)
    }
  }, [])

  const onAdd = useCallback(
    () =>
      run(async () => {
        const res = await window.api.workspaces.addSyncFolder(workspaceId)
        if (!alive.current || res == null) return // user cancelled the folder picker
        setFolders(res.folders)
        if (res.needsDirSelection) {
          setPending(false)
          // Codebase folder without a .gitignore — let the user choose what to index
          // before the first sync. Default to all dirs checked.
          setPicker({ ...res.needsDirSelection, mode: 'add', governed: false })
          setPicked(new Set(res.needsDirSelection.topLevelDirs))
        }
      }),
    [workspaceId, run],
  )

  const onEdit = useCallback(
    (folder: string) =>
      run(async () => {
        const sel = await window.api.workspaces.getDirSelection(workspaceId, folder)
        if (!alive.current) return
        setPending(false)
        setPicker({
          folder,
          topLevelDirs: sel.topLevelDirs,
          mode: 'edit',
          governed: sel.hasGitignore,
        })
        // Stored empty selection means "index all" → pre-check everything.
        setPicked(new Set(sel.selected.length > 0 ? sel.selected : sel.topLevelDirs))
      }),
    [workspaceId, run],
  )

  const onRemove = useCallback(
    (folder: string) =>
      run(async () => {
        const next = await window.api.workspaces.removeSyncFolder(workspaceId, folder)
        if (!alive.current) return
        setFolders(next)
        onSyncDoneRef.current()
      }),
    [workspaceId, run],
  )

  const sync = useCallback(async () => {
    try {
      await window.api.workspaces.syncNow(workspaceId)
    } finally {
      if (alive.current) setSyncing(false)
    }
  }, [workspaceId])
  const onSyncNow = useCallback(() => run(sync), [run, sync])

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
  const onPickerSave = useCallback(
    () =>
      run(async () => {
        if (!picker || picked.size === 0) return
        await window.api.workspaces.setIndexDirs(workspaceId, picker.folder, [...picked])
        if (!alive.current) return
        setPicker(null)
        await sync()
      }),
    [picker, picked, workspaceId, run, sync],
  )

  // "Index everything": clear any restriction, then sync (add flow).
  const onPickerIndexAll = useCallback(
    () =>
      run(async () => {
        if (!picker) return
        await window.api.workspaces.setIndexDirs(workspaceId, picker.folder, [])
        if (!alive.current) return
        setPicker(null)
        await sync()
      }),
    [picker, workspaceId, run, sync],
  )

  // Close without changes (edit "Cancel" / governed "Close") — no re-sync.
  const onPickerDismiss = useCallback(() => {
    if (!operationPending.current) setPicker(null)
  }, [])

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
        aria-controls={bodyId}
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
        <div className="library__sync-body" id={bodyId}>
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
                    disabled={busy}
                    aria-label={t('library.editDirs')}
                    title={t('library.editDirs')}
                  >
                    <ListChecks size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="library__sync-item-remove"
                    onClick={() => setConfirmRemove(f)}
                    disabled={busy}
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
              <RefreshCw size={14} aria-hidden="true" className={syncing ? 'spin' : ''} />
              {syncing ? t('library.syncing') : t('library.syncNow')}
            </button>
          </div>
          {activeEvent && activeEvent.phase !== 'done' && activeEvent.phase !== 'failed' && (
            <div className="library__sync-progress" role="status">
              {t('library.syncProgress', {
                detail: activeEvent.detail ?? t('library.scanning'),
                imported: activeEvent.imported,
                reindexed: activeEvent.reindexed,
                missing: activeEvent.markedMissing,
              })}
            </div>
          )}
          {activeEvent?.phase === 'done' && (
            <div className="library__sync-progress library__sync-progress--done" role="status">
              {t('library.syncDone', {
                imported: activeEvent.imported,
                reindexed: activeEvent.reindexed,
                missing: activeEvent.markedMissing,
                unchanged: activeEvent.unchanged,
              })}
            </div>
          )}
          {activeEvent?.phase === 'failed' && (
            <div className="library__sync-progress library__sync-progress--failed" role="alert">
              {t('library.syncFailed', {
                detail: activeEvent.detail ?? t('library.syncFailedUnknown'),
              })}
            </div>
          )}
        </div>
      )}
      {error && !picker && (
        <div className="library__sync-progress library__sync-progress--failed" role="alert">
          {t('library.syncFailed', { detail: error.message })}
          {error.reload && (
            <button type="button" onClick={() => void reload()}>
              {t('common.retry')}
            </button>
          )}
        </div>
      )}
      {confirmRemove && (
        <ConfirmModal
          title={t('library.disconnectTitle')}
          body={t('library.disconnectBody', { folder: confirmRemove })}
          confirmLabel={t('library.disconnectConfirm')}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            const folder = confirmRemove
            setConfirmRemove(null)
            void onRemove(folder)
          }}
        />
      )}
      {picker && (
        <div className="dirpicker__backdrop">
          <div
            className="dirpicker"
            ref={pickerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={pickerTitleId}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && picker.mode === 'edit') {
                event.stopPropagation()
                onPickerDismiss()
              }
            }}
          >
            <h3 className="dirpicker__title" id={pickerTitleId}>
              {t('library.pickDirsTitle')}
            </h3>
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
                        disabled={pending}
                        onChange={() => togglePicked(d)}
                      />
                      <Folder size={14} aria-hidden="true" />
                      <span className="dirpicker__name">{d}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {!picker.governed && picked.size === 0 && (
              <p role="status">{t('library.pickDirsChooseOne')}</p>
            )}
            {error && <p role="alert">{t('library.syncFailed', { detail: error.message })}</p>}
            <div className="dirpicker__actions">
              {picker.governed ? (
                <button
                  type="button"
                  className="primary"
                  disabled={pending}
                  onClick={() => onPickerDismiss()}
                >
                  {t('library.pickDirsClose')}
                </button>
              ) : picker.mode === 'edit' ? (
                <>
                  <button type="button" disabled={pending} onClick={() => onPickerDismiss()}>
                    {t('library.pickDirsCancel')}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={pending || picked.size === 0}
                    onClick={() => void onPickerSave()}
                  >
                    {t('library.pickDirsSave')}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" disabled={pending} onClick={() => void onPickerIndexAll()}>
                    {t('library.pickDirsAll')}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={pending || picked.size === 0}
                    onClick={() => void onPickerSave()}
                  >
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

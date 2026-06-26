import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileX, Check, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import type { Document } from '@shared/documents'
import { useT } from '../i18n'

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
 * doc row + chunks).
 *
 * Deleting a whole synced folder used to produce an endless one-button-per-row
 * wall. Now the list is a collapsible, scroll-capped dropdown with a checkbox
 * per file, a select-all, and bulk Keep / Delete acting only on the checked
 * set. This still honours the "destructive confirmations" rule: every file is
 * spelled out and individually checkable, and nothing is selected by default —
 * select-all is an explicit act, not a hidden Remove-all.
 */
export function MissingDocsBanner({
  workspaceId,
  refreshKey,
  onChanged,
}: Props): JSX.Element | null {
  const t = useT()
  const [missing, setMissing] = useState<Document[]>([])
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)

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

  // Prune selection entries whose doc is gone (resolved here or elsewhere) so a
  // stale id can never sneak into a later bulk action.
  useEffect(() => {
    setSelected((prev) => {
      const live = new Set(missing.map((d) => d.id))
      const next = new Set<number>()
      for (const id of prev) if (live.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [missing])

  const allSelected = missing.length > 0 && selected.size === missing.length
  const someSelected = selected.size > 0 && !allSelected

  // Native checkboxes can't express "indeterminate" via props — set it on the node.
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  const toggleOne = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === missing.length ? new Set() : new Set(missing.map((d) => d.id)),
    )
  }, [missing])

  // Sequential, not Promise.all — the writes hit one sqlite connection and a
  // few hundred parallel invokes only add lock contention for no speedup.
  const keepIds = useCallback(
    async (ids: number[]) => {
      setBusy(true)
      try {
        for (const id of ids) await window.api.documents.keepMissing(id)
        await reload()
        onChanged()
      } finally {
        setBusy(false)
      }
    },
    [reload, onChanged],
  )

  const removeIds = useCallback(
    async (ids: number[]) => {
      setBusy(true)
      try {
        for (const id of ids) await window.api.documents.delete(id)
        await reload()
        onChanged()
      } finally {
        setBusy(false)
      }
    },
    [reload, onChanged],
  )

  if (missing.length === 0) return null
  const selCount = selected.size
  return (
    <div className="library__missing">
      <div className="library__missing-header">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>
          {missing.length === 1
            ? t('library.missingOne')
            : t('library.missingMany', { count: missing.length })}
        </span>
        <button
          type="button"
          className="library__missing-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" />
          )}
          {open ? t('library.missingHide') : t('library.missingShow')}
        </button>
      </div>

      <div className="library__missing-toolbar">
        <label className="library__missing-selectall">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={busy}
          />
          {t('library.selectAll')}
        </label>
        <span className="library__missing-count">
          {t('library.missingSelected', { count: selCount })}
        </span>
        <div className="library__missing-bulk">
          <button
            type="button"
            className="library__missing-action"
            onClick={() => void keepIds([...selected])}
            disabled={busy || selCount === 0}
            title={t('library.keepTitle')}
          >
            <Check size={14} aria-hidden="true" />
            {t('library.keepSelected', { count: selCount })}
          </button>
          <button
            type="button"
            className="library__missing-action library__missing-action--danger"
            onClick={() => void removeIds([...selected])}
            disabled={busy || selCount === 0}
            title={t('library.removeTitle')}
          >
            <Trash2 size={14} aria-hidden="true" />
            {t('library.removeSelected', { count: selCount })}
          </button>
        </div>
      </div>

      {open && (
        <ul className="library__missing-list">
          {missing.map((d) => (
            <li key={d.id} className="library__missing-item">
              <input
                type="checkbox"
                className="library__missing-check"
                checked={selected.has(d.id)}
                onChange={() => toggleOne(d.id)}
                disabled={busy}
                aria-label={d.title}
              />
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
                onClick={() => void keepIds([d.id])}
                disabled={busy}
                title={t('library.keepTitle')}
              >
                <Check size={14} aria-hidden="true" />
                {t('library.keep')}
              </button>
              <button
                type="button"
                className="library__missing-action library__missing-action--danger"
                onClick={() => void removeIds([d.id])}
                disabled={busy}
                title={t('library.removeTitle')}
              >
                <Trash2 size={14} aria-hidden="true" />
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { useT } from '../i18n'
import { useRef, useState } from 'react'
import { toTxt } from '@shared/subtitles'
import type { QueueRow } from './useTranscription'

async function saveRow(workspaceId: number, row: QueueRow): Promise<void> {
  const ext = row.segments.some((s) => s.speaker) ? 'md' : 'txt'
  await window.api.transcription.saveToWorkspace(workspaceId, toTxt(row.segments), ext)
}

/** Batch queue: one row per dropped file, processed sequentially by the resident
 *  worker. Per-row + bulk save-to-workspace. */
export function TranscriptList({
  rows,
  workspaceId,
  onClear,
}: {
  rows: QueueRow[]
  workspaceId: number | null
  onClear: () => void
}): JSX.Element {
  const t = useT()
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pending = useRef(new Set<string>())
  const savedRef = useRef(new Set<string>())
  const rowKey = (index: number): string => `${workspaceId}:${index}`
  const working = rows.some(
    (row) => row.phase === 'idle' || row.phase === 'decoding' || row.phase === 'transcribing',
  )
  const phaseLabel: Record<QueueRow['phase'], string> = {
    idle: t('tx.queued'),
    decoding: t('tx.decoding'),
    transcribing: t('tx.transcribing'),
    done: t('tx.complete'),
    error: t('common.error'),
  }

  const save = async (index: number): Promise<void> => {
    const key = rowKey(index)
    if (workspaceId == null || pending.current.has(key) || savedRef.current.has(key)) return
    pending.current.add(key)
    setSaving(new Set(pending.current))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    try {
      await saveRow(workspaceId, rows[index]!)
      savedRef.current.add(key)
      setSaved(new Set(savedRef.current))
    } catch (err) {
      setErrors((prev) => ({ ...prev, [key]: `${t('tx.saveFailed')} ${String(err)}` }))
    } finally {
      pending.current.delete(key)
      setSaving(new Set(pending.current))
    }
  }

  const saveAll = async (): Promise<void> => {
    if (workspaceId == null) return
    for (let i = 0; i < rows.length; i++)
      if (rows[i]!.phase === 'done' && rows[i]!.segments.length > 0) await save(i)
  }

  return (
    <div className="transcription__result">
      <div className="transcription__actions">
        <button
          className="transcription__btn"
          onClick={() => void saveAll()}
          disabled={
            workspaceId == null ||
            saving.size > 0 ||
            !rows.some(
              (r, i) => r.phase === 'done' && r.segments.length > 0 && !saved.has(rowKey(i)),
            )
          }
          title={workspaceId == null ? t('tx.needWorkspace') : undefined}
        >
          {t(saving.size > 0 ? 'tx.saving' : 'tx.saveAll')}
        </button>
        <button
          className="transcription__btn"
          onClick={onClear}
          disabled={working || saving.size > 0}
        >
          {t('tx.clear')}
        </button>
      </div>
      {workspaceId == null && <p className="transcription__status">{t('tx.needWorkspace')}</p>}
      {working && (
        <p className="transcription__status" role="status">
          {t('tx.queueActive')}
        </p>
      )}
      <ul className="transcription__list">
        {rows.map((r, i) => (
          <li key={i} className="transcription__row">
            <span className="transcription__row-name">{r.name}</span>
            <span className={`transcription__row-state is-${r.phase}`}>{phaseLabel[r.phase]}</span>
            {r.phase === 'done' && r.segments.length > 0 && (
              <button
                className="transcription__btn transcription__row-save"
                onClick={() => void save(i)}
                disabled={workspaceId == null || saving.has(rowKey(i)) || saved.has(rowKey(i))}
                title={workspaceId == null ? t('tx.needWorkspace') : undefined}
              >
                {t(
                  saving.has(rowKey(i))
                    ? 'tx.saving'
                    : saved.has(rowKey(i))
                      ? 'tx.saved'
                      : 'tx.save',
                )}
              </button>
            )}
            {r.phase === 'error' && (
              <span className="transcription__row-err">
                {r.error?.startsWith('tx.') ? t(r.error) : r.error}
              </span>
            )}
            {errors[rowKey(i)] && (
              <span className="transcription__row-err" role="alert">
                {errors[rowKey(i)]}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

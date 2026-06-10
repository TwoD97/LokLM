import { useT } from '../i18n'
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
  const phaseLabel: Record<QueueRow['phase'], string> = {
    idle: '…',
    decoding: t('tx.decoding'),
    transcribing: t('tx.transcribing'),
    done: '✓',
    error: '✕',
  }

  const saveAll = async (): Promise<void> => {
    if (workspaceId == null) return
    for (const r of rows)
      if (r.phase === 'done' && r.segments.length > 0) await saveRow(workspaceId, r)
  }

  return (
    <div className="transcription__result">
      <div className="transcription__actions">
        <button
          className="transcription__btn"
          onClick={() => void saveAll()}
          disabled={workspaceId == null || !rows.some((r) => r.phase === 'done')}
          title={workspaceId == null ? t('tx.needWorkspace') : undefined}
        >
          {t('tx.saveAll')}
        </button>
        <button className="transcription__btn" onClick={onClear}>
          {t('tx.clear')}
        </button>
      </div>
      <ul className="transcription__list">
        {rows.map((r, i) => (
          <li key={i} className="transcription__row">
            <span className="transcription__row-name">{r.name}</span>
            <span className={`transcription__row-state is-${r.phase}`}>{phaseLabel[r.phase]}</span>
            {r.phase === 'done' && r.segments.length > 0 && (
              <button
                className="transcription__btn transcription__row-save"
                onClick={() => void (workspaceId != null && saveRow(workspaceId, r))}
                disabled={workspaceId == null}
                title={workspaceId == null ? t('tx.needWorkspace') : undefined}
              >
                {t('tx.save')}
              </button>
            )}
            {r.phase === 'error' && <span className="transcription__row-err">{r.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

import { useT } from '../i18n'

/** Inline editors mapping each detected `Speaker N` to a user-chosen display
 *  name. Names flow into the rendered transcript + every export/save. */
export function SpeakerLabels({
  originals,
  names,
  onRename,
}: {
  originals: string[]
  names: Record<string, string>
  onRename: (orig: string, name: string) => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="transcription__speakers-edit">
      <span className="transcription__field">{t('tx.rename')}</span>
      {originals.map((orig) => (
        <input
          key={orig}
          className="transcription__speaker-input"
          value={names[orig] ?? orig}
          placeholder={orig}
          onChange={(e) => onRename(orig, e.target.value)}
        />
      ))}
    </div>
  )
}

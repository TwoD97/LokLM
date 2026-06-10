import type { TranscriptSegment } from '@shared/transcription'

export function formatTimestamp(sec: number, mode: 'srt' | 'vtt'): string {
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const millis = ms % 1000
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  const sep = mode === 'srt' ? ',' : '.'
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(millis, 3)}`
}

function line(s: TranscriptSegment): string {
  return s.speaker ? `${s.speaker}: ${s.text}` : s.text
}

export function toTxt(segments: TranscriptSegment[]): string {
  return segments.map(line).join('\n')
}

export function toSrt(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${formatTimestamp(s.start, 'srt')} --> ${formatTimestamp(s.end, 'srt')}\n${line(s)}\n`,
    )
    .join('\n')
}

export function toVtt(segments: TranscriptSegment[]): string {
  const body = segments
    .map(
      (s) =>
        `${formatTimestamp(s.start, 'vtt')} --> ${formatTimestamp(s.end, 'vtt')}\n${line(s)}\n`,
    )
    .join('\n')
  return `WEBVTT\n\n${body}`
}

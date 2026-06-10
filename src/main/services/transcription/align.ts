import type { TranscriptSegment } from '@shared/transcription'

export interface DiarTurn {
  start: number
  end: number
  /** 0-based speaker index from the diarizer. */
  speaker: number
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

/**
 * Assign each transcript segment a `Speaker N` label by the diarization turn it
 * overlaps most. Segments that overlap no turn fall back to the nearest turn by
 * midpoint distance. With zero turns, segments are returned unlabeled.
 */
export function assignSpeakers(
  segments: TranscriptSegment[],
  turns: DiarTurn[],
): TranscriptSegment[] {
  if (turns.length === 0) return segments.map((s) => ({ ...s }))
  return segments.map((s) => {
    let best = turns[0]!
    let bestOverlap = -1
    for (const t of turns) {
      const ov = overlap(s.start, s.end, t.start, t.end)
      if (ov > bestOverlap) {
        bestOverlap = ov
        best = t
      }
    }
    if (bestOverlap <= 0) {
      const mid = (s.start + s.end) / 2
      best = turns.reduce((a, b) =>
        Math.abs((a.start + a.end) / 2 - mid) <= Math.abs((b.start + b.end) / 2 - mid) ? a : b,
      )
    }
    return { ...s, speaker: `Speaker ${best.speaker + 1}` }
  })
}

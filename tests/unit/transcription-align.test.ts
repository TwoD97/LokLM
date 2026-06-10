import { describe, it, expect } from 'vitest'
import { assignSpeakers, type DiarTurn } from '@main/services/transcription/align'
import type { TranscriptSegment } from '@shared/transcription'

const seg = (start: number, end: number, text: string): TranscriptSegment => ({ start, end, text })

describe('assignSpeakers', () => {
  it('labels each segment by the max-overlap turn', () => {
    const segments = [seg(0, 2, 'hi'), seg(2, 4, 'there'), seg(4, 6, 'bye')]
    const turns: DiarTurn[] = [
      { start: 0, end: 2.5, speaker: 0 },
      { start: 2.5, end: 6, speaker: 1 },
    ]
    const out = assignSpeakers(segments, turns)
    expect(out.map((s) => s.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 2'])
  })

  it('handles a segment overlapping two turns by picking the larger overlap', () => {
    const segments = [seg(0, 4, 'split')]
    const turns: DiarTurn[] = [
      { start: 0, end: 1, speaker: 0 },
      { start: 1, end: 4, speaker: 1 },
    ]
    expect(assignSpeakers(segments, turns)[0]!.speaker).toBe('Speaker 2')
  })

  it('leaves speaker undefined when there are no turns', () => {
    const segments = [seg(0, 2, 'lonely')]
    expect(assignSpeakers(segments, [])[0]!.speaker).toBeUndefined()
  })

  it('falls back to the nearest turn when a segment overlaps none', () => {
    const segments = [seg(10, 11, 'gap')]
    const turns: DiarTurn[] = [{ start: 0, end: 5, speaker: 3 }]
    expect(assignSpeakers(segments, turns)[0]!.speaker).toBe('Speaker 4')
  })
})

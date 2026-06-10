import { describe, it, expect } from 'vitest'
import {
  toTxt,
  toSrt,
  toVtt,
  formatTimestamp,
  parseClock,
} from '@main/services/transcription/subtitles'
import type { TranscriptSegment } from '@shared/transcription'

const segs: TranscriptSegment[] = [
  { start: 0, end: 1.5, text: 'Hello world', speaker: 'Speaker 1' },
  { start: 1.5, end: 3, text: 'Goodbye', speaker: 'Speaker 2' },
]

describe('subtitles', () => {
  it('formats srt timestamps with comma millis', () => {
    expect(formatTimestamp(3661.25, 'srt')).toBe('01:01:01,250')
  })
  it('formats vtt timestamps with dot millis', () => {
    expect(formatTimestamp(3661.25, 'vtt')).toBe('01:01:01.250')
  })
  it('renders plain text with speaker labels', () => {
    expect(toTxt(segs)).toBe('Speaker 1: Hello world\nSpeaker 2: Goodbye')
  })
  it('renders plain text without labels when undiarized', () => {
    expect(toTxt([{ start: 0, end: 1, text: 'just text' }])).toBe('just text')
  })
  it('renders srt blocks', () => {
    expect(toSrt(segs)).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nSpeaker 1: Hello world\n\n' +
        '2\n00:00:01,500 --> 00:00:03,000\nSpeaker 2: Goodbye\n',
    )
  })
  it('renders a WEBVTT header', () => {
    expect(toVtt(segs).startsWith('WEBVTT\n\n')).toBe(true)
  })
  it('parses HH:MM:SS.mmm and HH:MM:SS,mmm clocks to seconds', () => {
    expect(parseClock('00:00:07.600')).toBeCloseTo(7.6)
    expect(parseClock('01:01:01,250')).toBeCloseTo(3661.25)
    expect(Number.isNaN(parseClock('nonsense'))).toBe(true)
  })
})

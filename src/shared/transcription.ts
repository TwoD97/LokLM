// Types shared across main, preload, and renderer for the transcription feature.
// Kept dependency-free so the preload can import it without pulling in main code.

export type TranscriptionTask = 'transcribe' | 'translate'
export type TranscriptionLanguage = 'auto' | 'de' | 'en'
export type WhisperModelId = 'tiny' | 'base' | 'small' | 'medium'

export interface TranscriptionOptions {
  task: TranscriptionTask
  language: TranscriptionLanguage
  model: WhisperModelId
  diarize: boolean
  /** Explicit speaker count; omit for auto-detect. */
  speakers?: number
  /** Use GPU (Vulkan/Metal auto-detected by the binding) if available. */
  gpu?: boolean
}

export interface TranscriptSegment {
  /** seconds */
  start: number
  /** seconds */
  end: number
  text: string
  /** 'Speaker 1' … present only when diarized. */
  speaker?: string
}

export type TranscriptionEvent =
  | { type: 'segment'; segment: TranscriptSegment }
  | { type: 'progress'; stage: 'transcribe' | 'diarize'; done: number; total: number }
  | { type: 'done'; segments: TranscriptSegment[] }
  | { type: 'error'; message: string }

/** Returned by the stage-commit IPC; the audioId keys the temp PCM file. */
export interface StagedAudio {
  audioId: string
  durationSec: number
}

export interface WhisperModelStatus {
  id: WhisperModelId
  present: boolean
  bytes: number
  downloading: boolean
}

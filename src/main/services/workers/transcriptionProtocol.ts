// Wire protocol between main and the transcriptionWorker utilityProcess.
// whisper.cpp (via @kutalia/whisper-node-addon, prebuilt) runs there, isolated
// from the models + documents workers. Conventions mirror documentsProtocol:
// numeric id per request, one response per id; push events (no id) carry
// progress + logs.
//
// The kutalia binding loads the model per call and returns the whole transcript
// at once (no per-segment streaming), so the worker returns segments in the
// response result and pushes coarse progress (0..100) during the run.

import type {
  TranscriptionTask,
  TranscriptionLanguage,
  TranscriptSegment,
} from '@shared/transcription'

export interface WhisperTranscribePayload {
  streamId: string
  /** temp file of little-endian Float32, 16 kHz mono PCM */
  audioPath: string
  modelPath: string
  task: TranscriptionTask
  language: TranscriptionLanguage
  threads: number
  gpu: boolean
}

export interface WhisperTranscribeResult {
  segments: TranscriptSegment[]
}

export type TxWorkerRequest =
  | { id: number; op: 'whisper.transcribe'; payload: WhisperTranscribePayload }
  | { id: number; op: 'shutdown' }

export type TxWorkerResponse<T = unknown> =
  | { id: number; ok: true; result: T }
  | { id: number; ok: false; error: string }

export type TxWorkerPush =
  | { ev: 'progress'; streamId: string; done: number; total: number }
  | { ev: 'log'; level: 'info' | 'warn' | 'error'; message: string }

export type TxWorkerMessage = TxWorkerResponse | TxWorkerPush

// Wire protocol for the diarizationWorker (sherpa-onnx-node). Lazily spawned
// only when the user enables "Identify speakers". Mirrors transcriptionProtocol:
// numeric id per request, one response per id; push events carry progress.
//
// The native OfflineSpeakerDiarization keeps the seg + embedding models resident
// after `diar.load`; `diar.run` reuses them and only swaps the clustering config
// when the requested speaker count changes.

export interface DiarLoadPayload {
  segmentationPath: string
  embeddingPath: string
  threads: number
}

export interface DiarRunPayload {
  streamId: string
  /** temp file of little-endian Float32, 16 kHz mono PCM */
  audioPath: string
  /** omit/undefined = auto-detect speaker count */
  speakers?: number
}

export interface DiarTurnDto {
  start: number
  end: number
  /** 0-based speaker index */
  speaker: number
}

export type DiarWorkerRequest =
  | { id: number; op: 'diar.load'; payload: DiarLoadPayload }
  | { id: number; op: 'diar.run'; payload: DiarRunPayload }
  | { id: number; op: 'shutdown' }

export type DiarWorkerResponse<T = unknown> =
  | { id: number; ok: true; result: T }
  | { id: number; ok: false; error: string }

export type DiarWorkerPush =
  | { ev: 'progress'; streamId: string; done: number; total: number }
  | { ev: 'log'; level: 'info' | 'warn' | 'error'; message: string }

export type DiarWorkerMessage = DiarWorkerResponse | DiarWorkerPush

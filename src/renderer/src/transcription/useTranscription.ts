import { useCallback, useRef, useState } from 'react'
import type { TranscriptionOptions, TranscriptSegment } from '@shared/transcription'
import { decodeToMono16k } from '../audio/decode'

const CHUNK = 4 * 1024 * 1024 // 4 MB IPC chunks

export type TxPhase = 'idle' | 'decoding' | 'transcribing' | 'done' | 'error'

export interface TxState {
  phase: TxPhase
  segments: TranscriptSegment[]
  progress: { stage: 'transcribe' | 'diarize'; done: number; total: number } | null
  error: string | null
}

export interface QueueRow {
  name: string
  phase: TxPhase
  segments: TranscriptSegment[]
  error: string | null
}

const IDLE: TxState = { phase: 'idle', segments: [], progress: null, error: null }

let streamSeq = 0

/** Stage decoded PCM to a temp file, run transcription, resolve with the final
 *  segments. Shared by the single-file and batch paths. */
async function runOne(
  bytes: ArrayBuffer,
  opts: TranscriptionOptions,
  onEvent: (phase: TxPhase, partial: TranscriptSegment[], progress: TxState['progress']) => void,
  onStart?: (streamId: string) => void,
): Promise<TranscriptSegment[]> {
  let decoded
  try {
    decoded = await decodeToMono16k(bytes)
  } catch {
    throw new Error('tx.decodeError')
  }
  onEvent('transcribing', [], null)

  const audioId = await window.api.transcription.stageBegin()
  for (let off = 0; off < decoded.pcm.byteLength; off += CHUNK) {
    await window.api.transcription.stageChunk(audioId, decoded.pcm.subarray(off, off + CHUNK))
  }
  await window.api.transcription.stageCommit(audioId, decoded.durationSec)

  const streamId = `tx-${++streamSeq}`
  onStart?.(streamId)
  const acc: TranscriptSegment[] = []
  return new Promise<TranscriptSegment[]>((resolve, reject) => {
    const off = window.api.transcription.onEvent(streamId, (ev) => {
      if (ev.type === 'segment') {
        acc.push(ev.segment)
        onEvent('transcribing', [...acc], null)
      } else if (ev.type === 'progress') {
        onEvent('transcribing', [...acc], { stage: ev.stage, done: ev.done, total: ev.total })
      } else if (ev.type === 'done') {
        off()
        resolve(ev.segments)
      } else if (ev.type === 'error') {
        off()
        reject(new Error(ev.message))
      }
    })
    void window.api.transcription.run(streamId, audioId, opts).catch((err) => {
      off()
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

const setRow = (q: QueueRow[], i: number, patch: Partial<QueueRow>): QueueRow[] =>
  q.map((r, j) => (j === i ? { ...r, ...patch } : r))

export function useTranscription(): {
  state: TxState
  queue: QueueRow[]
  transcribe: (bytes: ArrayBuffer, opts: TranscriptionOptions) => Promise<void>
  transcribeMany: (files: File[], opts: TranscriptionOptions) => Promise<void>
  cancel: () => void
  reset: () => void
} {
  const [state, setState] = useState<TxState>(IDLE)
  const [queue, setQueue] = useState<QueueRow[]>([])
  const streamIdRef = useRef<string | null>(null)

  const transcribe = useCallback(async (bytes: ArrayBuffer, opts: TranscriptionOptions) => {
    setQueue([])
    setState({ ...IDLE, phase: 'decoding' })
    try {
      const segments = await runOne(
        bytes,
        opts,
        (phase, partial, progress) =>
          setState((s) => ({ ...s, phase, segments: partial, progress })),
        (id) => (streamIdRef.current = id),
      )
      setState({ phase: 'done', segments, progress: null, error: null })
    } catch (err) {
      setState((s) => ({
        ...s,
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }, [])

  const transcribeMany = useCallback(async (files: File[], opts: TranscriptionOptions) => {
    setState(IDLE)
    setQueue(files.map((f) => ({ name: f.name, phase: 'decoding', segments: [], error: null })))
    for (let i = 0; i < files.length; i++) {
      setQueue((q) => setRow(q, i, { phase: 'decoding' }))
      try {
        const bytes = await files[i]!.arrayBuffer()
        const segments = await runOne(
          bytes,
          opts,
          (phase) => setQueue((q) => setRow(q, i, { phase })),
          (id) => (streamIdRef.current = id),
        )
        setQueue((q) => setRow(q, i, { phase: 'done', segments }))
      } catch (err) {
        setQueue((q) =>
          setRow(q, i, { phase: 'error', error: err instanceof Error ? err.message : String(err) }),
        )
      }
    }
  }, [])

  const cancel = useCallback(() => {
    if (streamIdRef.current) void window.api.transcription.cancel(streamIdRef.current)
  }, [])

  const reset = useCallback(() => {
    setState(IDLE)
    setQueue([])
  }, [])

  return { state, queue, transcribe, transcribeMany, cancel, reset }
}

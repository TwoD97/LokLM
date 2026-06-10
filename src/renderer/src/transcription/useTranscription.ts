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

const IDLE: TxState = { phase: 'idle', segments: [], progress: null, error: null }

let streamSeq = 0

/** Stage decoded PCM to a temp file, run transcription, resolve with the final
 *  segments. Shared by the single-file and (later) batch paths. */
async function runOne(
  bytes: ArrayBuffer,
  opts: TranscriptionOptions,
  onEvent: (phase: TxPhase, partial: TranscriptSegment[], progress: TxState['progress']) => void,
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

export function useTranscription(): {
  state: TxState
  transcribe: (bytes: ArrayBuffer, opts: TranscriptionOptions) => Promise<void>
  cancel: () => void
  reset: () => void
} {
  const [state, setState] = useState<TxState>(IDLE)
  const streamIdRef = useRef<string | null>(null)

  const transcribe = useCallback(async (bytes: ArrayBuffer, opts: TranscriptionOptions) => {
    setState({ ...IDLE, phase: 'decoding' })
    streamIdRef.current = `tx-${streamSeq + 1}`
    try {
      const segments = await runOne(bytes, opts, (phase, partial, progress) =>
        setState((s) => ({ ...s, phase, segments: partial, progress })),
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

  const cancel = useCallback(() => {
    if (streamIdRef.current) void window.api.transcription.cancel(streamIdRef.current)
  }, [])

  const reset = useCallback(() => setState(IDLE), [])

  return { state, transcribe, cancel, reset }
}

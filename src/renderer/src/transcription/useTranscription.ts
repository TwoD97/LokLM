import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranscriptionOptions, TranscriptSegment } from '@shared/transcription'
import { decodeToMono16k } from '../audio/decode'
import { useGeneration } from '../generation/GenerationContext'

const CHUNK = 4 * 1024 * 1024 // 4 MB IPC chunks

export type TxPhase = 'idle' | 'decoding' | 'transcribing' | 'done' | 'error' | 'cancelled'

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
  signal: AbortSignal,
): Promise<TranscriptSegment[]> {
  let decoded
  try {
    decoded = await decodeToMono16k(bytes)
  } catch {
    signal.throwIfAborted()
    throw new Error('tx.decodeError')
  }
  signal.throwIfAborted()
  onEvent('transcribing', [], null)

  let audioId: string | null = null
  let handedOff = false
  try {
    audioId = await window.api.transcription.stageBegin()
    signal.throwIfAborted()
    for (let off = 0; off < decoded.pcm.byteLength; off += CHUNK) {
      await window.api.transcription.stageChunk(audioId, decoded.pcm.subarray(off, off + CHUNK))
      signal.throwIfAborted()
    }
    await window.api.transcription.stageCommit(audioId, decoded.durationSec)
    signal.throwIfAborted()

    const streamId = `tx-${++streamSeq}`
    const acc: TranscriptSegment[] = []
    let result: TranscriptSegment[] | null = null
    let failure: string | null = null
    const off = window.api.transcription.onEvent(streamId, (ev) => {
      if (signal.aborted) return
      if (ev.type === 'segment') {
        acc.push(ev.segment)
        onEvent('transcribing', [...acc], null)
      } else if (ev.type === 'progress') {
        onEvent('transcribing', [...acc], { stage: ev.stage, done: ev.done, total: ev.total })
      } else if (ev.type === 'done') {
        result = ev.segments
      } else if (ev.type === 'error') {
        failure = ev.message
      }
    })
    const abort = (): void => {
      off()
      void window.api.transcription.cancel(streamId).catch(() => undefined)
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      handedOff = true
      // The run IPC settles after its terminal event and native cleanup. Keep
      // the batch pending until then; cancellation cannot interrupt native PCM reads.
      await window.api.transcription.run(streamId, audioId, opts)
      signal.throwIfAborted()
      if (failure) throw new Error(failure)
      if (result == null) throw new Error('Transcription ended without a result.')
      return result
    } catch (error) {
      // Admission can reject before the service takes ownership. Its discard
      // contract refuses to delete audio that is still being read by a worker.
      await window.api.transcription.discardStage(audioId).catch(() => undefined)
      throw error
    } finally {
      off()
      signal.removeEventListener('abort', abort)
    }
  } finally {
    if (audioId && !handedOff)
      await window.api.transcription.discardStage(audioId).catch(() => undefined)
  }
}

const setRow = (q: QueueRow[], i: number, patch: Partial<QueueRow>): QueueRow[] =>
  q.map((r, j) => (j === i ? { ...r, ...patch } : r))

export function useTranscription(): {
  state: TxState
  queue: QueueRow[]
  cancelling: boolean
  transcribe: (bytes: ArrayBuffer, opts: TranscriptionOptions) => Promise<void>
  transcribeMany: (files: File[], opts: TranscriptionOptions) => Promise<void>
  cancel: () => void
  reset: () => void
} {
  const [state, setState] = useState<TxState>(IDLE)
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [cancelling, setCancelling] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const inFlight = useRef(false)
  const { begin: beginGeneration } = useGeneration()
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      controller.current?.abort()
    }
  }, [])

  const transcribe = useCallback(
    async (bytes: ArrayBuffer, opts: TranscriptionOptions) => {
      if (inFlight.current || !alive.current) return
      inFlight.current = true
      const request = new AbortController()
      controller.current = request
      setCancelling(false)
      setQueue([])
      setState({ ...IDLE, phase: 'decoding' })
      const endGeneration = beginGeneration('transcription')
      try {
        const segments = await runOne(
          bytes,
          opts,
          (phase, partial, progress) => {
            if (alive.current) setState((s) => ({ ...s, phase, segments: partial, progress }))
          },
          request.signal,
        )
        if (alive.current) setState({ phase: 'done', segments, progress: null, error: null })
      } catch (err) {
        if (alive.current)
          setState((s) => ({
            ...s,
            phase: request.signal.aborted ? 'cancelled' : 'error',
            error: request.signal.aborted
              ? 'tx.cancelled'
              : err instanceof Error
                ? err.message
                : String(err),
          }))
      } finally {
        inFlight.current = false
        controller.current = null
        if (alive.current) setCancelling(false)
        endGeneration()
      }
    },
    [beginGeneration],
  )

  const transcribeMany = useCallback(
    async (files: File[], opts: TranscriptionOptions) => {
      if (inFlight.current || !alive.current) return
      inFlight.current = true
      const request = new AbortController()
      controller.current = request
      setCancelling(false)
      setState(IDLE)
      setQueue(files.map((f) => ({ name: f.name, phase: 'idle', segments: [], error: null })))
      // One job for the whole batch — files are transcribed sequentially on the
      // single Whisper worker, so the chip shows "Transcribing" until the batch
      // finishes rather than flickering per file.
      const endGeneration = beginGeneration('transcription')
      try {
        for (let i = 0; i < files.length; i++) {
          if (request.signal.aborted) break
          setQueue((q) => setRow(q, i, { phase: 'decoding' }))
          try {
            const bytes = await files[i]!.arrayBuffer()
            request.signal.throwIfAborted()
            const segments = await runOne(
              bytes,
              opts,
              (phase) => {
                if (alive.current) setQueue((q) => setRow(q, i, { phase }))
              },
              request.signal,
            )
            if (alive.current) setQueue((q) => setRow(q, i, { phase: 'done', segments }))
          } catch (err) {
            if (alive.current)
              setQueue((q) =>
                setRow(q, i, {
                  phase: request.signal.aborted ? 'cancelled' : 'error',
                  error: request.signal.aborted
                    ? null
                    : err instanceof Error
                      ? err.message
                      : String(err),
                }),
              )
          }
        }
      } finally {
        inFlight.current = false
        controller.current = null
        if (alive.current) {
          setCancelling(false)
          if (request.signal.aborted)
            setQueue((rows) =>
              rows.map((row) => (row.phase === 'idle' ? { ...row, phase: 'cancelled' } : row)),
            )
        }
        endGeneration()
      }
    },
    [beginGeneration],
  )

  const cancel = useCallback(() => {
    if (!controller.current || controller.current.signal.aborted) return
    setCancelling(true)
    controller.current.abort()
  }, [])

  const reset = useCallback(() => {
    if (inFlight.current) return
    setState(IDLE)
    setQueue([])
  }, [])

  return { state, queue, cancelling, transcribe, transcribeMany, cancel, reset }
}

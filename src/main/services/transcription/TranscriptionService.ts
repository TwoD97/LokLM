import { app } from 'electron'
import { join } from 'node:path'
import { cpus } from 'node:os'
import type {
  TranscriptionOptions,
  TranscriptSegment,
  TranscriptionEvent,
} from '@shared/transcription'
import { TranscriptionWorkerClient } from '../workers/TranscriptionWorkerClient'
import { DiarizationWorkerClient } from '../workers/DiarizationWorkerClient'
import { AudioStager } from './AudioStager'
import { assignSpeakers } from './align'
import { resolveWhisperModel, getDiarizationModelPaths } from './paths'

export { AudioStager } from './AudioStager'

export class TranscriptionService {
  readonly stager: AudioStager
  private readonly aborts = new Map<string, AbortController>()
  private readonly runs = new Map<string, Promise<void>>()
  private readonly audioOwners = new Set<string>()
  private resetting: Promise<void> | null = null
  constructor(
    private readonly whisper: TranscriptionWorkerClient,
    private readonly diar: DiarizationWorkerClient,
    stageDir?: string,
  ) {
    this.stager = new AudioStager(stageDir ?? join(app.getPath('temp'), 'loklm-audio'))
  }

  /** The binding cannot abort a single native call. Suppress its progress and
   * result, then send an empty terminal event so the renderer can finish. */
  cancel(streamId: string): void {
    this.aborts.get(streamId)?.abort()
  }

  /** Vault boundaries terminate native audio work instead of retaining a prior
   * session's PCM/model memory. Overlapping lock/reset hooks share this drain. */
  resetSession(): Promise<void> {
    if (this.resetting) return this.resetting
    for (const controller of this.aborts.values()) controller.abort()
    const active = [...this.runs.values()]
    this.resetting = (async () => {
      try {
        await Promise.all([this.whisper.reset(), this.diar.reset()])
        await Promise.allSettled(active)
      } finally {
        await this.stager.cleanupAll()
      }
    })().finally(() => {
      this.resetting = null
    })
    return this.resetting
  }

  /** Orchestrate transcribe → (diarize → align), forwarding events to `emit`.
   *  Resolves when a done/error event has been emitted. */
  run(
    streamId: string,
    audioId: string,
    opts: TranscriptionOptions,
    emit: (ev: TranscriptionEvent) => void,
  ): Promise<void> {
    if (this.resetting) return Promise.reject(new Error('Transcription session is closing.'))
    if (this.aborts.has(streamId))
      return Promise.reject(new Error('Transcription stream is already running.'))
    if (this.audioOwners.has(audioId))
      return Promise.reject(new Error('Audio is already being transcribed.'))
    const ctrl = new AbortController()
    this.aborts.set(streamId, ctrl)
    this.audioOwners.add(audioId)
    const run = this.performRun(streamId, audioId, opts, emit, ctrl).finally(() => {
      if (this.runs.get(streamId) === run) this.runs.delete(streamId)
    })
    this.runs.set(streamId, run)
    return run
  }

  private async performRun(
    streamId: string,
    audioId: string,
    opts: TranscriptionOptions,
    emit: (ev: TranscriptionEvent) => void,
    ctrl: AbortController,
  ): Promise<void> {
    const threads = Math.max(1, cpus().length - 1)
    const progress = (stage: 'transcribe' | 'diarize', done: number, total: number): void => {
      if (!ctrl.signal.aborted) emit({ type: 'progress', stage, done, total })
    }
    try {
      const audioPath = this.stager.pathFor(audioId)
      const modelPath = resolveWhisperModel(opts.model)
      if (!modelPath) throw new Error(`whisper model '${opts.model}' not found — download it first`)

      const offP = this.whisper.registerProgress(streamId, (done, total) =>
        progress('transcribe', done, total),
      )
      let segments: TranscriptSegment[]
      try {
        ;({ segments } = await this.whisper.transcribe(
          {
            streamId,
            audioPath,
            modelPath,
            task: opts.task,
            language: opts.language,
            threads,
            gpu: opts.gpu ?? false,
          },
          ctrl.signal,
        ))
      } finally {
        offP()
      }

      if (ctrl.signal.aborted) {
        emit({ type: 'done', segments: [] })
        return
      }
      for (const s of segments) emit({ type: 'segment', segment: s })

      if (opts.diarize && segments.length > 0) {
        try {
          const m = getDiarizationModelPaths()
          await this.diar.ensureLoaded(
            {
              segmentationPath: m.segmentation,
              embeddingPath: m.embedding,
              threads,
            },
            ctrl.signal,
          )
          if (ctrl.signal.aborted) {
            emit({ type: 'done', segments: [] })
            return
          }
          const offD = this.diar.registerProgress(streamId, (done, total) =>
            progress('diarize', done, total),
          )
          try {
            const { turns } = await this.diar.diarize(
              {
                streamId,
                audioPath,
                ...(opts.speakers ? { speakers: opts.speakers } : {}),
              },
              ctrl.signal,
            )
            if (!ctrl.signal.aborted) segments = assignSpeakers(segments, turns)
          } finally {
            offD()
          }
        } catch (err) {
          // Diarization is best-effort; keep the transcript.
          if (!ctrl.signal.aborted) console.warn('[transcription] diarization failed:', err)
        }
      }
      emit({ type: 'done', segments: ctrl.signal.aborted ? [] : segments })
    } catch (err) {
      if (ctrl.signal.aborted) emit({ type: 'done', segments: [] })
      else emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      if (this.aborts.get(streamId) === ctrl) this.aborts.delete(streamId)
      this.audioOwners.delete(audioId)
      try {
        await this.stager.cleanup(audioId)
      } catch (error) {
        // A terminal event has already been emitted. Report cleanup failure
        // without replacing a completed transcript with a second UI error.
        console.warn('[transcription] audio cleanup failed:', error)
      }
    }
  }
}

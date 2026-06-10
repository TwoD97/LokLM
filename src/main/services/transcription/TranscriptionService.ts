import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
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
  constructor(
    private readonly whisper: TranscriptionWorkerClient,
    private readonly diar: DiarizationWorkerClient,
    stageDir?: string,
  ) {
    this.stager = new AudioStager(stageDir ?? join(app.getPath('temp'), 'loklm-audio'))
  }

  /** Best-effort: the whisper binding can't abort mid-run, so this stops the
   *  service from emitting further events and skips diarization. */
  cancel(streamId: string): void {
    this.aborts.get(streamId)?.abort()
  }

  /** Orchestrate transcribe → (diarize → align), forwarding events to `emit`.
   *  Resolves when a done/error event has been emitted. */
  async run(
    streamId: string,
    audioId: string,
    opts: TranscriptionOptions,
    emit: (ev: TranscriptionEvent) => void,
  ): Promise<void> {
    const ctrl = new AbortController()
    this.aborts.set(streamId, ctrl)
    const threads = Math.max(1, cpus().length - 1)
    try {
      const audioPath = this.stager.pathFor(audioId)
      const modelPath = resolveWhisperModel(opts.model)
      if (!modelPath) throw new Error(`whisper model '${opts.model}' not found — download it first`)

      const offP = this.whisper.registerProgress(streamId, (done, total) =>
        emit({ type: 'progress', stage: 'transcribe', done, total }),
      )
      let segments: TranscriptSegment[]
      try {
        ;({ segments } = await this.whisper.transcribe({
          streamId,
          audioPath,
          modelPath,
          task: opts.task,
          language: opts.language,
          threads,
          gpu: false,
        }))
      } finally {
        offP()
      }

      if (ctrl.signal.aborted) {
        emit({ type: 'done', segments })
        return
      }
      for (const s of segments) emit({ type: 'segment', segment: s })

      if (opts.diarize && segments.length > 0) {
        try {
          const m = getDiarizationModelPaths()
          await this.diar.ensureLoaded({
            segmentationPath: m.segmentation,
            embeddingPath: m.embedding,
            threads,
          })
          const offD = this.diar.registerProgress(streamId, (done, total) =>
            emit({ type: 'progress', stage: 'diarize', done, total }),
          )
          try {
            const { turns } = await this.diar.diarize({
              streamId,
              audioPath,
              ...(opts.speakers ? { speakers: opts.speakers } : {}),
            })
            if (!ctrl.signal.aborted) segments = assignSpeakers(segments, turns)
          } finally {
            offD()
          }
        } catch (err) {
          // Diarization is best-effort; keep the transcript.
          // eslint-disable-next-line no-console
          console.warn('[transcription] diarization failed:', err)
        }
      }
      emit({ type: 'done', segments })
    } catch (err) {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      this.aborts.delete(streamId)
      this.stager.cleanup(audioId)
    }
  }

  /** Write a transcript to a temp file for save-to-workspace. Returns the path. */
  writeTranscriptFile(text: string, ext: 'txt' | 'md'): string {
    const dir = join(app.getPath('temp'), 'loklm-transcripts')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `transcript-${Date.now()}.${ext}`)
    writeFileSync(path, text, 'utf8')
    return path
  }
}

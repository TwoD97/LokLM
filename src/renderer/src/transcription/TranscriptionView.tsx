import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useTranscription } from './useTranscription'
import { SpeakerLabels } from './SpeakerLabels'
import { TranscriptList } from './TranscriptList'
import { toTxt, toSrt, toVtt } from '@shared/subtitles'
import type { TranscriptionOptions, TranscriptSegment } from '@shared/transcription'
import './transcription.css'

/** Apply user speaker renames to a segment list (for display + export + save). */
function applyNames(
  segments: TranscriptSegment[],
  names: Record<string, string>,
): TranscriptSegment[] {
  return segments.map((s) =>
    s.speaker && names[s.speaker] ? { ...s, speaker: names[s.speaker]! } : s,
  )
}

/** Show a speaker label only when it changes from the previous segment, so a
 *  run of consecutive lines from one speaker isn't labelled on every line. */
function collapseSpeakers(segments: TranscriptSegment[]): TranscriptSegment[] {
  let prev: string | undefined
  return segments.map((s) => {
    const show = s.speaker && s.speaker !== prev
    prev = s.speaker
    // Keep the segment (with its speaker) when the label should show; otherwise
    // return a copy without the speaker key (omit, not undefined, for
    // exactOptionalPropertyTypes).
    return show ? s : { start: s.start, end: s.end, text: s.text }
  })
}

export function TranscriptionView({ workspaceId }: { workspaceId: number | null }): JSX.Element {
  const t = useT()
  const { state, queue, transcribe, transcribeMany, cancel, reset } = useTranscription()
  const [task, setTask] = useState<TranscriptionOptions['task']>('transcribe')
  const [language, setLanguage] = useState<TranscriptionOptions['language']>('auto')
  const [diarize, setDiarize] = useState(false)
  const [speakers, setSpeakers] = useState('')
  const [over, setOver] = useState(false)
  const [saved, setSaved] = useState(false)
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  // Seed the rename map from the distinct speakers once a diarized run finishes.
  useEffect(() => {
    if (state.phase !== 'done') return
    const distinct = [...new Set(state.segments.map((s) => s.speaker).filter(Boolean))] as string[]
    setSpeakerNames((prev) => {
      const next: Record<string, string> = {}
      for (const sp of distinct) next[sp] = prev[sp] ?? sp
      return next
    })
  }, [state.phase, state.segments])

  const opts: TranscriptionOptions = useMemo(
    () => ({
      task,
      language,
      // Model is hardcoded to the bundled base for v1; size choice will move to
      // install profiles. GPU is auto: the worker attempts Vulkan/Metal and
      // falls back to CPU on its own.
      model: 'base',
      gpu: true,
      diarize,
      ...(diarize && speakers.trim() !== '' ? { speakers: Math.max(1, Number(speakers)) } : {}),
    }),
    [task, language, diarize, speakers],
  )

  const onFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setSaved(false)
      if (files.length === 1) await transcribe(await files[0]!.arrayBuffer(), opts)
      else await transcribeMany(files, opts)
    },
    [transcribe, transcribeMany, opts],
  )
  const onFile = useCallback(
    (file: File | undefined) => void onFiles(file ? [file] : []),
    [onFiles],
  )

  const { recording, seconds, recordError, toggleRecord } = useRecorder((blob) => onFile(blob))

  const distinctSpeakers = useMemo(
    () => [...new Set(state.segments.map((s) => s.speaker).filter(Boolean))] as string[],
    [state.segments],
  )
  // renamed (full per-segment speakers) → collapsed (label only on change).
  const display = useMemo(
    () => collapseSpeakers(applyNames(state.segments, speakerNames)),
    [state.segments, speakerNames],
  )

  const onSave = useCallback(async () => {
    if (workspaceId == null) return
    const ext = distinctSpeakers.length > 0 ? 'md' : 'txt'
    await window.api.transcription.saveToWorkspace(workspaceId, toTxt(display), ext)
    setSaved(true)
  }, [workspaceId, display, distinctSpeakers])

  const onExport = useCallback(
    (fmt: 'txt' | 'srt' | 'vtt') => {
      const body = fmt === 'srt' ? toSrt(display) : fmt === 'vtt' ? toVtt(display) : toTxt(display)
      const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `transcript.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    },
    [display],
  )

  return (
    <div className="transcription">
      <header className="transcription__header">{t('tx.title')}</header>

      {queue.length > 0 && (
        <TranscriptList rows={queue} workspaceId={workspaceId} onClear={reset} />
      )}

      {state.phase === 'idle' && queue.length === 0 && (
        <div className="transcription__idle">
          <div className="transcription__controls">
            <div className="transcription__seg" role="group">
              <button
                className={task === 'transcribe' ? 'is-active' : ''}
                onClick={() => setTask('transcribe')}
              >
                {t('tx.task.transcribe')}
              </button>
              <button
                className={task === 'translate' ? 'is-active' : ''}
                onClick={() => setTask('translate')}
              >
                {t('tx.task.translate')}
              </button>
            </div>
            <label className="transcription__field" title={t('tx.languageHint')}>
              {t('tx.language')}
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as TranscriptionOptions['language'])}
              >
                <option value="auto">{t('tx.lang.auto')}</option>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>

          <div className="transcription__controls">
            <label className="transcription__check">
              <input
                type="checkbox"
                checked={diarize}
                onChange={(e) => setDiarize(e.target.checked)}
              />
              {t('tx.diarize')}
            </label>
            {diarize && (
              <input
                className="transcription__speakers-input"
                type="number"
                min={1}
                placeholder={t('tx.speakersAuto')}
                value={speakers}
                onChange={(e) => setSpeakers(e.target.value)}
                title={t('tx.speakers')}
              />
            )}
            <button
              className={`transcription__record ${recording ? 'is-recording' : ''}`}
              onClick={toggleRecord}
            >
              {recording && <span className="transcription__rec-dot" aria-hidden="true" />}
              {recording ? t('tx.recording', { secs: seconds }) : t('tx.record')}
            </button>
            {recordError && <span className="transcription__rec-error">{t(recordError)}</span>}
          </div>

          <button
            type="button"
            className={`transcription__drop ${over ? 'transcription__drop--over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              void onFiles(Array.from(e.dataTransfer.files))
            }}
          >
            {t('tx.drop')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={(e) => void onFiles(Array.from(e.target.files ?? []))}
          />
        </div>
      )}

      {state.phase === 'decoding' && (
        <div className="transcription__status">{t('tx.decoding')}</div>
      )}

      {state.phase === 'transcribing' && (
        <div className="transcription__progress">
          <div className="transcription__status">
            {state.progress?.stage === 'diarize' ? t('tx.diarizing') : t('tx.transcribing')}
            {state.progress && (
              <progress
                className="transcription__bar"
                value={state.progress.done}
                max={state.progress.total}
              />
            )}
          </div>
          <button className="transcription__btn" onClick={cancel}>
            {t('tx.cancel')}
          </button>
          <TranscriptBody segments={state.segments} />
        </div>
      )}

      {state.phase === 'done' && (
        <div className="transcription__result">
          <div className="transcription__actions">
            <button
              className="transcription__btn"
              onClick={() => void navigator.clipboard.writeText(toTxt(display))}
            >
              {t('tx.copy')}
            </button>
            <select
              className="transcription__btn"
              value=""
              onChange={(e) => {
                if (e.target.value) onExport(e.target.value as 'txt' | 'srt' | 'vtt')
                e.target.value = ''
              }}
            >
              <option value="">{t('tx.export')}</option>
              <option value="txt">.txt</option>
              <option value="srt">.srt</option>
              <option value="vtt">.vtt</option>
            </select>
            <button
              className="transcription__btn"
              onClick={() => void onSave()}
              disabled={workspaceId == null || state.segments.length === 0}
              title={workspaceId == null ? t('tx.needWorkspace') : undefined}
            >
              {saved ? t('tx.saved') : t('tx.save')}
            </button>
            <button className="transcription__btn" onClick={reset}>
              {t('tx.again')}
            </button>
          </div>
          {distinctSpeakers.length > 0 && (
            <SpeakerLabels
              originals={distinctSpeakers}
              names={speakerNames}
              onRename={(orig, name) => setSpeakerNames((p) => ({ ...p, [orig]: name }))}
            />
          )}
          {state.segments.length === 0 ? (
            <div className="transcription__status">{t('tx.noSpeech')}</div>
          ) : (
            <TranscriptBody segments={display} />
          )}
        </div>
      )}

      {state.phase === 'error' && (
        <div className="transcription__error">
          <span>{state.error?.startsWith('tx.') ? t(state.error) : state.error}</span>
          <button className="transcription__btn" onClick={reset}>
            {t('tx.again')}
          </button>
        </div>
      )}
    </div>
  )
}

function TranscriptBody({ segments }: { segments: TranscriptSegment[] }): JSX.Element {
  return (
    <div className="transcription__body">
      {segments.map((s, i) => (
        <p key={i}>
          {s.speaker && <strong>{s.speaker}: </strong>}
          {s.text}
        </p>
      ))}
    </div>
  )
}

/** Minimal MediaRecorder wrapper: toggle start/stop, surface elapsed seconds,
 *  hand the recorded blob to onClip when stopped. */
function useRecorder(onClip: (blob: File) => void): {
  recording: boolean
  seconds: number
  recordError: string | null
  toggleRecord: () => void
} {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [recordError, setRecordError] = useState<string | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTimer = (): void => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }

  // Unmounting mid-recording must release the OS mic device, or it stays held
  // until the app restarts. Stop the recorder + every track on cleanup.
  useEffect(
    () => () => {
      stopTimer()
      try {
        recRef.current?.stop()
      } catch {
        /* already stopped */
      }
      for (const tr of streamRef.current?.getTracks() ?? []) tr.stop()
    },
    [],
  )

  const toggleRecord = useCallback(() => {
    if (recording) {
      recRef.current?.stop()
      return
    }
    setRecordError(null)
    // getUserMedia can be missing (no secure context / odd Electron build) or
    // throw synchronously — both would bypass a plain .catch and leave the user
    // with no feedback. Guard every step and surface the exact error.
    const md = navigator.mediaDevices
    if (!md || typeof md.getUserMedia !== 'function') {
      console.error('[record] navigator.mediaDevices.getUserMedia unavailable', md)
      setRecordError('tx.recUnavailable')
      return
    }
    let pending: Promise<MediaStream>
    try {
      pending = md.getUserMedia({ audio: true })
    } catch (err) {
      console.error('[record] getUserMedia threw synchronously', err)
      setRecordError(`Mic error: ${err instanceof Error ? err.name : String(err)}`)
      return
    }
    void pending
      .then((stream) => {
        streamRef.current = stream
        let rec: MediaRecorder
        try {
          rec = new MediaRecorder(stream)
        } catch (err) {
          for (const tr of stream.getTracks()) tr.stop()
          streamRef.current = null

          console.error('[record] MediaRecorder construction failed', err)
          setRecordError(`Recorder error: ${err instanceof Error ? err.name : String(err)}`)
          return
        }
        chunksRef.current = []
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }
        rec.onstop = () => {
          stopTimer()
          setRecording(false)
          for (const tr of stream.getTracks()) tr.stop()
          streamRef.current = null
          const blob = new File(chunksRef.current, 'recording.webm', { type: 'audio/webm' })
          onClip(blob)
        }
        recRef.current = rec
        rec.start()
        setRecording(true)
        setSeconds(0)
        timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
      })
      .catch((err: unknown) => {
        console.error('[record] getUserMedia rejected', err)
        setRecording(false)
        const name = err instanceof Error ? err.name : ''
        setRecordError(
          name === 'NotFoundError'
            ? 'tx.recNoDevice'
            : name === 'NotAllowedError'
              ? 'tx.recDenied'
              : `Mic error: ${name || String(err)}`,
        )
      })
  }, [recording, onClip])

  return { recording, seconds, recordError, toggleRecord }
}

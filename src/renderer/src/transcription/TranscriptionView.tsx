import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useTranscription } from './useTranscription'
import { SpeakerLabels } from './SpeakerLabels'
import { TranscriptList } from './TranscriptList'
import { toTxt, toSrt, toVtt } from '@shared/subtitles'
import type {
  TranscriptionOptions,
  TranscriptSegment,
  WhisperModelId,
  WhisperModelStatus,
} from '@shared/transcription'
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

export function TranscriptionView({ workspaceId }: { workspaceId: number | null }): JSX.Element {
  const t = useT()
  const { state, queue, transcribe, transcribeMany, cancel, reset } = useTranscription()
  const [task, setTask] = useState<TranscriptionOptions['task']>('transcribe')
  const [language, setLanguage] = useState<TranscriptionOptions['language']>('auto')
  const [model, setModel] = useState<WhisperModelId>('base')
  const [models, setModels] = useState<WhisperModelStatus[]>([])
  const [diarize, setDiarize] = useState(false)
  const [speakers, setSpeakers] = useState('')
  const [gpu, setGpu] = useState(false)
  const [over, setOver] = useState(false)
  const [saved, setSaved] = useState(false)
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.api.transcription.modelStatus().then((m) => {
      setModels(m)
      const present = m.find((x) => x.present)
      if (present) setModel((cur) => (m.find((x) => x.id === cur)?.present ? cur : present.id))
    })
  }, [])

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

  const opts: TranscriptionOptions = {
    task,
    language,
    model,
    diarize,
    gpu,
    ...(diarize && speakers.trim() !== '' ? { speakers: Math.max(1, Number(speakers)) } : {}),
  }

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

  const { recording, seconds, toggleRecord } = useRecorder((blob) => onFile(blob))

  const renamed = useMemo(
    () => applyNames(state.segments, speakerNames),
    [state.segments, speakerNames],
  )
  const distinctSpeakers = useMemo(
    () => [...new Set(state.segments.map((s) => s.speaker).filter(Boolean))] as string[],
    [state.segments],
  )

  const onSave = useCallback(async () => {
    if (workspaceId == null) return
    const ext = distinctSpeakers.length > 0 ? 'md' : 'txt'
    await window.api.transcription.saveToWorkspace(workspaceId, toTxt(renamed), ext)
    setSaved(true)
  }, [workspaceId, renamed, distinctSpeakers])

  const onExport = useCallback(
    (fmt: 'txt' | 'srt' | 'vtt') => {
      const body = fmt === 'srt' ? toSrt(renamed) : fmt === 'vtt' ? toVtt(renamed) : toTxt(renamed)
      const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `transcript.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    },
    [renamed],
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
            <label className="transcription__field">
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
            <label className="transcription__field">
              {t('tx.model')}
              <select value={model} onChange={(e) => setModel(e.target.value as WhisperModelId)}>
                {(models.length > 0
                  ? models
                  : [{ id: 'base', present: true } as WhisperModelStatus]
                ).map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.present}>
                    {m.id}
                    {m.present ? '' : ` (${t('tx.modelMissing')})`}
                  </option>
                ))}
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
            <label className="transcription__check">
              <input type="checkbox" checked={gpu} onChange={(e) => setGpu(e.target.checked)} />
              {t('tx.gpu')}
            </label>
            <button
              className={`transcription__record ${recording ? 'is-recording' : ''}`}
              onClick={toggleRecord}
            >
              {recording ? t('tx.recording', { secs: seconds }) : t('tx.record')}
            </button>
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
              onClick={() => void navigator.clipboard.writeText(toTxt(renamed))}
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
            <TranscriptBody segments={renamed} />
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
  toggleRecord: () => void
} {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTimer = (): void => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => () => stopTimer(), [])

  const toggleRecord = useCallback(() => {
    if (recording) {
      recRef.current?.stop()
      return
    }
    void navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        stopTimer()
        setRecording(false)
        for (const tr of stream.getTracks()) tr.stop()
        const blob = new File(chunksRef.current, 'recording.webm', { type: 'audio/webm' })
        onClip(blob)
      }
      recRef.current = rec
      rec.start()
      setRecording(true)
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    })
  }, [recording, onClip])

  return { recording, seconds, toggleRecord }
}

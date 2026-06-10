import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useTranscription } from './useTranscription'
import { toTxt } from '@shared/subtitles'
import type { TranscriptionOptions, TranscriptSegment } from '@shared/transcription'
import './transcription.css'

export function TranscriptionView({ workspaceId }: { workspaceId: number | null }): JSX.Element {
  const t = useT()
  const { state, transcribe, cancel, reset } = useTranscription()
  const [task, setTask] = useState<TranscriptionOptions['task']>('transcribe')
  const [language, setLanguage] = useState<TranscriptionOptions['language']>('auto')
  const [over, setOver] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const opts: TranscriptionOptions = { task, language, model: 'base', diarize: false }

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setSaved(false)
      await transcribe(await file.arrayBuffer(), opts)
    },
    [transcribe, opts],
  )

  const { recording, seconds, toggleRecord } = useRecorder((blob) => void onFile(blob))

  const onSave = useCallback(async () => {
    if (workspaceId == null) return
    await window.api.transcription.saveToWorkspace(workspaceId, toTxt(state.segments), 'txt')
    setSaved(true)
  }, [workspaceId, state.segments])

  return (
    <div className="transcription">
      <header className="transcription__header">{t('tx.title')}</header>

      {state.phase === 'idle' && (
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
              void onFile(e.dataTransfer.files[0])
            }}
          >
            {t('tx.drop')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
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
              onClick={() => void navigator.clipboard.writeText(toTxt(state.segments))}
            >
              {t('tx.copy')}
            </button>
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
          {state.segments.length === 0 ? (
            <div className="transcription__status">{t('tx.noSpeech')}</div>
          ) : (
            <TranscriptBody segments={state.segments} />
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

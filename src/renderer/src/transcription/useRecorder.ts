import { useCallback, useEffect, useRef, useState } from 'react'

/** Own microphone permission, tracks and callbacks for one mounted view. */
export function useRecorder(onClip: (clip: File) => void, active = true) {
  const [recording, setRecording] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [recordError, setRecordError] = useState<string | null>(null)
  const alive = useRef(true)
  const enabled = useRef(active)
  const clip = useRef(onClip)
  enabled.current = active
  clip.current = onClip
  const request = useRef(0)
  const pending = useRef(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const release = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current)
    timer.current = null
    for (const track of stream.current?.getTracks() ?? []) track.stop()
    stream.current = null
  }, [])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      // Invalidate the latest permission request; this is a counter, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      request.current++
      pending.current = false
      const current = recorder.current
      recorder.current = null
      if (current) {
        // Unmount is disposal, not a request to transcribe the stopped clip.
        current.onstop = null
        current.ondataavailable = null
        current.onerror = null
        if (current.state !== 'inactive') {
          try {
            current.stop()
          } catch {
            /* already stopped */
          }
        }
      }
      release()
    }
  }, [release])

  useEffect(() => {
    if (active) return
    request.current++
    pending.current = false
    setPreparing(false)
    // An existing recording is intentionally flushed when its tab is hidden.
    if (recorder.current?.state !== 'inactive') recorder.current?.stop()
  }, [active])

  const toggleRecord = useCallback(() => {
    if (recorder.current) {
      if (recorder.current.state !== 'inactive') recorder.current.stop()
      return
    }
    if (!enabled.current || pending.current) return
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) {
      setRecordError('tx.recUnavailable')
      return
    }
    pending.current = true
    setPreparing(true)
    setRecordError(null)
    const id = ++request.current
    void (async () => {
      try {
        const acquired = await media.getUserMedia({ audio: true })
        if (!alive.current || !enabled.current || id !== request.current) {
          for (const track of acquired.getTracks()) track.stop()
          return
        }
        stream.current = acquired
        const current = new MediaRecorder(acquired)
        recorder.current = current
        const chunks: Blob[] = []
        current.ondataavailable = (event) => {
          if (recorder.current === current && event.data.size > 0) chunks.push(event.data)
        }
        current.onstop = () => {
          if (recorder.current !== current) return
          current.ondataavailable = null
          current.onstop = null
          current.onerror = null
          recorder.current = null
          release()
          if (!alive.current) return
          setRecording(false)
          if (chunks.length)
            clip.current(
              new File(chunks, 'recording.webm', { type: current.mimeType || 'audio/webm' }),
            )
        }
        current.onerror = () => {
          if (recorder.current !== current) return
          current.onstop = null
          current.ondataavailable = null
          current.onerror = null
          recorder.current = null
          if (current.state !== 'inactive') {
            try {
              current.stop()
            } catch {
              /* already stopped */
            }
          }
          release()
          if (alive.current) {
            setRecording(false)
            setRecordError('tx.recFailed')
          }
        }
        current.start()
        setRecording(true)
        setSeconds(0)
        timer.current = setInterval(() => setSeconds((value) => value + 1), 1000)
      } catch (error) {
        if (!alive.current || id !== request.current) return
        const current = recorder.current
        recorder.current = null
        if (current) {
          current.onstop = null
          current.ondataavailable = null
          current.onerror = null
          if (current.state !== 'inactive') {
            try {
              current.stop()
            } catch {
              /* failed start already stopped */
            }
          }
        }
        release()
        setRecording(false)
        const name = error instanceof Error ? error.name : ''
        setRecordError(
          name === 'NotFoundError'
            ? 'tx.recNoDevice'
            : name === 'NotAllowedError'
              ? 'tx.recDenied'
              : 'tx.recFailed',
        )
      } finally {
        if (alive.current && id === request.current) {
          pending.current = false
          setPreparing(false)
        }
      }
    })()
  }, [release])

  return { recording, preparing, seconds, recordError, toggleRecord }
}

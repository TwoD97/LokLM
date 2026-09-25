import { useEffect, useRef, useState } from 'react'
import type { TranslateResult, TranslationProgress } from '@shared/translation'

/** Own the IPC request for a panel; closing it never leaves LLM work queued. */
export function useTranslationRequest(): {
  runTranslation: (text: string, target: string) => Promise<TranslateResult | null>
  cancel: () => void
  progress: TranslationProgress | null
} {
  const active = useRef<{ id: string; cancelled: boolean } | null>(null)
  const [progress, setProgress] = useState<TranslationProgress | null>(null)

  const cancel = (): void => {
    const request = active.current
    if (!request) return
    request.cancelled = true
    void window.api.translation.cancel(request.id).catch(() => undefined)
  }

  useEffect(() => {
    const off = window.api.translation.onProgress((next) => {
      if (next.requestId === active.current?.id && !active.current.cancelled) setProgress(next)
    })
    return () => {
      off()
      const request = active.current
      active.current = null
      if (request) {
        request.cancelled = true
        void window.api.translation.cancel(request.id).catch(() => undefined)
      }
    }
  }, [])

  const runTranslation = async (text: string, target: string): Promise<TranslateResult | null> => {
    if (active.current) return null
    const request = { id: crypto.randomUUID(), cancelled: false }
    active.current = request
    setProgress(null)
    try {
      const result = await window.api.translation.translate(text, { target, requestId: request.id })
      return !request.cancelled && active.current === request ? result : null
    } catch (err) {
      if (request.cancelled || active.current !== request) return null
      throw err
    } finally {
      if (active.current === request) active.current = null
    }
  }
  return { runTranslation, cancel, progress }
}

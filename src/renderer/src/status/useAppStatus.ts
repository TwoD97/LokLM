import { useCallback, useEffect, useState } from 'react'
import type { BackfillStatus } from '@shared/documents'
import type { TranslatorStatus } from '@shared/translation'
import type { WhisperModelStatus } from '@shared/transcription'
import { IDLE_MODEL_TRANSITION, type ModelActivity } from '@shared/modelActivity'
import { runtimeModel, UNKNOWN_MODEL, type RuntimeModel } from './statusModel'

export function useAppStatus(refreshAudio = false) {
  const [chat, setChat] = useState<RuntimeModel>(UNKNOWN_MODEL)
  const [search, setSearch] = useState<RuntimeModel>(UNKNOWN_MODEL)
  const [refinement, setRefinement] = useState<RuntimeModel>(UNKNOWN_MODEL)
  const [translation, setTranslation] = useState<TranslatorStatus | null>(null)
  const [audio, setAudio] = useState<WhisperModelStatus[] | null>(null)
  const [activity, setActivity] = useState<ModelActivity>({ ...IDLE_MODEL_TRANSITION, jobs: [] })
  const [backfill, setBackfill] = useState<BackfillStatus | null>(null)
  const [failedReads, setFailedReads] = useState<string[]>([])
  const recordRead = useCallback((key: string, failed: boolean) => {
    setFailedReads((previous) => {
      if (previous.includes(key) === failed) return previous
      return failed ? [...previous, key] : previous.filter((item) => item !== key)
    })
  }, [])
  useEffect(() => {
    let mounted = true
    const subscriptions: Array<() => void> = []
    function observe<T>(
      key: string,
      read: () => Promise<T>,
      subscribe: (callback: (value: T) => void) => () => void,
      set: (value: T) => void,
    ) {
      let received = false
      subscriptions.push(
        subscribe((value) => {
          received = true
          if (mounted) {
            recordRead(key, false)
            set(value)
          }
        }),
      )
      void read()
        .then((value) => {
          if (mounted && !received) {
            recordRead(key, false)
            set(value)
          }
        })
        .catch(() => {
          if (mounted && !received) recordRead(key, true)
        })
    }
    const setModel = (set: typeof setChat) => (value: Parameters<typeof runtimeModel>[0]) => {
      const next = runtimeModel(value)
      set((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
    }
    observe('chat', window.api.llm.status, window.api.llm.onStatus, setModel(setChat))
    observe('search', window.api.embedder.status, window.api.embedder.onStatus, setModel(setSearch))
    observe(
      'refinement',
      window.api.reranker.status,
      window.api.reranker.onStatus,
      setModel(setRefinement),
    )
    observe(
      'translation',
      window.api.translation.status,
      window.api.translation.onStatus,
      setTranslation,
    )
    observe('activity', window.api.models.activity, window.api.models.onActivity, setActivity)
    subscriptions.push(
      window.api.embedder.onBackfillStatus((status) => {
        if (mounted) setBackfill(status)
      }),
    )
    return () => {
      mounted = false
      subscriptions.forEach((off) => off())
    }
  }, [recordRead])
  useEffect(() => {
    let mounted = true
    const readAudio = () => {
      void window.api.transcription
        .modelStatus()
        .then((models) => {
          if (mounted) {
            recordRead('audio', false)
            setAudio(models)
          }
        })
        .catch(() => {
          if (mounted) recordRead('audio', true)
        })
    }
    readAudio()
    window.addEventListener('focus', readAudio)
    return () => {
      mounted = false
      window.removeEventListener('focus', readAudio)
    }
  }, [recordRead, refreshAudio])
  return {
    chat,
    search,
    refinement,
    translation,
    audio,
    activity,
    backfill,
    readFailed: failedReads.length > 0,
  }
}

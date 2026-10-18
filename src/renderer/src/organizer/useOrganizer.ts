import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  OrganizerSnapshot,
  SaveNoteInput,
  SaveTaskInput,
  SaveEventInput,
  DeleteOrganizerInput,
} from '@shared/organizer'

const EMPTY: OrganizerSnapshot = { notes: [], tasks: [], events: [] }

export function useOrganizer() {
  const [data, setData] = useState<OrganizerSnapshot>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [refreshError, setRefreshError] = useState<unknown>(null)
  const alive = useRef(true)
  const hasLoaded = useRef(false)
  const lifetime = useRef(0)
  const version = useRef(0)
  const requested = useRef(false)
  const running = useRef<Promise<void> | null>(null)

  const refresh = useCallback((): Promise<void> => {
    if (!alive.current) return Promise.resolve()
    version.current++
    requested.current = true
    if (running.current) return running.current
    const epoch = lifetime.current
    const current = () => alive.current && lifetime.current === epoch
    const work = Promise.resolve().then(async () => {
      try {
        while (current() && requested.current) {
          requested.current = false
          const readVersion = version.current
          if (!hasLoaded.current) setLoading(true)
          setLoadError(null)
          setRefreshError(null)
          try {
            const next = await window.api.organizer.list()
            if (!current() || readVersion !== version.current) continue
            hasLoaded.current = true
            setLoaded(true)
            setData(next)
          } catch (error) {
            if (!current() || readVersion !== version.current) continue
            if (hasLoaded.current) setRefreshError(error)
            else setLoadError(error)
          }
        }
      } finally {
        if (running.current === work) running.current = null
        if (current()) setLoading(false)
      }
    })
    running.current = work
    return work
  }, [])

  useEffect(() => {
    alive.current = true
    const off = window.api.organizer.onChanged(() => void refresh())
    void refresh()
    return () => {
      alive.current = false
      // These counters invalidate async work rather than refer to DOM nodes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      lifetime.current++
      running.current = null
      requested.current = false
      off()
    }
  }, [refresh])

  async function save<K extends keyof OrganizerSnapshot>(
    kind: K,
    operation: () => Promise<OrganizerSnapshot[K][number]>,
  ) {
    try {
      const item = await operation()
      if (alive.current) {
        setData((current) => ({
          ...current,
          [kind]: [...current[kind].filter((old) => old.id !== item.id), item],
        }))
        // Fence any earlier read, then reconcile concurrent changes and event bursts.
        void refresh()
      }
      return item
    } catch (error) {
      if (String(error).includes('ORGANIZER_CONFLICT')) await refresh()
      throw error
    }
  }
  async function remove(
    kind: keyof OrganizerSnapshot,
    input: DeleteOrganizerInput,
    operation: () => Promise<void>,
  ) {
    try {
      await operation()
      if (alive.current) {
        setData((current) => ({
          ...current,
          [kind]: current[kind].filter((item) => item.id !== input.id),
        }))
        void refresh()
      }
    } catch (error) {
      if (String(error).includes('ORGANIZER_CONFLICT')) await refresh()
      throw error
    }
  }
  return {
    data,
    loading,
    loaded,
    loadError,
    refreshError,
    refresh,
    saveNote: (input: SaveNoteInput) => save('notes', () => window.api.organizer.saveNote(input)),
    saveTask: (input: SaveTaskInput) => save('tasks', () => window.api.organizer.saveTask(input)),
    saveEvent: (input: SaveEventInput) =>
      save('events', () => window.api.organizer.saveEvent(input)),
    deleteNote: (input: DeleteOrganizerInput) =>
      remove('notes', input, () => window.api.organizer.deleteNote(input)),
    deleteTask: (input: DeleteOrganizerInput) =>
      remove('tasks', input, () => window.api.organizer.deleteTask(input)),
    deleteEvent: (input: DeleteOrganizerInput) =>
      remove('events', input, () => window.api.organizer.deleteEvent(input)),
  }
}

export type OrganizerStore = ReturnType<typeof useOrganizer>

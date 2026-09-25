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
  const [loadError, setLoadError] = useState<unknown>(null)
  const alive = useRef(true)
  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const next = await window.api.organizer.list()
      if (alive.current) setData(next)
    } catch (error) {
      if (alive.current) setLoadError(error)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])

  async function save<K extends keyof OrganizerSnapshot>(
    kind: K,
    operation: () => Promise<OrganizerSnapshot[K][number]>,
  ) {
    try {
      const item = await operation()
      if (alive.current)
        setData((current) => ({
          ...current,
          [kind]: [...current[kind].filter((old) => old.id !== item.id), item],
        }))
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
      if (alive.current)
        setData((current) => ({
          ...current,
          [kind]: current[kind].filter((item) => item.id !== input.id),
        }))
    } catch (error) {
      if (String(error).includes('ORGANIZER_CONFLICT')) await refresh()
      throw error
    }
  }
  return {
    data,
    loading,
    loadError,
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

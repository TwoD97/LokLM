import { useEffect, useState, useCallback } from 'react'
import type { UserSettings } from '@shared/settings'

// Module-level shared state: every useSettings() call sees the same snapshot
// and is notified when any caller (e.g. the SettingsModal toggle) updates it.
// Without this, components like ChatView would hold a stale copy when the
// user changes a preference mid-session.
let sharedSettings: UserSettings | null = null
let hydratePromise: Promise<UserSettings> | null = null
const listeners = new Set<(s: UserSettings) => void>()

function notify(next: UserSettings): void {
  sharedSettings = next
  for (const l of listeners) {
    try {
      l(next)
    } catch {
      /* ignore */
    }
  }
}

export function useSettings(): {
  settings: UserSettings | null
  update: (patch: unknown) => Promise<void>
  savedFlash: boolean
} {
  const [settings, setSettings] = useState<UserSettings | null>(sharedSettings)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    listeners.add(setSettings)
    // First mount across the app kicks the hydrate; subsequent mounts await
    // the same promise so we don't fan out duplicate IPC reads.
    if (sharedSettings == null) {
      if (hydratePromise == null) {
        hydratePromise = window.api.settings.get().then((s) => {
          sharedSettings = s
          return s
        })
      }
      void hydratePromise.then((s) => {
        setSettings(s)
        for (const l of listeners) if (l !== setSettings) l(s)
      })
    }
    return () => {
      listeners.delete(setSettings)
    }
  }, [])

  const update = useCallback(async (patch: unknown) => {
    const next = await window.api.settings.update(patch)
    notify(next)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 600)
  }, [])

  return { settings, update, savedFlash }
}

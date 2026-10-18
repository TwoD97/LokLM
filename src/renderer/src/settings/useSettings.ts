import { useEffect, useState, useCallback, useRef } from 'react'
import type { UserSettings } from '@shared/settings'

// Module-level shared state: every useSettings() call sees the same snapshot
// and is notified when any caller (e.g. the SettingsModal toggle) updates it.
// Without this, components like ChatView would hold a stale copy when the
// user changes a preference mid-session.
let sharedSettings: UserSettings | null = null
let hydratePromise: Promise<UserSettings> | null = null
let readVersion = 0
let sharedLoadFailed = false
const listeners = new Set<() => void>()

function broadcast(): void {
  for (const listener of listeners) listener()
}

function notify(next: UserSettings): void {
  sharedSettings = next
  sharedLoadFailed = false
  broadcast()
}

function readSettings(): Promise<UserSettings> {
  const version = ++readVersion
  sharedLoadFailed = false
  broadcast()
  const pending = window.api.settings
    .get()
    .then((next) => {
      // A delayed locked-vault read must not overwrite unlocked preferences.
      if (version === readVersion) notify(next)
      return next
    })
    .catch((error: unknown) => {
      if (version === readVersion) {
        sharedLoadFailed = true
        hydratePromise = null
        broadcast()
      }
      throw error
    })
  hydratePromise = pending
  return pending
}

/** Refresh after unlock: the initial read may have returned locked-vault defaults. */
export async function refreshSettings(): Promise<UserSettings> {
  return readSettings()
}

export function useSettings(): {
  settings: UserSettings | null
  update: (patch: unknown) => Promise<void>
  savedFlash: boolean
  loadFailed: boolean
} {
  const [settings, setSettings] = useState<UserSettings | null>(sharedSettings)
  const [savedFlash, setSavedFlash] = useState(false)
  const [loadFailed, setLoadFailed] = useState(sharedLoadFailed)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const listener = (): void => {
      setSettings(sharedSettings)
      setLoadFailed(sharedLoadFailed)
    }
    listeners.add(listener)
    listener()
    // First mount across the app kicks the hydrate; subsequent mounts await
    // the same promise so we don't fan out duplicate IPC reads.
    if (sharedSettings == null && hydratePromise == null && !sharedLoadFailed) {
      void readSettings().catch(() => undefined)
    }
    return () => {
      alive.current = false
      listeners.delete(listener)
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    }
  }, [])

  const update = useCallback(async (patch: unknown) => {
    const next = await window.api.settings.update(patch)
    ++readVersion
    notify(next)
    if (alive.current) {
      setSavedFlash(true)
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setSavedFlash(false), 600)
    }
  }, [])

  return { settings, update, savedFlash, loadFailed }
}

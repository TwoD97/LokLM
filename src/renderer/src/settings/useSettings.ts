import { useEffect, useState, useCallback } from 'react'
import type { UserSettings } from '@shared/settings'

export function useSettings(): {
  settings: UserSettings | null
  update: (patch: unknown) => Promise<void>
  savedFlash: boolean
} {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
  }, [])

  const update = useCallback(async (patch: unknown) => {
    const next = await window.api.settings.update(patch)
    setSettings(next)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 600)
  }, [])

  return { settings, update, savedFlash }
}

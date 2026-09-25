import { useRef, useState } from 'react'

/** Inline settings controls must handle rejected durable saves instead of
 * leaving an unhandled promise or continuing a dependent model reload. */
export function usePreferenceSave(update: (patch: unknown) => Promise<void>) {
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(0)
  const save = async (patch: unknown): Promise<boolean> => {
    pending.current++
    setBusy(true)
    setFailed(false)
    try {
      await update(patch)
      return true
    } catch {
      setFailed(true)
      return false
    } finally {
      pending.current--
      if (pending.current === 0) setBusy(false)
    }
  }
  return { save, busy, failed }
}

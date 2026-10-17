import { useCallback, useRef, useState } from 'react'
import { ConfirmModal } from '../chat/ConfirmModal'
import { useT } from '../i18n'

export function useOrganizerAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const pending = useRef(false)
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (err) {
      setError(err)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const clearError = useCallback(() => setError(null), [])
  return { busy, error, clearError, run }
}

export function useDiscardGuard() {
  const [pending, setPending] = useState<(() => void) | null>(null)
  const t = useT()
  const guard = useCallback(
    (dirty: boolean, next: () => void) => (dirty ? setPending(() => next) : next()),
    [],
  )
  return {
    guard,
    confirmation: pending ? (
      <ConfirmModal
        title={t('organizer.discardTitle')}
        body={t('organizer.discardBody')}
        confirmLabel={t('organizer.discard')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          setPending(null)
          pending()
        }}
      />
    ) : null,
  }
}

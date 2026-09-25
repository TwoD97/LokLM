import { useRef, useState } from 'react'
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
  return { busy, error, clearError: () => setError(null), run }
}

export function useDiscardGuard() {
  const [pending, setPending] = useState<(() => void) | null>(null)
  const t = useT()
  return {
    guard: (dirty: boolean, next: () => void) => (dirty ? setPending(() => next) : next()),
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

import { useT } from '../i18n'

export function OrganizerError({
  error,
  context = 'save',
}: {
  error: unknown
  context?: 'load' | 'save'
}): JSX.Element | null {
  const t = useT()
  if (!error) return null
  const message = String(error)
  const key = message.includes('ORGANIZER_CONFLICT')
    ? 'conflict'
    : message.includes('ORGANIZER_LOCKED')
      ? 'locked'
      : message.includes('ORGANIZER_LIMIT')
        ? 'limit'
        : message.includes('ORGANIZER_CORRUPT')
          ? 'corrupt'
          : context === 'load'
            ? 'loadError'
            : 'saveError'
  return (
    <p className="organizer__error" role="alert">
      {t(`organizer.${key}`)}
    </p>
  )
}

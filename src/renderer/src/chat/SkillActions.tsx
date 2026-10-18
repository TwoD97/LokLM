import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { SkillAction } from '@shared/connections'
import { openOrganizerItem } from '../organizer/organizerNavigation'
import { useT } from '../i18n'

type Props = {
  actions: SkillAction[]
  workspaceId?: number | undefined
  conversationId?: number | undefined
  messageId?: number | undefined
  onUpdate?: ((action: SkillAction) => void) | undefined
}

export const SkillActions = memo(function SkillActions({ actions, ...context }: Props) {
  return (
    <div className="chat__skill-actions">
      {actions.map((action) => (
        <SkillActionCard key={action.id} action={action} {...context} />
      ))}
    </div>
  )
})

function SkillActionCard({
  action,
  workspaceId,
  conversationId,
  messageId,
  onUpdate,
}: Omit<Props, 'actions'> & { action: SkillAction }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const organizerResult = useMemo(() => parseOrganizerResult(action), [action])
  const saved = workspaceId != null && conversationId != null && messageId != null
  const run = async (dismiss: boolean) => {
    if (!saved || pending.current || uncertain || action.status !== 'pending') return
    pending.current = true
    setBusy(true)
    setError(null)
    const input = { workspaceId, conversationId, messageId, actionId: action.id }
    try {
      const result = await (dismiss
        ? window.api.skills.dismiss(input)
        : window.api.skills.apply(input))
      if (alive.current) onUpdate?.(result)
    } catch (cause) {
      if (!alive.current) return
      setError(String(cause))
      // An invoke failure cannot prove that a remote write did not happen.
      // Reconcile the stored receipt before making execution available again.
      setUncertain(true)
      try {
        const receipt = await window.api.skills.get(input)
        if (alive.current && receipt) {
          onUpdate?.(receipt)
          setUncertain(receipt.status === 'running')
          if (receipt.status !== 'pending') setError(null)
        }
      } catch {
        /* Keep execution blocked until the conversation is reopened. */
      }
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  return (
    <section className="chat__skill-card" aria-label={action.title} aria-busy={busy}>
      <div className="chat__skill-heading">
        <strong>{action.title}</strong>
        <span role="status">{t(`skills.${busy ? 'running' : action.status}`)}</span>
      </div>
      {action.effect === 'external' && <p>{t('skills.external')}</p>}
      <details open={action.status === 'pending'}>
        <summary>{t('skills.arguments')}</summary>
        <pre>{JSON.stringify(action.arguments, null, 2)}</pre>
      </details>
      {organizerResult ? (
        <div className="chat__skill-result">
          {organizerResult.items.length === 0 && <p>{t('skills.noResults')}</p>}
          <ul className="chat__skill-items">
            {organizerResult.items.map((item) => {
              const target = action.targets?.find(
                (target) => target.id === item.id && target.kind === item.kind,
              )
              return (
                <li key={`${item.kind}:${item.id}`}>
                  <strong>{item.title}</strong>
                  {item.date && (
                    <p>{[item.date, item.startTime, item.endTime].filter(Boolean).join(' · ')}</p>
                  )}
                  {item.dueDate && <p>{item.dueDate}</p>}
                  {typeof item.completed === 'boolean' && (
                    <p>{t(item.completed ? 'skills.taskDone' : 'skills.taskOpen')}</p>
                  )}
                  {(item.body || item.details) && <p>{item.body || item.details}</p>}
                  {item.truncated && <p>{t('skills.preview')}</p>}
                  {target && action.status === 'completed' && (
                    <button
                      type="button"
                      aria-label={`${t(`skills.open.${target.kind}`)}: ${item.title}`}
                      onClick={() => openOrganizerItem(target)}
                    >
                      {t(`skills.open.${target.kind}`)}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {organizerResult.hasMore && <p>{t('skills.moreResults')}</p>}
        </div>
      ) : action.result ? (
        <p className="chat__skill-result">{action.result}</p>
      ) : null}
      {(action.error || error) && <p role="alert">{action.error || error}</p>}
      {(uncertain || action.status === 'running') && <p role="status">{t('skills.uncertain')}</p>}
      {action.status === 'pending' && (
        <div className="chat__skill-buttons">
          <button
            type="button"
            disabled={!saved || busy || uncertain}
            onClick={() => void run(false)}
          >
            {t(action.effect === 'external' ? 'skills.run' : 'skills.apply')}
          </button>
          <button
            type="button"
            disabled={!saved || busy || uncertain}
            onClick={() => void run(true)}
          >
            {t('skills.dismiss')}
          </button>
          {!saved && <span role="status">{t('skills.saving')}</span>}
        </div>
      )}
      {!organizerResult &&
        action.status === 'completed' &&
        action.targets?.map((target) => (
          <button
            type="button"
            key={`${target.kind}:${target.id}`}
            onClick={() => openOrganizerItem(target)}
          >
            {t(`skills.open.${target.kind}`)}
          </button>
        ))}
    </section>
  )
}

type OrganizerResultItem = {
  id: string
  kind: 'notes' | 'tasks' | 'events'
  title: string
  body?: string
  details?: string
  date?: string
  startTime?: string
  endTime?: string
  dueDate?: string
  completed?: boolean
  truncated?: boolean
}

/** Treat tool output as plain data. Unrecognized schemas fall back to escaped text. */
function parseOrganizerResult(
  action: SkillAction,
): { items: OrganizerResultItem[]; hasMore: boolean } | null {
  if (!action.result || !['organizer.search', 'organizer.get'].includes(action.toolId)) return null
  try {
    const parsed: unknown = JSON.parse(action.result)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('items' in parsed) ||
      !Array.isArray(parsed.items)
    )
      return null
    const items: OrganizerResultItem[] = []
    for (const raw of parsed.items as unknown[]) {
      if (!raw || typeof raw !== 'object') return null
      const value = raw as Record<string, unknown>
      if (
        typeof value.id !== 'string' ||
        typeof value.title !== 'string' ||
        (value.kind !== 'notes' && value.kind !== 'tasks' && value.kind !== 'events')
      )
        return null
      const item: OrganizerResultItem = { id: value.id, title: value.title, kind: value.kind }
      for (const key of ['body', 'details', 'date', 'startTime', 'endTime', 'dueDate'] as const) {
        if (typeof value[key] === 'string') item[key] = value[key]
      }
      if (typeof value.completed === 'boolean') item.completed = value.completed
      if (typeof value.truncated === 'boolean') item.truncated = value.truncated
      items.push(item)
    }
    return { items, hasMore: 'hasMore' in parsed && parsed.hasMore === true }
  } catch {
    return null
  }
}

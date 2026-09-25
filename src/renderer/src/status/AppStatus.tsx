import { useEffect, useId, useRef, useState } from 'react'
import {
  AudioLines,
  ChevronDown,
  Circle,
  CircleCheck,
  Files,
  Languages,
  ListFilter,
  LoaderCircle,
  MessageSquare,
  Settings2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useT } from '../i18n'
import { useSettings } from '../settings/useSettings'
import { useGeneration } from '../generation/GenerationContext'
import { useAppStatus } from './useAppStatus'
import { modelState, refinementState, type CapabilityState } from './statusModel'
import './status.css'

type Props = { onOpenSettings?: ((section?: 'system') => void) | undefined }

export function AppStatus({ onOpenSettings }: Props): JSX.Element {
  const t = useT()
  const { settings } = useSettings()
  const { jobs } = useGeneration()
  const [open, setOpen] = useState(false)
  const status = useAppStatus(open)
  const { activity, backfill } = status
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onPointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onFocus = (event: FocusEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  useEffect(() => {
    if (activity.jobs.length === 0) {
      setStopping(false)
      setStopError(false)
    }
  }, [activity.jobs.length])

  const checkedState = (state: CapabilityState) =>
    state === 'checking' && status.readFailed ? 'unknown' : state
  const indexing = activity.phase === 'indexing'
  const locallyBlocked =
    status.chat.source === 'bundled' && activity.phase !== 'idle' && activity.phase !== 'error'
  const chatAvailability = checkedState(modelState(status.chat))
  const chatState: CapabilityState =
    locallyBlocked &&
    (chatAvailability === 'ready' ||
      chatAvailability === 'standby' ||
      chatAvailability === 'loading')
      ? activity.phase === 'restoring' ||
        (activity.phase === 'switching' && activity.target === 'llm')
        ? 'loading'
        : 'waiting'
      : chatAvailability
  const backfilling = backfill?.state === 'running'
  const searchState =
    indexing || backfilling
      ? 'working'
      : backfill?.state === 'failed'
        ? 'failed'
        : checkedState(modelState(status.search))
  const refineState = checkedState(
    refinementState(status.refinement, settings?.advanced.reranker.enabled ?? true),
  )
  const translationState: CapabilityState =
    status.translation?.state === 'error'
      ? 'failed'
      : status.translation?.state === 'not_installed'
        ? 'missing'
        : status.translation?.state === 'starting'
          ? 'loading'
          : status.translation?.state === 'installed' && chatState === 'unloaded'
            ? 'standby'
            : chatState
  const audioState: CapabilityState = jobs.some((job) => job.engine === 'transcription')
    ? 'working'
    : status.audio?.some((model) => model.downloading)
      ? 'loading'
      : status.audio?.some((model) => model.present)
        ? 'standby'
        : status.audio === null
          ? checkedState('checking')
          : 'missing'
  const hint = (state: CapabilityState, readyHint: string) =>
    t(
      state === 'ready'
        ? readyHint
        : state === 'remote'
          ? 'status.remoteHint'
          : state === 'standby'
            ? 'status.standbyHint'
            : state === 'loading'
              ? 'status.loadingHint'
              : state === 'failed'
                ? 'status.failedHint'
                : state === 'unknown'
                  ? 'status.readFailed'
                  : state === 'waiting'
                    ? 'status.chatWaitingHint'
                    : state === 'checking'
                      ? 'status.checkingHint'
                      : state === 'working'
                        ? 'status.searchWorkingHint'
                        : 'status.unloadedHint',
    )
  const total = activity.jobs.reduce((sum, job) => sum + job.total, 0)
  const done = activity.jobs.reduce((sum, job) => sum + job.done, 0)
  const rows = [
    {
      key: 'chat',
      Icon: MessageSquare,
      state: chatState,
      description: hint(chatState, 'status.chatReadyHint'),
    },
    {
      key: 'search',
      Icon: Files,
      state: searchState,
      description:
        indexing && total > 0
          ? t('status.searchProgress', { done: Math.min(done, total), total })
          : backfilling && backfill.total > 0
            ? t('status.searchProgress', {
                done: Math.min(backfill.done, backfill.total),
                total: backfill.total,
              })
            : hint(searchState, 'status.searchReadyHint'),
    },
    {
      key: 'refinement',
      Icon: ListFilter,
      state: refineState,
      description: t(
        refineState === 'off'
          ? 'status.refinementOff'
          : refineState === 'skipped'
            ? 'status.refinementSkipped'
            : refineState === 'unknown'
              ? 'status.refinementUnknown'
              : refineState === 'failed'
                ? 'status.failedHint'
                : 'status.refinementHint',
      ),
    },
    ...(settings?.basic.modules.translation !== false
      ? [
          {
            key: 'translation',
            Icon: Languages,
            state: translationState,
            description: t('status.translationHint'),
          },
        ]
      : []),
    ...(settings?.basic.modules.transcription !== false
      ? [
          {
            key: 'transcription',
            Icon: AudioLines,
            state: audioState,
            description: t(
              audioState === 'missing'
                ? 'status.audioMissing'
                : audioState === 'working'
                  ? 'status.audioWorking'
                  : audioState === 'loading'
                    ? 'status.audioDownloading'
                    : audioState === 'checking'
                      ? 'status.checkingHint'
                      : audioState === 'unknown'
                        ? 'status.readFailed'
                        : 'status.audioStandby',
            ),
          },
        ]
      : []),
  ]
  const issues =
    rows.filter((row) => row.state === 'failed').length +
    (status.readFailed ? 1 : 0) +
    (activity.phase === 'error' ? 1 : 0)
  const busy =
    (activity.phase !== 'idle' && activity.phase !== 'error') ||
    backfilling ||
    jobs.length > 0 ||
    rows.some((row) => row.state === 'loading')
  const frontJob = jobs.find((job) => job.engine === 'llm') ?? jobs[0]
  const waitingJobs = jobs.filter(
    (job, index) =>
      (job.engine === 'llm' && locallyBlocked) ||
      jobs.findIndex((other) => other.engine === job.engine) !== index,
  ).length
  const summary =
    activity.phase === 'error'
      ? t('status.attention')
      : activity.phase === 'restoring'
        ? t('status.restoring')
        : indexing
          ? t('status.indexing')
          : activity.phase === 'switching'
            ? t(
                activity.target === 'llm'
                  ? 'status.prepareChat'
                  : activity.target === 'reranker'
                    ? 'status.prepareRefinement'
                    : 'status.prepareSearch',
              )
            : backfilling
              ? t('status.updatingSearch')
              : frontJob
                ? t(`status.job.${frontJob.kind}`)
                : chatState === 'loading'
                  ? t('status.prepareChat')
                  : searchState === 'loading'
                    ? t('status.prepareSearch')
                    : refineState === 'loading'
                      ? t('status.prepareRefinement')
                      : issues > 0
                        ? t('status.attention')
                        : chatState === 'remote'
                          ? t('status.chatRemote')
                          : chatState === 'ready'
                            ? t('status.chatReady')
                            : chatState === 'standby'
                              ? t('status.chatStandby')
                              : chatState === 'unloaded'
                                ? t('status.chatUnloaded')
                                : t('status.idle')
  const SummaryIcon = busy
    ? LoaderCircle
    : issues > 0
      ? TriangleAlert
      : chatState === 'ready'
        ? CircleCheck
        : Circle
  const diagnosticMessages = [
    ...new Set(
      [
        status.chat.state === 'failed' ? status.chat.message : null,
        status.search.state === 'failed' ? status.search.message : null,
        status.refinement.state === 'failed' ? status.refinement.message : null,
        status.translation?.state === 'error' ? status.translation.message : null,
        backfill?.state === 'failed' ? backfill.message : null,
        activity.error,
      ].filter((message): message is string => Boolean(message)),
    ),
  ]
  const cancelIndexing = async () => {
    setStopping(true)
    setStopError(false)
    try {
      await window.api.models.cancelIndexing()
    } catch {
      setStopping(false)
      setStopError(true)
    }
  }
  return (
    <div className="app-status" ref={container}>
      <button
        type="button"
        ref={trigger}
        className={`app-status__trigger${busy ? ' is-busy' : issues > 0 ? ' has-issues' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${summary}. ${t('status.open')}`}
        onClick={() => setOpen((value) => !value)}
      >
        <SummaryIcon
          size={15}
          className={busy ? 'app-status__spinner' : undefined}
          aria-hidden="true"
        />
        <span className="app-status__summary" role="status" aria-live="polite">
          {summary}
        </span>
        {waitingJobs > 0 && (
          <span className="app-status__queue">{t('status.moreJobs', { count: waitingJobs })}</span>
        )}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="app-status__panel"
          id={id}
          ref={panel}
          role="dialog"
          aria-labelledby={`${id}-title`}
          tabIndex={-1}
        >
          <header className="app-status__heading">
            <h2 id={`${id}-title`}>{t('status.title')}</h2>
            <button
              className="app-status__close"
              type="button"
              aria-label={t('status.close')}
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
              }}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </header>
          {(activity.phase !== 'idle' || jobs.length > 0 || backfilling) && (
            <section className="app-status__work" aria-label={t('status.running')}>
              <p className="app-status__work-title">{summary}</p>
              {activity.jobs.length > 0 && (
                <>
                  <ul className="app-status__index-jobs">
                    {activity.jobs.map((job) => (
                      <li key={job.workspaceId}>
                        <span>{job.title}</span>
                        {job.total > 0 && (
                          <span>
                            {Math.min(job.done, job.total)} / {job.total}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="app-status__action"
                    disabled={stopping}
                    onClick={() => void cancelIndexing()}
                  >
                    {t(stopping ? 'status.stopping' : 'status.stopIndexing')}
                  </button>
                  {stopError && (
                    <p role="alert" className="app-status__error">
                      {t('status.stopFailed')}
                    </p>
                  )}
                </>
              )}
              {jobs.length > 0 && (
                <>
                  <ul className="app-status__jobs">
                    {jobs.map((job, index) => (
                      <li key={job.id}>
                        <div>
                          <strong>{t(`status.job.${job.kind}`)}</strong>
                          {job.detail && <span>{job.detail}</span>}
                        </div>
                        <span className="app-status__job-state">
                          {t(
                            (job.engine === 'llm' && locallyBlocked) ||
                              jobs.findIndex((other) => other.engine === job.engine) !== index
                              ? 'status.waiting'
                              : 'status.running',
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="app-status__hint">
                    {t(activity.jobs.length > 0 ? 'status.queueBehindIndex' : 'status.jobHint')}
                  </p>
                </>
              )}
            </section>
          )}
          {status.readFailed && (
            <p role="status" className="app-status__notice">
              {t('status.readFailed')}
            </p>
          )}
          <ul className="app-status__capabilities">
            {rows.map(({ key, Icon, state, description }) => (
              <li key={key}>
                <Icon className="app-status__capability-icon" size={18} aria-hidden="true" />
                <div className="app-status__capability-copy">
                  <div className="app-status__capability-title">
                    <h3>{t(`status.${key}`)}</h3>
                    {key === 'refinement' && (
                      <span className="app-status__optional">{t('status.optional')}</span>
                    )}
                  </div>
                  <p>{description}</p>
                </div>
                <span className={`app-status__state app-status__state--${state}`}>
                  {t(`status.${state}`)}
                </span>
              </li>
            ))}
          </ul>
          {diagnosticMessages.length > 0 && (
            <details className="app-status__diagnostics">
              <summary>{t('status.diagnostics')}</summary>
              {diagnosticMessages.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </details>
          )}
          {onOpenSettings && (
            <footer className="app-status__footer">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onOpenSettings('system')
                }}
              >
                <Settings2 size={16} aria-hidden="true" />
                {t('status.system')}
              </button>
            </footer>
          )}
        </div>
      )}
    </div>
  )
}

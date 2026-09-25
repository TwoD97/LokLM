import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cpu, LoaderCircle, AlertCircle } from 'lucide-react'
import { IDLE_MODEL_TRANSITION, type ModelActivity } from '@shared/modelActivity'
import { useT } from '../i18n'
import './modelActivity.css'

export function ModelActivityOverlay(): JSX.Element | null {
  const t = useT()
  const [activity, setActivity] = useState<ModelActivity>({ ...IDLE_MODEL_TRANSITION, jobs: [] })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const wasBulk = useRef(false)
  const previousPhase = useRef(activity.phase)
  const [stopping, setStopping] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const browseButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const active = activity.phase !== 'idle'
  const bulk = activity.jobs.length > 0 || activity.phase === 'restoring'
  // The title bar handles routine model switches; this view owns detailed indexing.
  const visible = active && (bulk || activity.phase === 'error')
  useEffect(() => {
    let mounted = true
    let received = false
    const off = window.api.models.onActivity((next) => {
      received = true
      if (mounted) setActivity(next)
    })
    void window.api.models
      .activity()
      .then((next) => {
        if (mounted && !received) setActivity(next)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
      off()
    }
  }, [])
  useEffect(() => {
    if (!active) {
      setDetailsOpen(false)
      wasBulk.current = false
      setStopping(false)
      setCancelError('')
    } else if (
      (bulk && !wasBulk.current) ||
      (activity.phase === 'error' && previousPhase.current !== 'error')
    ) {
      setDetailsOpen(true)
    }
    wasBulk.current = active && bulk
    previousPhase.current = activity.phase
  }, [active, bulk, activity.phase])
  useEffect(() => {
    if (visible && detailsOpen) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.current?.showModal()
      browseButton.current?.focus()
    } else {
      dialog.current?.close()
      if (returnFocus.current?.isConnected) returnFocus.current.focus()
      returnFocus.current = null
    }
  }, [visible, detailsOpen])

  if (!visible) return null
  const loadingChat = activity.target === 'llm' || activity.phase === 'restoring'
  const title =
    activity.phase === 'error'
      ? t('activity.error')
      : activity.phase === 'restoring'
        ? t('activity.restoring')
        : activity.phase === 'indexing'
          ? t('activity.indexing')
          : loadingChat
            ? t('activity.chat')
            : activity.target === 'reranker'
              ? t('activity.search')
              : t('activity.preparing')
  const total = activity.jobs.reduce((sum, job) => sum + job.total, 0)
  const done = activity.jobs.reduce((sum, job) => sum + job.done, 0)
  const progress = activity.phase === 'indexing' && total > 0 ? done / total : activity.progress
  const percent = progress == null ? null : Math.max(0, Math.min(100, Math.round(progress * 100)))
  const cancel = async (): Promise<void> => {
    setStopping(true)
    setCancelError('')
    try {
      await window.api.models.cancelIndexing()
    } catch (error) {
      setCancelError(String(error))
      setStopping(false)
    }
  }
  return (
    <>
      <div className="model-activity__bar">
        {activity.phase === 'error' ? (
          <AlertCircle size={16} aria-hidden="true" />
        ) : (
          <LoaderCircle size={16} className="model-activity__spinner" aria-hidden="true" />
        )}
        <span role="status" aria-live="polite">
          {title}
        </span>
        {percent != null && <span className="model-activity__percent">{percent}%</span>}
        <button type="button" onClick={() => setDetailsOpen(true)}>
          {t('ux.activityDetails')}
        </button>
      </div>
      {createPortal(
        <dialog
          ref={dialog}
          className="model-activity"
          aria-labelledby="model-activity-title"
          onCancel={(event) => {
            event.preventDefault()
            setDetailsOpen(false)
          }}
        >
          <div className="model-activity__icon">
            <Cpu size={28} />
          </div>
          <p className="model-activity__eyebrow">{t('activity.local')}</p>
          <h2 id="model-activity-title">{title}</h2>
          <p className="model-activity__description">
            {activity.phase === 'error'
              ? activity.error
              : activity.phase === 'restoring'
                ? t('activity.restoreHint')
                : stopping
                  ? t('activity.stopping')
                  : bulk
                    ? t('activity.indexingHint')
                    : t('activity.switchHint')}
          </p>
          {bulk && (
            <ol className="model-activity__steps" aria-label={t('activity.steps')}>
              {[t('activity.prepareStep'), t('activity.indexStep'), t('activity.restoreStep')].map(
                (label, i) => (
                  <li
                    key={label}
                    className={
                      i ===
                      (activity.phase === 'restoring' ? 2 : activity.phase === 'indexing' ? 1 : 0)
                        ? 'is-current'
                        : ''
                    }
                  >
                    <span>{i + 1}</span>
                    {label}
                  </li>
                ),
              )}
            </ol>
          )}
          {activity.phase !== 'error' && (
            <div className="model-activity__progress">
              <progress
                max={100}
                {...(percent == null ? {} : { value: percent })}
                aria-label={title}
              />
              <div className="model-activity__counts">
                <span>
                  {activity.phase === 'indexing' && total > 0
                    ? t('activity.chunks', { done, total })
                    : activity.stage === 'releasing'
                      ? t('activity.releasing')
                      : t('activity.loading')}
                </span>
                <span>{percent == null ? '' : `${percent}%`}</span>
              </div>
            </div>
          )}
          {activity.jobs.map((job, i) => (
            <p className="model-activity__file" key={`${job.workspaceId}:${i}`}>
              {job.title || t('activity.backfill')}
            </p>
          ))}
          {cancelError && <p role="alert">{cancelError}</p>}
          <div className="model-activity__actions">
            {activity.jobs.length > 0 && (
              <button disabled={stopping} onClick={() => void cancel()}>
                {t('activity.stop')}
              </button>
            )}
            <button ref={browseButton} onClick={() => setDetailsOpen(false)}>
              {t(activity.phase === 'error' ? 'common.close' : 'activity.browse')}
            </button>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}

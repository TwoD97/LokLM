import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Circle, CircleAlert, LoaderCircle, ShieldCheck, Minus } from 'lucide-react'
import type { ModelStatus, EmbedderStatus, RerankerStatus } from '@shared/documents'
import { useT } from '../i18n'
import { useSettings } from '../settings/useSettings'
import { startupPresentation } from './startupStatus'
import './warming.css'

type Props = { onReady: () => void; onOpenSettings?: () => void }
type ReadSource = 'chat' | 'search' | 'refinement' | 'warmup'

/** Startup explains availability; it never requires local organizers to wait for AI. */
export function WarmingView({ onReady, onOpenSettings }: Props): JSX.Element {
  const t = useT()
  const { settings } = useSettings()
  const [llm, setLlm] = useState<ModelStatus | null>(null)
  const [embedder, setEmbedder] = useState<EmbedderStatus | null>(null)
  const [reranker, setReranker] = useState<RerankerStatus | null>(null)
  const [readErrors, setReadErrors] = useState<ReadSource[]>([])
  const [retrying, setRetrying] = useState(false)
  const [slow, setSlow] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const advanced = useRef(false)

  useEffect(() => {
    let mounted = true
    const recordRead = (source: ReadSource, failed: boolean): void => {
      if (!mounted) return
      setReadErrors((previous) => {
        if (previous.includes(source) === failed) return previous
        return failed ? [...previous, source] : previous.filter((item) => item !== source)
      })
    }
    let llmPushed = false
    let embPushed = false
    let rrPushed = false
    const offLlm = window.api.llm.onStatus((s) => {
      llmPushed = true
      if (mounted) {
        setLlm(s)
        recordRead('chat', false)
      }
    })
    const offEmb = window.api.embedder.onStatus((s) => {
      embPushed = true
      if (mounted) {
        setEmbedder(s)
        recordRead('search', false)
      }
    })
    const offRr = window.api.reranker.onStatus((s) => {
      rrPushed = true
      if (mounted) {
        setReranker(s)
        recordRead('refinement', false)
      }
    })
    void window.api.llm
      .status()
      .then((s) => {
        if (mounted && !llmPushed) {
          setLlm(s)
          recordRead('chat', false)
        }
      })
      .catch(() => {
        if (!llmPushed) recordRead('chat', true)
      })
    void window.api.embedder
      .status()
      .then((s) => {
        if (mounted && !embPushed) {
          setEmbedder(s)
          recordRead('search', false)
        }
      })
      .catch(() => {
        if (!embPushed) recordRead('search', true)
      })
    void window.api.reranker
      .status()
      .then((s) => {
        if (mounted && !rrPushed) {
          setReranker(s)
          recordRead('refinement', false)
        }
      })
      .catch(() => {
        if (!rrPushed) recordRead('refinement', true)
      })
    setRetrying(true)
    void window.api.models
      .warmupForQa()
      .then(() => recordRead('warmup', false))
      .catch(() => recordRead('warmup', true))
      .finally(() => {
        if (mounted) setRetrying(false)
      })
    return () => {
      mounted = false
      offLlm()
      offEmb()
      offRr()
    }
  }, [attempt])

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 15_000)
    return () => clearTimeout(timer)
  }, [])

  const enter = useCallback(() => {
    if (advanced.current) return
    advanced.current = true
    onReady()
  }, [onReady])
  // Optional refinement never gates entry. Configured external services do not
  // have a local load to wait for; the UI does not claim their connection is verified.
  const usable = (status: ModelStatus | EmbedderStatus | null): boolean =>
    status?.state === 'ready' ||
    (status?.source === 'ollama' &&
      status.state !== 'failed' &&
      !('fallback' in status && status.fallback.active))
  const readError = readErrors.length > 0
  const coreReadError = readErrors.includes('chat') || readErrors.includes('search')
  const ready = usable(llm) && usable(embedder) && !coreReadError
  const preparing = retrying || llm?.state === 'loading' || embedder?.state === 'loading'
  useEffect(() => {
    if (ready) enter()
  }, [ready, enter])

  const rows = [
    {
      id: 'chat',
      title: 'startup.chat',
      hint: 'startup.chatHint',
      status: startupPresentation(llm),
    },
    {
      id: 'search',
      title: 'startup.search',
      hint: 'startup.searchHint',
      status: startupPresentation(embedder),
    },
    {
      id: 'refinement',
      title: 'startup.refinement',
      hint: 'startup.refinementHint',
      status: startupPresentation(reranker, settings?.advanced.reranker.enabled ?? true),
    },
  ]
  const failed = rows.some(
    ({ id, status }) =>
      id !== 'refinement' && (status.state === 'unavailable' || status.state === 'notLoaded'),
  )

  return (
    <section className="auth-card startup" aria-labelledby="warming-title">
      <div className="startup__vault">
        <ShieldCheck size={17} aria-hidden="true" />
        {t('auth.warmVault')}
      </div>
      <h1 id="warming-title">
        {t(failed || readError ? 'startup.problemTitle' : 'startup.title')}
      </h1>
      <p className="startup__lead">
        {t(failed || readError ? 'startup.problemLead' : 'startup.lead')}
      </p>
      <ul className="startup__models">
        {rows.map(({ id, title, hint, status }) => (
          <li key={id} className={`startup__model startup__model--${status.state}`}>
            <span className="startup__icon" aria-hidden="true">
              {status.state === 'loading' || status.state === 'checking' ? (
                <LoaderCircle size={19} className="startup__spinner" />
              ) : status.state === 'ready' ? (
                <Check size={19} />
              ) : status.state === 'unavailable' || status.state === 'notLoaded' ? (
                <CircleAlert size={19} />
              ) : status.state === 'off' || status.state === 'offAuto' ? (
                <Minus size={19} />
              ) : (
                <Circle size={16} />
              )}
            </span>
            <div className="startup__model-content">
              <div className="startup__model-head">
                <strong>{t(title)}</strong>
                {id === 'refinement' && (
                  <span className="startup__optional">{t('startup.optional')}</span>
                )}
                <span className="startup__state" role="status">
                  {t(`startup.${status.state}`)}
                </span>
              </div>
              <p>{t(status.hint ?? hint)}</p>
              {status.state === 'loading' && (
                <div className="startup__progress">
                  <progress
                    max={1}
                    {...(status.progress === null ? {} : { value: status.progress })}
                    aria-label={t(title)}
                  />
                  {status.progress !== null && <span>{Math.round(status.progress * 100)}%</span>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {readError && (
        <p role="alert" className="startup__error">
          {t('startup.readError')}
        </p>
      )}
      {slow && !failed && !readError && (
        <p className="startup__slow" role="status">
          {t('startup.slow')}
        </p>
      )}
      <div className="startup__actions">
        <button className="startup__open" onClick={enter}>
          {t('startup.open')}
        </button>
        {onOpenSettings && <button onClick={onOpenSettings}>{t('startup.settings')}</button>}
        {(failed || readError) && (
          <button disabled={preparing} onClick={() => setAttempt((current) => current + 1)}>
            {t(preparing ? 'startup.retrying' : 'startup.retry')}
          </button>
        )}
      </div>
      <p className="startup__continue-hint">{t('startup.continueHint')}</p>
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useSettings } from '../settings/useSettings'

type Props = {
  /** Called once the QA models are ready, or when the user clicks "Continue
   *  anyway". App.tsx routes this to the unlocked workspace. */
  onReady: () => void
}

type Step = 'pending' | 'loading' | 'ready' | 'failed'

function toStep(state: string): Step {
  switch (state) {
    case 'ready':
      return 'ready'
    case 'loading':
      return 'loading'
    case 'failed':
      return 'failed'
    default:
      return 'pending'
  }
}

// States where a model is DONE loading (or never will). Used to release the
// auto-advance gate so a missing / failed optional model can't trap the screen.
function isTerminal(state: string): boolean {
  return state === 'ready' || state === 'unloaded' || state === 'failed'
}

/**
 * Post-unlock loading screen. Kicks the QA model warmup (idempotent — see the
 * `models:warmupForQa` IPC) and shows a staged checklist driven by the live
 * status pushes. Auto-advances once the models are ready; a "Continue anyway"
 * link enters early while loads finish in the background. The vault is already
 * unlocked by the time this renders, so its row is shown done from the start.
 *
 * The reranker row shows on ALL tiers when enabled (the default now, lite
 * included). It's waited on only until it reaches a terminal state, so a
 * missing/failed model never hangs entry.
 */
export function WarmingView({ onReady }: Props): JSX.Element {
  const t = useT()
  const { settings } = useSettings()
  const rerankerEnabled = settings?.advanced.reranker.enabled ?? true
  // The reranker is now default-on across ALL tiers (lite included — it ships
  // the GGUF and is the precision gate the relevance floor depends on), so the
  // row shows whenever it's enabled. Was previously hidden on lite (ADR-0007),
  // when lite shipped no reranker.
  const rerankerVisible = rerankerEnabled

  const [llm, setLlm] = useState<{ state: string; loadProgress: number | null; source: string }>({
    state: 'idle',
    loadProgress: null,
    source: 'bundled',
  })
  const [embedder, setEmbedder] = useState<{ state: string; loadProgress: number | null }>({
    state: 'idle',
    loadProgress: null,
  })
  const [reranker, setReranker] = useState<{ state: string; loadProgress: number | null }>({
    state: 'idle',
    loadProgress: null,
  })
  const advanced = useRef(false)

  useEffect(() => {
    // Dedupe identical pushes: a multi-GB load streams loadProgress rapidly, so
    // bail when nothing changed to keep React idle during the load.
    const applyLlm = (s: { state: string; loadProgress: number | null; source: string }): void =>
      setLlm((p) =>
        p.state === s.state && p.loadProgress === s.loadProgress && p.source === s.source ? p : s,
      )
    const applyEmb = (s: { state: string; loadProgress: number | null }): void =>
      setEmbedder((p) => (p.state === s.state && p.loadProgress === s.loadProgress ? p : s))
    const applyRr = (s: { state: string; loadProgress: number | null }): void =>
      setReranker((p) => (p.state === s.state && p.loadProgress === s.loadProgress ? p : s))

    // Decoupled from triggering: the warmup is fire-and-forget on the main side
    // (serialized, idempotent), so this screen never blocks on it — it only
    // observes the resulting status pushes.
    void window.api.models.warmupForQa().catch(() => undefined)
    void window.api.llm
      .status()
      .then((s) => applyLlm({ state: s.state, loadProgress: s.loadProgress, source: s.source }))
    void window.api.embedder
      .status()
      .then((s) => applyEmb({ state: s.state, loadProgress: s.loadProgress }))
    void window.api.reranker
      .status()
      .then((s) => applyRr({ state: s.state, loadProgress: s.loadProgress }))
    const offLlm = window.api.llm.onStatus((s) =>
      applyLlm({ state: s.state, loadProgress: s.loadProgress, source: s.source }),
    )
    const offEmb = window.api.embedder.onStatus((s) =>
      applyEmb({ state: s.state, loadProgress: s.loadProgress }),
    )
    const offRr = window.api.reranker.onStatus((s) =>
      applyRr({ state: s.state, loadProgress: s.loadProgress }),
    )
    return () => {
      offLlm()
      offEmb()
      offRr()
    }
  }, [])

  // External Ollama never loads the bundled GGUF, so its status stays idle —
  // treat the remote LLM as ready so the screen doesn't hang on a load that
  // will never fire.
  const llmReady = llm.state === 'ready' || llm.source === 'ollama'
  const embReady = embedder.state === 'ready'
  // Wait for the reranker when it's enabled, but release on any terminal state
  // so a missing/failed model can't trap entry. Skipped only if disabled.
  const rrReady = !rerankerVisible || isTerminal(reranker.state)
  const allReady = llmReady && embReady && rrReady

  const enter = (): void => {
    if (advanced.current) return
    advanced.current = true
    onReady()
  }

  useEffect(() => {
    if (allReady) enter()
    // enter() is idempotent via the ref guard; deps intentionally minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReady])

  const rows: Array<{ key: string; label: string; step: Step; progress: number | null }> = [
    { key: 'vault', label: t('auth.warmVault'), step: 'ready', progress: null },
    {
      key: 'llm',
      label: t('auth.warmLlm'),
      step: llmReady ? 'ready' : toStep(llm.state),
      progress: llm.loadProgress,
    },
    {
      key: 'embedder',
      label: t('auth.warmEmbedder'),
      step: toStep(embedder.state),
      progress: embedder.loadProgress,
    },
    // Present on all tiers when the reranker is enabled (the default). Omitted
    // only if a user explicitly disabled it in settings.
    ...(rerankerVisible
      ? [
          {
            key: 'reranker',
            label: t('auth.warmReranker'),
            step: toStep(reranker.state),
            progress: reranker.loadProgress,
          },
        ]
      : []),
  ]

  return (
    <section
      className="auth-card auth-card--warming"
      aria-labelledby="warming-title"
      aria-live="polite"
    >
      <h1 id="warming-title">{t('auth.warmTitle')}</h1>
      <p className="auth-card__lead auth-card__lead--centered">{t('auth.warmLead')}</p>
      <ul className="warming__list">
        {rows.map((r) => (
          <li key={r.key} className={`warming__row warming__row--${r.step}`}>
            <span className="warming__icon" aria-hidden="true">
              {r.step === 'loading' ? (
                <span className="warming__spinner" />
              ) : r.step === 'ready' ? (
                '✓'
              ) : r.step === 'failed' ? (
                '⚠'
              ) : (
                '○'
              )}
            </span>
            <span className="warming__label">{r.label}</span>
            <span className="warming__state">
              {r.step === 'loading' ? (
                <span className="warming__bar">
                  <span
                    className={`warming__bar-fill${
                      r.progress == null ? ' warming__bar-fill--indeterminate' : ''
                    }`}
                    style={
                      r.progress != null ? { width: `${Math.round(r.progress * 100)}%` } : undefined
                    }
                  />
                </span>
              ) : r.step === 'ready' ? (
                <span className="warming__done">{t('auth.warmReady')}</span>
              ) : r.step === 'failed' ? (
                <span className="warming__failed">{t('auth.warmFailed')}</span>
              ) : (
                <span className="warming__pending">{t('auth.warmPending')}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="link link--centered" onClick={enter}>
        {t('auth.warmContinue')}
      </button>
    </section>
  )
}

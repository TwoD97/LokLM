import { useEffect, useState } from 'react'
import { Settings as SettingsIcon, Lock as LockIcon } from 'lucide-react'
import type { BackfillStatus, EmbedderState, ModelState, RerankerState } from '@shared/documents'
import type { TranslatorStatus } from '@shared/translation'
import { useT, type TFn } from './i18n'
import { useSettings } from './settings/useSettings'

type DotState = EmbedderState | RerankerState | ModelState
type DotSource = 'bundled' | 'ollama'

// The translation model and whisper STT both run locally-only and have their
// own state vocabularies; collapse them onto the shared dot states so they
// read in the titlebar exactly like the LLM / embedder / reranker dots.
function translatorDotState(s: TranslatorStatus): DotState {
  switch (s.state) {
    case 'ready':
      return 'ready'
    case 'starting':
      return 'loading'
    case 'installed':
      return 'idle'
    case 'error':
      return 'failed'
    case 'not_installed':
    default:
      return 'unloaded'
  }
}

// Maps the raw service state + source onto the pill text shown in the hover
// tooltip. Mirrors the LLM chat-header pill vocabulary ("Local"/"Remote") so
// the TitleBar reads consistently with the rest of the app.
function pillText(t: TFn, state: DotState, source: DotSource): string {
  const where = source === 'ollama' ? t('shell.locationRemote') : t('shell.locationLocal')
  switch (state) {
    case 'ready':
      return t('shell.statusRunning', { where })
    case 'loading':
      return t('shell.statusLoading', { where })
    case 'failed':
      return t('shell.statusFailed', { where })
    case 'unloaded':
      return t('shell.statusUnloaded', { where })
    case 'idle':
    default:
      return t('shell.statusIdle', { where })
  }
}

// Native `title=` fallback for screen readers and users who hover before our
// custom tooltip renders. The pill is decorative; this string is the truth.
function ariaText(
  t: TFn,
  label: string,
  state: DotState,
  source: DotSource,
  message: string | null,
): string {
  const base = `${label}: ${pillText(t, state, source)}`
  return message ? `${base} — ${message}` : base
}

// Maps the raw backend label from ModelStatus.gpu ('cuda'|'vulkan'|'metal'|
// 'cpu'|null) onto a short chip + a full hover-line. Null when unknown (no load
// yet, or a remote source that doesn't report a device).
function deviceLabel(t: TFn, gpu: string | null): Chip | null {
  if (gpu == null) return null
  if (gpu === 'cpu') {
    const cpu = t('shell.deviceCpu')
    return { short: cpu, full: t('shell.runningOn', { device: cpu }), tone: 'cpu' }
  }
  const full = t('shell.deviceGpu', { backend: gpu.toUpperCase() })
  return {
    short: t('shell.deviceGpuShort'),
    full: t('shell.runningOn', { device: full }),
    tone: 'gpu',
  }
}

// Short, glanceable label for the resident embedder GGUF. ADR-0006: a codebase
// workspace should show "Qwen3" (the code embedder); everything else "BGE-M3".
// Falls back to a cleaned filename for any other *embed*.gguf a user dropped in.
function shortEmbedderName(modelName: string | null): string | null {
  if (!modelName) return null
  const n = modelName.toLowerCase()
  if (/qwen3[-_]?embedding/.test(n)) return 'Qwen3'
  if (/bge[-_]?m3/.test(n)) return 'BGE-M3'
  return (
    modelName
      .split(/[\\/]/)
      .pop()!
      .replace(/\.gguf$/i, '')
      .replace(/[-_.]?q\d.*$/i, '') || modelName
  )
}

type Chip = { short: string; full: string; tone: 'gpu' | 'cpu' | 'code' | 'doc' }

type DotProps = {
  label: string
  state: DotState
  source: DotSource
  message: string | null
  extraClass?: string
  /** Always-visible text chip next to the dot (rendered when ready), e.g. the
   *  LLM's compute device or the resident embedder model. Also shown in the pill. */
  chip?: Chip | null
}

function StatusDot({ label, state, source, message, extraClass, chip }: DotProps): JSX.Element {
  const t = useT()
  const ollamaClass = state === 'ready' && source === 'ollama' ? ' titlebar__dot--ollama' : ''
  return (
    <span
      className={`titlebar__dot-wrap${extraClass ? ` ${extraClass}` : ''}`}
      role="img"
      aria-label={
        ariaText(t, label, state, source, message) +
        (chip && state === 'ready' ? ` — ${chip.full}` : '')
      }
    >
      <span className={`titlebar__dot titlebar__dot--${state}${ollamaClass}`} aria-hidden="true" />
      {chip && state === 'ready' && (
        <span className={`titlebar__device titlebar__device--${chip.tone}`} aria-hidden="true">
          {chip.short}
        </span>
      )}
      <span className="titlebar__pill" role="tooltip">
        <span className="titlebar__pill-label">{label}</span>
        <span className={`titlebar__pill-dot titlebar__pill-dot--${state}${ollamaClass}`} />
        <span className="titlebar__pill-text">{pillText(t, state, source)}</span>
        {chip && <span className="titlebar__pill-device">{chip.full}</span>}
        {message && <span className="titlebar__pill-msg">{message}</span>}
      </span>
    </span>
  )
}

type TitleBarProps = {
  onOpenSettings?: () => void
  unlocked?: boolean
}

export function TitleBar({ onOpenSettings, unlocked = false }: TitleBarProps = {}): JSX.Element {
  const t = useT()
  const { settings } = useSettings()
  // Default to shown until settings hydrate, so the dot doesn't flicker out on
  // first paint for the common (reranker-on) case. Hidden only once we know the
  // user / tier disabled the rerank stage.
  const rerankerEnabled = settings?.advanced.reranker.enabled ?? true
  const [maximized, setMaximized] = useState(false)
  const [embedder, setEmbedder] = useState<{
    state: EmbedderState
    message: string | null
    source: DotSource
    // ADR-0006: which bundled embedder is resident — jina-code (codebase
    // workspaces) vs BGE-M3 — so the dot can say "Code embedder" when active.
    modelName: string | null
  }>({
    state: 'idle',
    message: null,
    source: 'bundled',
    modelName: null,
  })
  const [reranker, setReranker] = useState<{
    state: RerankerState
    message: string | null
    source: DotSource
  }>({
    state: 'idle',
    message: null,
    source: 'bundled',
  })
  const [llm, setLlm] = useState<{
    state: ModelState
    message: string | null
    source: DotSource
    gpu: string | null
  }>({
    state: 'idle',
    message: null,
    source: 'bundled',
    gpu: null,
  })
  // Live vector re-embed progress (model swap / backfill). When running, the
  // embedder chip shows "↻ N%" because dense search is degraded until it lands.
  const [backfill, setBackfill] = useState<BackfillStatus | null>(null)
  const [translation, setTranslation] = useState<TranslatorStatus | null>(null)
  // Whisper has no live status push (it loads per-transcription) , so we only
  // know presence/download state. 'idle' once a model is on disk = ready to
  // use; refreshed on window focus to catch a download done in the STT view.
  const [whisper, setWhisper] = useState<DotState>('unloaded')

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    const off = window.api.window.onMaximizedChange(setMaximized)
    return () => off()
  }, [])

  useEffect(() => {
    void window.api.embedder.status().then((s) =>
      setEmbedder({
        state: s.state,
        message: s.message,
        source: s.source,
        modelName: s.modelName,
      }),
    )
    const off = window.api.embedder.onStatus((s) =>
      setEmbedder({ state: s.state, message: s.message, source: s.source, modelName: s.modelName }),
    )
    return () => off()
  }, [])

  useEffect(() => {
    void window.api.reranker
      .status()
      .then((s) => setReranker({ state: s.state, message: s.message, source: s.source }))
    const off = window.api.reranker.onStatus((s) =>
      setReranker({ state: s.state, message: s.message, source: s.source }),
    )
    return () => off()
  }, [])

  useEffect(() => {
    void window.api.llm
      .status()
      .then((s) => setLlm({ state: s.state, message: s.message, source: s.source, gpu: s.gpu }))
    const off = window.api.llm.onStatus((s) =>
      setLlm({ state: s.state, message: s.message, source: s.source, gpu: s.gpu }),
    )
    return () => off()
  }, [])

  useEffect(() => {
    const off = window.api.embedder.onBackfillStatus(setBackfill)
    return () => off()
  }, [])

  useEffect(() => {
    void window.api.translation.status().then(setTranslation)
    const off = window.api.translation.onStatus(setTranslation)
    return () => off()
  }, [])

  useEffect(() => {
    const refresh = (): void => {
      void window.api.transcription.modelStatus().then((models) => {
        if (models.some((m) => m.downloading)) setWhisper('loading')
        else if (models.some((m) => m.present)) setWhisper('idle')
        else setWhisper('unloaded')
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  // ADR-0006: the visible embedder chip. Tone 'code' (green) when the resident
  // model is the code embedder (Qwen3), 'doc' (neutral) for BGE-M3 — so a
  // codebase workspace stuck on the BGE fallback is obvious at a glance. While a
  // vector re-embed is running (model swap / backfill) the chip shows "↻ N%" in
  // amber instead, because dense search is degraded until it completes.
  const embIsCode = /qwen3[-_]?embedding/i.test(embedder.modelName ?? '')
  const embShort = shortEmbedderName(embedder.modelName)
  const reembedding = backfill?.state === 'running' && backfill.total > 0
  // Clamp: the denominator can lag behind concurrent indexing, so guard the UI
  // against a transient >100% even though the service now grows `total`.
  const reembedPct = reembedding
    ? Math.min(100, Math.round((backfill!.done / backfill!.total) * 100))
    : 0
  const embChip: Chip | null = reembedding
    ? {
        short: `↻ ${reembedPct}%`,
        full: `re-embedding ${backfill!.done}/${backfill!.total} chunks — search degraded until done`,
        tone: 'cpu',
      }
    : embShort
      ? {
          short: embShort,
          full: `${embIsCode ? 'Code embedder' : 'Document embedder'} — ${embShort}`,
          tone: embIsCode ? 'code' : 'doc',
        }
      : null

  return (
    <div className="titlebar" role="presentation">
      <div className="titlebar__brand-group">
        <span className="titlebar__logo" aria-hidden="true">
          <svg viewBox="0 0 64 64" width="16" height="16" fill="none">
            <rect
              x="14"
              y="22"
              width="36"
              height="30"
              rx="2"
              stroke="#F6F4EF"
              strokeWidth="3"
              opacity="0.4"
            />
            <rect
              x="11"
              y="17"
              width="36"
              height="30"
              rx="2"
              stroke="#F6F4EF"
              strokeWidth="3"
              opacity="0.7"
            />
            <rect
              x="8"
              y="12"
              width="36"
              height="30"
              rx="2"
              fill="#0B1B2B"
              stroke="#F6F4EF"
              strokeWidth="3"
            />
            <circle cx="38" cy="20" r="2.6" fill="#7DD3FC" />
          </svg>
        </span>
        <span className="titlebar__brand">LokLM</span>
      </div>

      <div className="titlebar__status" aria-label={t('shell.modelStatus')}>
        <StatusDot
          label="LLM"
          state={llm.state}
          source={llm.source}
          message={llm.message}
          // Device is only meaningful for the local engine; a remote Ollama
          // session runs on the host's hardware, which we can't report.
          chip={llm.source === 'ollama' ? null : deviceLabel(t, llm.gpu)}
        />
        <StatusDot
          // ADR-0006: surface the resident embedder — the code model
          // (Qwen3-Embedding) → "Code embedder", otherwise the doc model
          // (BGE-M3) → "Embedder". The chip shows the model name visibly so a
          // codebase workspace can confirm Qwen3 is actually resident at a glance.
          label={embIsCode ? 'Code embedder' : 'Embedder'}
          state={embedder.state}
          source={embedder.source}
          message={embedder.message}
          chip={embChip}
        />
        {rerankerEnabled && (
          <StatusDot
            label="Reranker"
            state={reranker.state}
            source={reranker.source}
            message={reranker.message}
          />
        )}
        {translation && translation.sidecarAvailable && (
          <StatusDot
            label="Translation"
            state={translatorDotState(translation)}
            source="bundled"
            message={translation.message}
          />
        )}
        <StatusDot label="STT" state={whisper} source="bundled" message={null} />
      </div>

      <div className="titlebar__spacer" />

      <div className="titlebar__controls">
        {unlocked && (
          <button
            type="button"
            className="titlebar__btn titlebar__btn--icon"
            aria-label={t('auth.lock')}
            title={t('auth.lock')}
            onClick={() => void window.api.auth.lock()}
          >
            <LockIcon size={16} aria-hidden="true" />
          </button>
        )}
        {unlocked && onOpenSettings && (
          <button
            type="button"
            className="titlebar__btn titlebar__btn--icon"
            aria-label={t('shell.settings')}
            title={t('shell.settings')}
            onClick={onOpenSettings}
          >
            <SettingsIcon size={16} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="titlebar__btn"
          aria-label={t('shell.minimize')}
          onClick={() => void window.api.window.minimize()}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar__btn"
          aria-label={maximized ? t('shell.restore') : t('shell.maximize')}
          onClick={() => void window.api.window.toggleMaximize()}
        >
          {maximized ? (
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
              <rect
                x="2"
                y="0.5"
                width="7.5"
                height="7.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
              <rect
                x="0.5"
                y="2"
                width="7.5"
                height="7.5"
                fill="var(--bg-0)"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="9"
                height="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="titlebar__btn titlebar__btn--close"
          aria-label={t('common.close')}
          onClick={() => void window.api.window.close()}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Settings as SettingsIcon, Lock as LockIcon } from 'lucide-react'
import type {
  BackfillStatus,
  EmbedderState,
  GpuKind,
  ModelState,
  RerankerState,
} from '@shared/documents'
import type { TranslatorStatus } from '@shared/translation'
import { useT, type TFn } from './i18n'
import { useSettings } from './settings/useSettings'
import {
  useGeneration,
  type GenerationKind,
  type GenerationEngine,
  type GenerationJob,
} from './generation/GenerationContext'

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

// Maps the raw backend label from ModelStatus.gpu ('cuda'|'vulkan'|'metal'|
// 'cpu'|null) + the resolved device class onto the full "running on …" line for
// the LLM hover pill. Names the class ("integrated"/"dedicated") when known.
// Null when unknown (no load yet, or a remote source that doesn't report one).
function deviceLine(t: TFn, gpu: string | null, gpuKind: GpuKind | null): string | null {
  if (gpu == null) return null
  if (gpu === 'cpu') return t('shell.runningOn', { device: t('shell.deviceCpu') })
  const backend = gpu.toUpperCase()
  const kindWord =
    gpuKind === 'integrated'
      ? t('shell.kindIntegrated')
      : gpuKind === 'dedicated'
        ? t('shell.kindDedicated')
        : null
  const device = kindWord
    ? t('shell.deviceGpuKind', { backend, kind: kindWord })
    : t('shell.deviceGpu', { backend })
  return t('shell.runningOn', { device })
}

// Cleans an arbitrary GGUF path down to a glanceable name: basename, no
// extension, no quant suffix. Shared fallback for every model-name chip.
function cleanGgufName(modelName: string): string {
  return (
    modelName
      .split(/[\\/]/)
      .pop()!
      .replace(/\.gguf$/i, '')
      .replace(/[-_.]?q\d.*$/i, '') || modelName
  )
}

// Short, glanceable label for the resident embedder GGUF. ADR-0006: a codebase
// workspace shows "Qwen3" (the code embedder); everything else the doc embedder
// "BGE". Falls back to a cleaned filename for any other *embed*.gguf dropped in.
function shortEmbedderName(modelName: string | null): string | null {
  if (!modelName) return null
  const n = modelName.toLowerCase()
  if (/qwen3[-_]?embedding/.test(n)) return 'Qwen3'
  if (/bge[-_]?m3/.test(n)) return 'BGE'
  return cleanGgufName(modelName)
}

// Family label for the resident LLM GGUF — the chip text next to the LLM dot.
// We show the family ("Qwen") to match the embedder/reranker tags; the exact
// variant + compute device live in the hover pill.
function shortLlmName(modelName: string | null): string | null {
  if (!modelName) return null
  const n = modelName.toLowerCase()
  if (/qwen/.test(n)) return 'Qwen'
  if (/llama/.test(n)) return 'Llama'
  if (/nemotron/.test(n)) return 'Nemotron'
  if (/mistral/.test(n)) return 'Mistral'
  return cleanGgufName(modelName)
}

// Family label for the resident reranker GGUF (bundled: bge-reranker-v2-m3 →
// "BGE"). Falls back to a cleaned filename for a side-loaded reranker.
function shortRerankerName(modelName: string | null): string | null {
  if (!modelName) return null
  if (/bge/i.test(modelName)) return 'BGE'
  return cleanGgufName(modelName)
}

// A model-name chip. The chip TEXT (Qwen/BGE/Qwen3/Whisper/MADLAD) carries the
// which-model distinction; it is only rendered once the model is resident, so
// the green 'model' tone reads honestly as "loaded". `tone` flags the lone
// exception — the amber re-embed progress chip ('busy').
type Chip = { short: string; full: string; tone: 'model' | 'busy' }

type DotProps = {
  label: string
  state: DotState
  source: DotSource
  message: string | null
  extraClass?: string
  /** Always-visible model-name chip next to the dot, e.g. "Qwen" / "BGE". Also
   *  shown in the hover pill. Rendered only while the dot is in `chipStates`. */
  chip?: Chip | null
  /** Dot states in which the chip is shown. Default ['ready'] — a model only
   *  tags itself once resident; in any other state the bare dot suffices. */
  chipStates?: DotState[]
}

function StatusDot({
  label,
  state,
  source,
  message,
  extraClass,
  chip,
  chipStates = ['ready'],
}: DotProps): JSX.Element {
  const t = useT()
  const ollamaClass = state === 'ready' && source === 'ollama' ? ' titlebar__dot--ollama' : ''
  const status = pillText(t, state, source)
  // A chip is only ever shown once its model is resident (chipStates defaults to
  // ['ready']), so green ('model') reads honestly as "loaded". The amber 'busy'
  // tone is the lone exception — the re-embed progress chip.
  const showChip = !!chip && chipStates.includes(state)
  return (
    <span
      className={`titlebar__dot-wrap${extraClass ? ` ${extraClass}` : ''}`}
      role="img"
      aria-label={
        `${label}: ${status}${message ? ` — ${message}` : ''}` +
        (showChip ? ` — ${chip!.full}` : '')
      }
    >
      <span className={`titlebar__dot titlebar__dot--${state}${ollamaClass}`} aria-hidden="true" />
      {showChip && (
        <span className={`titlebar__device titlebar__device--${chip!.tone}`} aria-hidden="true">
          {chip!.short}
        </span>
      )}
      <span className="titlebar__pill" role="tooltip">
        <span className="titlebar__pill-label">{label}</span>
        <span className={`titlebar__pill-dot titlebar__pill-dot--${state}${ollamaClass}`} />
        <span className="titlebar__pill-text">{status}</span>
        {chip && <span className="titlebar__pill-device">{chip.full}</span>}
        {message && <span className="titlebar__pill-msg">{message}</span>}
      </span>
    </span>
  )
}

// i18n key per generation kind for the Activity indicator label.
const GEN_KIND_KEY: Record<GenerationKind, string> = {
  chat: 'shell.genChat',
  quiz: 'shell.genQuiz',
  summary: 'shell.genSummary',
  writing: 'shell.genWriting',
  translation: 'shell.genTranslation',
  transcription: 'shell.genTranscription',
}

// Fixed render order so the chips don't reshuffle as jobs come and go.
const ENGINE_ORDER: GenerationEngine[] = ['llm', 'translation', 'transcription']

// Hover-tooltip key per engine — explains WHY work may be waiting: the bundled
// LLM is a single serial worker (requests run one at a time / queue), while
// translation + transcription are their own models that run alongside it.
const ENGINE_TIP_KEY: Record<GenerationEngine, string> = {
  llm: 'shell.genTipSequential',
  translation: 'shell.genTipConcurrent',
  transcription: 'shell.genTipConcurrent',
}

// Always-visible "the model is busy" chips. One chip PER ENGINE: the bundled LLM
// is a serial FIFO (chat/quiz/summary/writing queue behind each other — index 0
// runs, the rest are "N waiting"), while translation (MADLAD) and transcription
// (Whisper) are separate models that run concurrently, so they get their own
// chip rather than being counted as queued behind an LLM turn. Renders nothing
// when everything is idle.
function ActivityIndicator(): JSX.Element | null {
  const t = useT()
  const { jobs } = useGeneration()
  if (jobs.length === 0) return null
  const byEngine = new Map<GenerationEngine, GenerationJob[]>()
  for (const job of jobs) {
    const list = byEngine.get(job.engine)
    if (list) list.push(job)
    else byEngine.set(job.engine, [job])
  }
  return (
    <div className="titlebar__activity-group">
      {ENGINE_ORDER.filter((e) => byEngine.has(e)).map((engine) => {
        const list = byEngine.get(engine)!
        const front = list[0]!
        const queued = list.length - 1
        const kindLabel = t(GEN_KIND_KEY[front.kind])
        const label = front.detail ? `${kindLabel} — ${front.detail}` : kindLabel
        return (
          // The .item wrapper does NOT clip (the bar itself is overflow:hidden
          // for the sweep), so the hover tooltip can extend below the bar.
          <div key={engine} className="titlebar__activity-item">
            <div
              className="titlebar__activity"
              role="status"
              aria-live="polite"
              aria-label={t('shell.genBusyAria', { label, queued })}
            >
              <span className="titlebar__activity-text">{label}</span>
              {queued > 0 && (
                <span className="titlebar__activity-queue">
                  {t('shell.genQueued', { count: queued })}
                </span>
              )}
            </div>
            <span className="titlebar__activity-tip" role="tooltip">
              {t(ENGINE_TIP_KEY[engine])}
            </span>
          </div>
        )
      })}
    </div>
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
  // The reranker status dot shows on all tiers when enabled (the default now,
  // lite included — it ships the GGUF and runs the rerank stage). Hidden only
  // when a user explicitly disables the rerank stage in settings.
  const rerankerVisible = rerankerEnabled
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
    modelName: string | null
  }>({
    state: 'idle',
    message: null,
    source: 'bundled',
    modelName: null,
  })
  const [llm, setLlm] = useState<{
    state: ModelState
    message: string | null
    source: DotSource
    gpu: string | null
    gpuKind: GpuKind | null
    modelName: string | null
  }>({
    state: 'idle',
    message: null,
    source: 'bundled',
    gpu: null,
    gpuKind: null,
    modelName: null,
  })
  // Live vector re-embed progress (model swap / backfill). When running, the
  // embedder chip shows "↻ N%" because dense search is degraded until it lands.
  const [backfill, setBackfill] = useState<BackfillStatus | null>(null)
  const [translation, setTranslation] = useState<TranslatorStatus | null>(null)
  // Whisper has no live status push: the model is shipped/downloaded by the
  // installer wizard (never in-app), and it loads per-transcription rather than
  // staying resident. The dot is therefore a binary "loaded or not": 'ready'
  // (green + "Whisper" chip) once a model is on the box and usable, 'unloaded'
  // otherwise; refreshed on focus to catch a model added by the wizard while
  // the app was open.
  const [whisper, setWhisper] = useState<DotState>('unloaded')
  // Live generation registry — an in-flight 'transcription' job means Whisper is
  // loaded and working right now, which is the only time it is truly resident.
  const { jobs } = useGeneration()

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
    void window.api.reranker.status().then((s) =>
      setReranker({
        state: s.state,
        message: s.message,
        source: s.source,
        modelName: s.modelName,
      }),
    )
    const off = window.api.reranker.onStatus((s) =>
      setReranker({ state: s.state, message: s.message, source: s.source, modelName: s.modelName }),
    )
    return () => off()
  }, [])

  useEffect(() => {
    void window.api.llm.status().then((s) =>
      setLlm({
        state: s.state,
        message: s.message,
        source: s.source,
        gpu: s.gpu,
        gpuKind: s.gpuKind ?? null,
        modelName: s.modelName,
      }),
    )
    const off = window.api.llm.onStatus((s) =>
      setLlm({
        state: s.state,
        message: s.message,
        source: s.source,
        gpu: s.gpu,
        gpuKind: s.gpuKind ?? null,
        modelName: s.modelName,
      }),
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
      // Presence only — downloads are an installer-wizard concern, not in-app, so
      // 'ready' (on disk, usable) vs 'unloaded' (absent) is all the poll
      // resolves. 'idle' used to render identically to 'unloaded', which read as
      // "whisper never loads" — presence now maps straight to 'ready'. The
      // 'downloading' branch stays as a harmless guard in case a model lands
      // while the app is open.
      void window.api.transcription.modelStatus().then((models) => {
        if (models.some((m) => m.downloading)) setWhisper('loading')
        else if (models.some((m) => m.present)) setWhisper('ready')
        else setWhisper('unloaded')
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  // ADR-0006: the visible embedder chip. The chip TEXT tells code (Qwen3) from
  // doc (BGE) at a glance; the tone is green ('model') whenever resident, like
  // every other model tag. While a vector re-embed is running (model swap /
  // backfill) the chip shows "↻ N%" in amber instead, because dense search is
  // degraded until it completes.
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
        full: t('shell.reembedProgress', { done: backfill!.done, total: backfill!.total }),
        tone: 'busy',
      }
    : embShort
      ? {
          short: embShort,
          full: `${embIsCode ? 'Code embedder' : 'Document embedder'} — ${embShort}`,
          tone: 'model',
        }
      : null

  // LLM dot: show the model family ("Qwen"); the exact variant + compute device
  // (iGPU/dGPU) live in the hover pill. Shown via showChip once the dot is ready.
  const llmDeviceLine = llm.source === 'ollama' ? null : deviceLine(t, llm.gpu, llm.gpuKind)
  const llmShort = shortLlmName(llm.modelName)
  const llmChip: Chip | null = llmShort
    ? {
        short: llmShort,
        full: llmDeviceLine
          ? `${llm.modelName} — ${llmDeviceLine}`
          : `${llm.modelName}${llm.source === 'ollama' ? ` — ${t('shell.locationRemote')}` : ''}`,
        tone: 'model',
      }
    : null

  // Reranker dot: the bundled cross-encoder is bge-reranker-v2-m3 → "BGE".
  const rerankShort = shortRerankerName(reranker.modelName)
  const rerankChip: Chip | null = rerankShort
    ? { short: rerankShort, full: `Reranker — ${reranker.modelName ?? rerankShort}`, tone: 'model' }
    : null

  // STT dot: binary loaded-or-not. On-disk presence already renders 'ready'
  // (whisper loads per-call, so "installed and usable" is its loaded state);
  // an in-flight 'transcription' job keeps it 'ready' too, covering the
  // window where the poll hasn't run yet. Actual run activity is surfaced by
  // the ActivityIndicator ("Transcribing …"), not this dot.
  const sttActive = jobs.some((j) => j.engine === 'transcription')
  const whisperState: DotState = sttActive ? 'ready' : whisper
  const whisperChip: Chip | null =
    whisperState === 'ready'
      ? { short: 'Whisper', full: 'Speech-to-text — Whisper', tone: 'model' }
      : null

  // Translation dot: the MADLAD sidecar — tagged once the model is loaded.
  const translationChip: Chip | null =
    translation && translatorDotState(translation) === 'ready'
      ? { short: 'MADLAD', full: 'Translation — MADLAD', tone: 'model' }
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
          chip={llmChip}
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
        {rerankerVisible && (
          <StatusDot
            label="Reranker"
            state={reranker.state}
            source={reranker.source}
            message={reranker.message}
            chip={rerankChip}
          />
        )}
        {translation && translation.sidecarAvailable && (
          <StatusDot
            label="Translation"
            state={translatorDotState(translation)}
            source="bundled"
            message={translation.message}
            chip={translationChip}
          />
        )}
        <StatusDot
          label="STT"
          state={whisperState}
          source="bundled"
          message={null}
          chip={whisperChip}
        />
      </div>

      <div className="titlebar__spacer" />

      <ActivityIndicator />

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

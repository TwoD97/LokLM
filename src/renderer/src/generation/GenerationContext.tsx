import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * Renderer-wide registry of in-flight model generations. The bundled LLM runs
 * one native op at a time (the worker FIFO — see modelsWorker.ts), and the
 * benchmark on the lite iGPU confirmed concurrency is a net loss there, so we
 * KEEP that serialization and merely make it *legible*: this registry is a pure
 * 1-slot queue mirror. Each user-initiated generation (chat answer, quiz build,
 * summary, rewrite, translation) registers a job for its lifetime; the TitleBar
 * Activity indicator reads the list to show "Generating: X · N waiting" so the
 * user understands the model is busy and how deep the queue is — across views,
 * since these run independently of which tab is mounted.
 *
 * This is deliberately renderer-side and feature-granular: one chat send is one
 * job (not the handful of native sub-ops it spawns), which is the right level
 * for a human-facing indicator. It is NOT the authoritative scheduler — the
 * worker FIFO is — it only reflects what the UI has dispatched.
 */
export type GenerationKind =
  | 'chat'
  | 'quiz'
  | 'summary'
  | 'writing'
  | 'translation'
  | 'transcription'

/**
 * Which model/worker a kind runs on. The bundled LLM is one serial FIFO, so
 * chat/quiz/summary/writing queue behind each other ("N waiting"). Translation
 * (MADLAD) and transcription (Whisper) are SEPARATE models on their own workers
 * — they run concurrently with the LLM and with each other, so the indicator
 * gives them their own chip instead of counting them as queued behind an LLM
 * turn. (On a shared iGPU they still contend for compute, but they are not
 * FIFO-serialized by the LLM worker — different resource.)
 */
export type GenerationEngine = 'llm' | 'translation' | 'transcription'

const ENGINE_FOR_KIND: Record<GenerationKind, GenerationEngine> = {
  chat: 'llm',
  quiz: 'llm',
  summary: 'llm',
  writing: 'llm',
  translation: 'translation',
  transcription: 'transcription',
}

export type GenerationJob = {
  id: string
  kind: GenerationKind
  engine: GenerationEngine
  /** Optional human detail shown after the kind label, e.g. a deck name. */
  detail?: string
  startedAt: number
}

type GenerationApi = {
  /** Active jobs in dispatch order. Because execution is serial (FIFO), treat
   *  index 0 as the one actually running and the rest as queued. */
  jobs: GenerationJob[]
  /**
   * Register a job and get back a one-shot `end()` to call when it settles.
   * `end` is idempotent — safe to call from both a success path and a cleanup.
   */
  begin: (kind: GenerationKind, detail?: string) => () => void
}

const GenerationCtx = createContext<GenerationApi | null>(null)

export function GenerationProvider({ children }: { children: ReactNode }): JSX.Element {
  const [jobs, setJobs] = useState<GenerationJob[]>([])
  const seq = useRef(0)

  const begin = useCallback((kind: GenerationKind, detail?: string) => {
    const id = `gen-${++seq.current}`
    const job: GenerationJob = { id, kind, engine: ENGINE_FOR_KIND[kind], startedAt: Date.now() }
    if (detail) job.detail = detail
    setJobs((prev) => [...prev, job])
    let ended = false
    return () => {
      if (ended) return
      ended = true
      setJobs((prev) => prev.filter((j) => j.id !== id))
    }
  }, [])

  const value = useMemo<GenerationApi>(() => ({ jobs, begin }), [jobs, begin])
  return <GenerationCtx.Provider value={value}>{children}</GenerationCtx.Provider>
}

/** No-op-safe value used when `useGeneration` is called outside a provider
 *  (e.g. an isolated component test) so callers never crash; the real provider
 *  wraps the app at the root. */
const FALLBACK: GenerationApi = {
  jobs: [],
  begin: () => () => {},
}

/** Access the generation registry. Falls back to a no-op registry when rendered
 *  outside a provider. */
// eslint-disable-next-line react-refresh/only-export-components
export function useGeneration(): GenerationApi {
  return useContext(GenerationCtx) ?? FALLBACK
}

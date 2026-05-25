import { useEffect, useRef } from 'react'
import type { StageName } from '@shared/documents'
import { MessageBubble } from './MessageBubble'
import { useT } from '../i18n'

type StreamMetrics = {
  ttftMs: number | null
  tokensPerSec: number | null
  tokenCount: number
}

type StageRow = {
  stage: StageName
  status: 'running' | 'done'
  durationMs?: number
  detail?: string
}

type LocalMessage =
  | { id: string; role: 'user'; content: string }
  | {
      id: string
      role: 'assistant'
      content: string
      streaming: boolean
      isRefusal?: boolean
      metrics?: StreamMetrics
      pipeline?: StageRow[]
    }

type Props = {
  messages: LocalMessage[]
  onCitationClick: (m: { documentId: number; chunkId: number; messageText: string }) => void
  /** When true, the per-message pipeline checklist stays rendered above the
   *  assistant bubble even after the first token arrives. Default behaviour
   *  (false) is to collapse it into a "pipeline X ms" prefix on the metrics
   *  line. Controlled by `basic.showPipelineSteps` in user settings. */
  keepPipelineVisible: boolean
}

// i18n key per stage, resolved via useT() at render so the checklist follows
// the response-language setting like the rest of the UI.
const STAGE_LABEL_KEY: Record<StageName, string> = {
  contextualize: 'chat.stageContextualize',
  expand_queries: 'chat.stageExpandQueries',
  retrieve: 'chat.stageRetrieve',
  rerank: 'chat.stageRerank',
  prefill: 'chat.stagePrefill',
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  return `${ms} ms`
}

function pipelineTotalMs(pipeline: StageRow[]): number {
  return pipeline.reduce((acc, r) => acc + (r.durationMs ?? 0), 0)
}

const NEAR_BOTTOM_PX = 64

export function MessageList({
  messages,
  onCitationClick,
  keepPipelineVisible,
}: Props): JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  // Whether we should auto-follow new content. Flips off as soon as the user
  // scrolls up away from the bottom, and back on when they scroll back down.
  const stickyRef = useRef(true)
  const rafRef = useRef<number | null>(null)

  // Coalesce scroll-to-bottom updates so token-by-token streaming doesn't
  // queue dozens of scrollTop writes per frame.
  useEffect(() => {
    if (!stickyRef.current) return
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = ref.current
      if (!el) return
      el.scrollTop = el.scrollHeight
    })
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [messages])

  const onScroll = (): void => {
    const el = ref.current
    if (!el) return
    const dist = el.scrollHeight - (el.scrollTop + el.clientHeight)
    stickyRef.current = dist <= NEAR_BOTTOM_PX
  }

  if (messages.length === 0) {
    return (
      <div className="chat__messages" ref={ref} onScroll={onScroll}>
        <div className="chat__messages-empty">{t('chat.emptyState')}</div>
      </div>
    )
  }
  return (
    <div className="chat__messages" ref={ref} onScroll={onScroll}>
      <div className="chat__inner">
        {messages.map((m) => {
          // Show the inline checklist while we have stages. Default: only
          // pre-first-token (collapses into the metrics line on TTFT). When
          // `keepPipelineVisible` is on, the checklist stays mounted for the
          // life of the message — including persisted assistant turns whose
          // pipeline survives only in-memory.
          const hasPipeline = m.role === 'assistant' && (m.pipeline?.length ?? 0) > 0
          const preFirstToken = m.role === 'assistant' && m.streaming && m.metrics?.ttftMs == null
          const showChecklist = hasPipeline && (keepPipelineVisible || preFirstToken)
          const pipelineMs = m.role === 'assistant' ? pipelineTotalMs(m.pipeline ?? []) : 0
          return (
            <div key={m.id} className="chat__message-row">
              {showChecklist && m.role === 'assistant' && (
                <ul className="chat__pipeline" aria-live="polite">
                  {m.pipeline!.map((row, i) => (
                    <li
                      key={`${row.stage}-${i}`}
                      className={`chat__pipeline-row chat__pipeline-row--${row.status}`}
                    >
                      <span className="chat__pipeline-dot" aria-hidden="true" />
                      <span className="chat__pipeline-label">{t(STAGE_LABEL_KEY[row.stage])}</span>
                      {row.detail && <span className="chat__pipeline-detail">{row.detail}</span>}
                      <span className="chat__pipeline-time">
                        {row.status === 'done' ? fmtMs(row.durationMs) : '…'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <MessageBubble
                role={m.role}
                content={m.content}
                {...(m.role === 'assistant' && m.isRefusal ? { isRefusal: true } : {})}
                onCitationClick={onCitationClick}
              />
              {m.role === 'assistant' && m.metrics && m.metrics.ttftMs != null && (
                <div className="chat__metrics">
                  {pipelineMs > 0 && t('chat.metricsPipeline', { ms: fmtMs(pipelineMs) })}
                  {t('chat.metricsTtft', { s: (m.metrics.ttftMs / 1000).toFixed(2) })}
                  {m.metrics.tokensPerSec != null &&
                    t('chat.metricsTokensPerSec', { rate: m.metrics.tokensPerSec.toFixed(1) })}
                  {t('chat.metricsTokens', { count: m.metrics.tokenCount })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

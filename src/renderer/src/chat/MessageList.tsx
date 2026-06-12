import { useEffect, useRef } from 'react'
import { Copy, RefreshCcw } from 'lucide-react'
import type { StageName } from '@shared/documents'
import { MessageBubble } from './MessageBubble'
import { useT, type TFn } from '../i18n'

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
      /** Persisted citations for this turn (the chunks fed AND cited). Present
       *  on re-hydrated/finished turns, undefined while streaming. Drives both
       *  marker validation in the bubble and the grounding badge below it. */
      citations?: Array<{ documentId: number; chunkId: number }>
    }

type Props = {
  messages: LocalMessage[]
  onCitationClick: (m: { documentId: number; chunkId: number; messageText: string }) => void
  /** When true, the per-message pipeline checklist stays rendered above the
   *  assistant bubble even after the first token arrives. Default behaviour
   *  (false) is to collapse it into a "pipeline X ms" prefix on the metrics
   *  line. Controlled by `basic.showPipelineSteps` in user settings. */
  keepPipelineVisible: boolean
  /** Copy a finished assistant message to the clipboard. */
  onCopy: (content: string) => void
  /** Re-roll the last assistant turn. Only shown for the most recent finished
   *  assistant message; undefined while busy disables the action. */
  onRegenerate?: () => void
}

// i18n key per stage, resolved via useT() at render so the checklist follows
// the response-language setting like the rest of the UI.
const STAGE_LABEL_KEY: Record<StageName, string> = {
  route: 'chat.stageRoute',
  contextualize: 'chat.stageContextualize',
  expand_queries: 'chat.stageExpandQueries',
  retrieve: 'chat.stageRetrieve',
  rerank: 'chat.stageRerank',
  summarize: 'chat.stageSummarize',
  prefill: 'chat.stagePrefill',
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  return `${ms} ms`
}

// Per-answer trust signal: "Grounded · N source(s)" when the model cited at
// least one fed chunk. Only the positive case is shown — an answer that cited
// nothing (a refusal, a greeting, or a genuinely ungrounded reply) gets no
// badge rather than a false "unverified" flag, since re-hydrated refusals carry
// no isRefusal marker to distinguish them.
function GroundingBadge({ count, t }: { count: number; t: TFn }): JSX.Element {
  return (
    <div className="chat__grounding chat__grounding--ok" role="status">
      {t(count === 1 ? 'chat.groundingOne' : 'chat.groundingMany', { count })}
    </div>
  )
}

function pipelineTotalMs(pipeline: StageRow[]): number {
  return pipeline.reduce((acc, r) => acc + (r.durationMs ?? 0), 0)
}

const NEAR_BOTTOM_PX = 64

export function MessageList({
  messages,
  onCitationClick,
  keepPipelineVisible,
  onCopy,
  onRegenerate,
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
  // Regenerate is only meaningful on the most recent FINISHED assistant turn —
  // re-rolling an older message would orphan everything that came after it.
  let lastFinishedAssistantIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.role === 'assistant' && !m.streaming) {
      lastFinishedAssistantIdx = i
      break
    }
  }
  return (
    <div className="chat__messages" ref={ref} onScroll={onScroll}>
      <div className="chat__inner">
        {messages.map((m, idx) => {
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
                {...(m.role === 'assistant' && m.citations ? { citations: m.citations } : {})}
                onCitationClick={onCitationClick}
              />
              {m.role === 'assistant' && !m.streaming && m.content.length > 0 && (
                <div className="chat__msg-actions" role="toolbar">
                  <button
                    type="button"
                    className="chat__msg-action"
                    onClick={() => onCopy(m.content)}
                    aria-label={t('chat.copy')}
                    title={t('chat.copy')}
                  >
                    <Copy size={14} aria-hidden="true" />
                  </button>
                  {idx === lastFinishedAssistantIdx && onRegenerate && (
                    <button
                      type="button"
                      className="chat__msg-action"
                      onClick={onRegenerate}
                      aria-label={t('chat.regenerate')}
                      title={t('chat.regenerate')}
                    >
                      <RefreshCcw size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
              {m.role === 'assistant' &&
                !m.streaming &&
                !m.isRefusal &&
                m.citations &&
                m.citations.length > 0 && <GroundingBadge count={m.citations.length} t={t} />}
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

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Languages,
  RefreshCcw,
} from 'lucide-react'
import type { Document, StageName } from '@shared/documents'
import { hasCitedSources } from '@shared/citationMarkers'
import { MessageBubble } from './MessageBubble'
import { TranslationPanel } from './TranslationPanel'
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
      /** Supplied passage allow-list, reconciled against the final answer. */
      citations?: Array<{ documentId: number; chunkId: number }>
    }

type Props = {
  onPrompt?: (text: string) => void
  messages: LocalMessage[]
  onCitationClick: (m: { documentId: number; chunkId: number; messageText: string }) => void
  /** All workspace documents — resolves a citation's documentId to its file
   *  name in the grounding badge's source list. */
  documents: Document[]
  /** When true, the per-turn pipeline dropdown is rendered above the assistant
   *  bubble (always collapsed; the user expands it for the timed steps). When
   *  false the pipeline is hidden entirely. Controlled by
   *  `basic.showPipelineSteps` in user settings. */
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
  corpus: 'chat.stageCorpus',
  prefill: 'chat.stagePrefill',
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  return `${ms} ms`
}

type SourceDoc = { documentId: number; chunkId: number; name: string; path: string | null }

// Source navigation, not a factual-verification badge. A valid passage ID does
// not establish that its text supports the model's claim. Count distinct
// documents and let readers open their passages in the SourceViewer.
function GroundingBadge({
  citations,
  documents,
  messageText,
  onOpenSource,
  t,
}: {
  citations: ReadonlyArray<{ documentId: number; chunkId: number }>
  documents: Document[]
  messageText: string
  onOpenSource: (m: { documentId: number; chunkId: number; messageText: string }) => void
  t: TFn
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Distinct cited documents in first-cited order, keeping the first chunk per
  // document so the row can open a representative passage. Title falls back to
  // "Document #id" if the doc was removed from the workspace after this turn was
  // persisted.
  const sources = useMemo<SourceDoc[]>(() => {
    const seen = new Set<number>()
    const out: SourceDoc[] = []
    for (const c of citations) {
      if (seen.has(c.documentId)) continue
      seen.add(c.documentId)
      const doc = documents.find((d) => d.id === c.documentId)
      out.push({
        documentId: c.documentId,
        chunkId: c.chunkId,
        name: doc?.title ?? t('chat.documentFallback', { id: c.documentId }),
        path: doc?.sourcePath ?? null,
      })
    }
    return out
  }, [citations, documents, t])

  // Close on outside click / Escape while the popover is open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const count = sources.length
  const cited = hasCitedSources(
    messageText,
    new Set(citations.map((citation) => `${citation.documentId}-${citation.chunkId}`)),
  )
  return (
    <div className="chat__grounding-wrap" ref={wrapRef}>
      <button
        type="button"
        className="chat__grounding"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {t(
          cited
            ? count === 1
              ? 'chat.groundingOne'
              : 'chat.groundingMany'
            : 'chat.providedSources',
          { count },
        )}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <div className="chat__sources-pop" role="menu">
          <span className="chat__sources-pop-title">
            {t(cited ? 'chat.sourcesPopoverTitle' : 'chat.providedSourcesTitle')}
          </span>
          {sources.map((s, i) => (
            <button
              key={s.documentId}
              type="button"
              className="chat__sources-pop-item"
              role="menuitem"
              title={s.path ?? s.name}
              onClick={() => {
                onOpenSource({ documentId: s.documentId, chunkId: s.chunkId, messageText })
                setOpen(false)
              }}
            >
              <span className="chat__sources-pop-index">{i + 1}</span>
              <FileText size={14} aria-hidden="true" className="chat__sources-pop-icon" />
              <span className="chat__sources-pop-name">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function pipelineTotalMs(pipeline: StageRow[]): number {
  return pipeline.reduce((acc, r) => acc + (r.durationMs ?? 0), 0)
}

// Collapsible "dropdown" for the per-turn retrieval/generation pipeline. The
// summary line is STABLE — it doesn't grow row-by-row as stages complete, which
// is what made the old always-expanded box jump around; the full step list is
// revealed on click. It always starts COLLAPSED (the user expands it on demand);
// whether it shows at all is governed by the `basic.showPipelineSteps` setting.
// The pipeline is persisted with the message, so this also renders on
// re-hydrated turns after a reload.
function PipelinePanel({
  pipeline,
  awaitingFirstToken,
  finished,
  t,
}: {
  pipeline: StageRow[]
  awaitingFirstToken: boolean
  finished: boolean
  t: TFn
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const totalMs = pipelineTotalMs(pipeline)
  // Until the first token arrives the pipeline is still doing work, so the
  // collapsed line names the ACTUAL step in flight (the running row, or the most
  // recent one in the brief gap between stages) with a pulsing dot. The moment a
  // token lands the pipeline is finished — flip to a check + "Done · {time}".
  // Expanding always reveals the timed detail list.
  const running = awaitingFirstToken
  const incomplete = finished && pipeline.some((row) => row.status === 'running')
  const current = pipeline.find((r) => r.status === 'running') ?? pipeline[pipeline.length - 1]
  return (
    <div className={`chat__pipeline-dd${open ? ' chat__pipeline-dd--open' : ''}`}>
      <button
        type="button"
        className={`chat__pipeline-toggle${running ? ' chat__pipeline-toggle--running' : ''}`}
        aria-expanded={open}
        aria-label={t('chat.pipelineToggle')}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={12} className="chat__pipeline-caret" aria-hidden="true" />
        {running ? (
          <span
            className="chat__pipeline-leddot chat__pipeline-leddot--running"
            aria-hidden="true"
          />
        ) : incomplete ? null : (
          <Check size={12} className="chat__pipeline-check" aria-hidden="true" />
        )}
        <span className="chat__pipeline-summary">
          {running && current ? (
            <>
              {t(STAGE_LABEL_KEY[current.stage])}
              <span className="chat__pipeline-ellipsis">…</span>
            </>
          ) : incomplete ? (
            t('chat.pipelineIncomplete')
          ) : (
            t('chat.pipelineDone', { ms: fmtMs(totalMs) })
          )}
        </span>
      </button>
      {open && (
        <ul className="chat__pipeline" aria-live="polite">
          {pipeline.map((row, i) => (
            <li
              key={`${row.stage}-${i}`}
              className={`chat__pipeline-row${incomplete && row.status === 'running' ? '' : ` chat__pipeline-row--${row.status}`}`}
            >
              <span className="chat__pipeline-dot" aria-hidden="true" />
              <span className="chat__pipeline-label">{t(STAGE_LABEL_KEY[row.stage])}</span>
              {row.detail && <span className="chat__pipeline-detail">{row.detail}</span>}
              <span className="chat__pipeline-time">
                {row.status === 'done'
                  ? fmtMs(row.durationMs)
                  : incomplete
                    ? t('chat.pipelineIncomplete')
                    : '…'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const NEAR_BOTTOM_PX = 64

export function MessageList({
  onPrompt,
  messages,
  onCitationClick,
  keepPipelineVisible,
  onCopy,
  onRegenerate,
  documents,
}: Props): JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  // Whether we should auto-follow new content. Flips off as soon as the user
  // scrolls up away from the bottom, and back on when they scroll back down.
  const stickyRef = useRef(true)
  const rafRef = useRef<number | null>(null)
  // At most one open translate panel — keyed by message id. The panel itself
  // owns everything else (status , target , result); see TranslationPanel.
  const [translateOpenId, setTranslateOpenId] = useState<string | null>(null)

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
        <div className="chat__messages-empty">
          <FileText size={28} strokeWidth={1.5} aria-hidden="true" />
          <h2>{t(documents.length > 0 ? 'ux.chatHeading' : 'ux.chatEmptyHeading')}</h2>
          <p>{t(documents.length > 0 ? 'ux.chatDescription' : 'ux.chatEmptyDescription')}</p>
          {documents.length > 0 && onPrompt && (
            <div className="chat__prompts">
              {['ux.promptSummary', 'ux.promptCompare', 'ux.promptQuestions'].map((key) => (
                <button type="button" key={key} onClick={() => onPrompt(t(key))}>
                  {t(key)}
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>
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
          // Collapsible pipeline dropdown — shown when the turn has any stages
          // (live or re-hydrated) AND the `showPipelineSteps` setting is on. It
          // always starts collapsed; the user expands it to see the timed steps.
          const hasPipeline = m.role === 'assistant' && (m.pipeline?.length ?? 0) > 0
          return (
            <div key={m.id} className="chat__message-row">
              {hasPipeline && m.role === 'assistant' && keepPipelineVisible && (
                <PipelinePanel
                  pipeline={m.pipeline!}
                  awaitingFirstToken={m.streaming && m.content.length === 0}
                  finished={!m.streaming}
                  t={t}
                />
              )}
              {m.role === 'assistant' && m.streaming && m.content.length === 0 ? (
                // Pre-first-token: a typing indicator instead of an empty bubble
                // (which renders as a bare dark pill). Tokens replace it.
                <div
                  className="bubble bubble--assistant bubble--pending"
                  role="status"
                  aria-label={t('chat.generating')}
                >
                  <span className="chat__typing" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              ) : (
                <MessageBubble
                  role={m.role}
                  content={m.content}
                  {...(m.role === 'assistant' && m.isRefusal ? { isRefusal: true } : {})}
                  {...(m.role === 'assistant' && m.citations ? { citations: m.citations } : {})}
                  onCitationClick={onCitationClick}
                />
              )}
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
                  <button
                    type="button"
                    className="chat__msg-action"
                    onClick={() => setTranslateOpenId((prev) => (prev === m.id ? null : m.id))}
                    aria-label={t('chat.translate')}
                    title={t('chat.translate')}
                  >
                    <Languages size={14} aria-hidden="true" />
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
                  {/* Grounding badge sits in the action row beside copy /
                      translate / regenerate; click lists the cited documents. */}
                  {m.role === 'assistant' &&
                    !m.isRefusal &&
                    m.citations &&
                    m.citations.length > 0 && (
                      <GroundingBadge
                        citations={m.citations}
                        documents={documents}
                        messageText={m.content}
                        onOpenSource={onCitationClick}
                        t={t}
                      />
                    )}
                </div>
              )}
              {m.role === 'assistant' && !m.streaming && translateOpenId === m.id && (
                <TranslationPanel content={m.content} onClose={() => setTranslateOpenId(null)} />
              )}
              {m.role === 'assistant' && m.metrics && m.metrics.ttftMs != null && (
                <div className="chat__metrics">
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

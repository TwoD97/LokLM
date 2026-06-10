import { useCallback, useEffect, useRef, useState } from 'react'
import type { Conversation, Document, StageName, StreamEvent } from '@shared/documents'
import { ChatHeader } from './ChatHeader'
import { ChatInput } from './ChatInput'
import { MessageList } from './MessageList'
import { ConversationList } from './ConversationList'
import { ConfirmModal } from './ConfirmModal'
import { SourceViewer } from './SourceViewer'
import { ErrorBoundary } from '../ErrorBoundary'
import { useSettings } from '../settings/useSettings'
import { useT } from '../i18n'
import './chat.css'

type StreamMetrics = {
  ttftMs: number | null
  tokensPerSec: number | null
  tokenCount: number
}

/** One row in the inline progress checklist. `status` flips from 'running' to
 *  'done' when QAService emits the matching done event. `durationMs` is filled
 *  on the done event; `detail` is an optional caption ("12 candidates"). */
export type StageRow = {
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
      /** Pipeline stages observed for this turn, in arrival order. Empty for
       *  re-hydrated messages from the DB (stage timings aren't persisted). */
      pipeline?: StageRow[]
      /** Persisted citations (fed AND cited chunks). Populated on re-hydrate;
       *  undefined while streaming. Drives marker validation + grounding badge. */
      citations?: Array<{ documentId: number; chunkId: number }>
    }

function newMessageId(): string {
  // Stable per-message id for React keys + memo. Lets MessageBubble skip
  // re-renders on token streams (only the streaming bubble's content changes
  // — index keys forced every bubble to re-run).
  return crypto.randomUUID()
}

type Props = {
  workspaceId: number
  currentConversationId: number | null
  activeDocumentIds: number[]
  /** All docs in the workspace, used to resolve a citation's document title for
   *  the SourceViewer header (avoids the brief "chunk #id" flash while the
   *  chunk source is still loading). */
  documents: Document[]
  onConversationChange: (id: number | null, activeDocumentIds: number[]) => void
}

export function ChatView({
  workspaceId,
  currentConversationId,
  activeDocumentIds,
  documents,
  onConversationChange,
}: Props): JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Conversation | null>(null)
  const [sourceViewer, setSourceViewer] = useState<{
    chunkId: number
    messageText: string
    documentTitle: string | null
  } | null>(null)
  const { settings } = useSettings()
  const t = useT()
  // Default false matches the original "collapse on first token" UX; setting
  // is undefined while settings hydrate from disk on first launch.
  const keepPipelineVisible = settings?.basic.showPipelineSteps ?? false

  // Closures captured by the stream listener see a stale `currentConversationId`
  // — we use a ref so the listener can compare against the live value and drop
  // tokens for conversations the user has already navigated away from. Without
  // this the tokens of a still-running stream get appended to the LAST message
  // of whichever conv the user happens to be viewing.
  const currentIdRef = useRef<number | null>(currentConversationId)
  useEffect(() => {
    currentIdRef.current = currentConversationId
  }, [currentConversationId])

  // Latest activeDocumentIds snapshot for the in-flight send. The handler
  // closes over the value at the time the user clicked send; we don't want
  // mid-stream toggles to affect the request, so reading from a ref at send
  // time is intentional — we capture once into a local in onSend.
  const activeDocumentIdsRef = useRef<number[]>(activeDocumentIds)
  useEffect(() => {
    activeDocumentIdsRef.current = activeDocumentIds
  }, [activeDocumentIds])

  // Mirror of messages so onSend can read history without listing `messages`
  // in its deps , otherwise onSend's identity churns every token and
  // ChatInput re-renders on every chunk. Bonus: also fixes the latent bug
  // where the history payload captured the empty assistant placeholder we
  // just pushed (since setMessages had already added it before window.api
  // .chat.stream was called).
  const messagesRef = useRef<LocalMessage[]>(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const refresh = useCallback(async () => {
    const list = await window.api.conversations.list(workspaceId)
    setConversations(list)
  }, [workspaceId])

  useEffect(() => {
    setMessages([])
    void refresh()
    // Kick the reranker load up-front so the first chat:stream call doesn't
    // pay the GGUF load time on top of retrieval + generation latency. Fire
    // and forget — failure (no GGUF on disk) is non-fatal, retrieval still
    // works without reranking.
    void window.api.reranker.warmup().catch(() => undefined)
  }, [workspaceId, refresh])

  const openConversation = useCallback(
    async (id: number) => {
      // AP-9 Konv.-Wechsel: on an actual switch, tell main we're leaving the
      // current conversation so it can free the model under the "unload"
      // setting. Best-effort + fire-and-forget; "keep" makes this a no-op.
      if (id !== currentIdRef.current) {
        void window.api.chat.conversationSwitched().catch(() => undefined)
      }
      const data = await window.api.conversations.getWithMessages(id)
      onConversationChange(id, data.conversation.activeDocumentIds)
      setMessages(
        data.messages.map((m) => {
          if (m.role === 'user') return { id: newMessageId(), role: 'user', content: m.content }
          // Persisted assistant turns carry the stream metrics they were
          // recorded with. Re-hydrate the metrics chip if any of them survived
          // the round-trip (older rows have all-null and render without a chip).
          const hasMetrics = m.ttftMs != null || m.tokensPerSec != null || (m.tokenCount ?? 0) > 0
          return {
            id: newMessageId(),
            role: 'assistant',
            content: m.content,
            streaming: false,
            // Always set (possibly empty) so the bubble validates markers and
            // the grounding badge renders — distinguishes "cited nothing" from
            // "still streaming" (undefined).
            citations: m.citations.map((c) => ({ documentId: c.documentId, chunkId: c.chunkId })),
            ...(hasMetrics
              ? {
                  metrics: {
                    ttftMs: m.ttftMs,
                    tokensPerSec: m.tokensPerSec,
                    tokenCount: m.tokenCount ?? 0,
                  },
                }
              : {}),
          }
        }),
      )
    },
    [onConversationChange],
  )

  const startNewChat = useCallback(() => {
    onConversationChange(null, [])
    setMessages([])
  }, [onConversationChange])

  const onSend = useCallback(
    async (text: string) => {
      setBusy(true)
      // Captured here so we still know it was a fresh chat after we mint a
      // conversation row below — `currentConversationId` won't reflect the
      // update until the next render.
      const wasNewConversation = currentConversationId == null
      const idsForSend = activeDocumentIdsRef.current
      let convId = currentConversationId
      if (convId == null) {
        try {
          const conv = await window.api.conversations.create(workspaceId, undefined, idsForSend)
          convId = conv.id
          onConversationChange(convId, idsForSend)
          await refresh()
        } catch (err) {
          // Creating the conversation row failed (transient DB error, or a lock
          // racing in — the auth-state broadcast re-routes to login in that
          // case). The stream try/finally below that resets `busy` hasn't been
          // entered yet, so reset it here or the composer stays stuck showing
          // the stop button with no way to send.
          console.error('[chat] failed to create conversation', err)
          setBusy(false)
          return
        }
      }
      const sendTime = performance.now()
      let firstTokenTime: number | null = null
      let tokenCount = 0
      setMessages((prev) => [
        ...prev,
        { id: newMessageId(), role: 'user', content: text },
        {
          id: newMessageId(),
          role: 'assistant',
          content: '',
          streaming: true,
          metrics: { ttftMs: null, tokensPerSec: null, tokenCount: 0 },
          pipeline: [],
        },
      ])
      const streamId = crypto.randomUUID()
      const streamConvId = convId
      setActiveStreamId(streamId)
      const offEvent = window.api.chat.onEvent(streamId, (ev: StreamEvent) => {
        // User navigated to a different conv mid-stream — drop the event so
        // we don't append to the wrong conv. The main process keeps streaming
        // and persists the full answer; openConversation() refetches on return.
        if (currentIdRef.current !== streamConvId) return
        setMessages((prev) => {
          const next = prev.slice()
          const last = next[next.length - 1]
          if (!last || last.role !== 'assistant') return prev
          if (ev.type === 'token') {
            if (firstTokenTime == null) firstTokenTime = performance.now()
            // Worker coalesces ~8 ms worth of native onTextChunk callbacks
            // into one push; `ev.count` is how many it merged. Without it
            // the tokens/sec metric would cap at the batching rate (~125 Hz).
            tokenCount += ev.count ?? 1
            const ttftMs = firstTokenTime - sendTime
            const elapsedSinceFirst = (performance.now() - firstTokenTime) / 1000
            const tokensPerSec = elapsedSinceFirst > 0 ? tokenCount / elapsedSinceFirst : null
            next[next.length - 1] = {
              ...last,
              content: last.content + ev.text,
              metrics: { ttftMs, tokensPerSec, tokenCount },
            }
          } else if (ev.type === 'stage') {
            // Mutate-via-copy: find the existing row for this stage (started
            // earlier) or push a new one on 'start'. Order is preserved so the
            // checklist renders in the order stages actually fired.
            const pipeline: StageRow[] = (last.pipeline ?? []).slice()
            if (ev.status === 'start') {
              const row: StageRow = { stage: ev.stage, status: 'running' }
              if (ev.detail !== undefined) row.detail = ev.detail
              pipeline.push(row)
            } else {
              // Find the most recent matching running row and flip it to done.
              for (let i = pipeline.length - 1; i >= 0; i--) {
                if (pipeline[i]!.stage === ev.stage && pipeline[i]!.status === 'running') {
                  pipeline[i] = {
                    ...pipeline[i]!,
                    status: 'done',
                    ...(ev.durationMs !== undefined ? { durationMs: ev.durationMs } : {}),
                    ...(ev.detail !== undefined ? { detail: ev.detail } : {}),
                  }
                  break
                }
              }
            }
            next[next.length - 1] = { ...last, pipeline }
          } else if (ev.type === 'refusal') {
            next[next.length - 1] = {
              ...last,
              content: ev.message,
              streaming: false,
              isRefusal: true,
            }
          } else if (ev.type === 'error') {
            next[next.length - 1] = {
              ...last,
              content: t('chat.streamError', { message: ev.message }),
              streaming: false,
            }
          } else if (ev.type === 'done') {
            next[next.length - 1] = { ...last, streaming: false }
          }
          return next
        })
      })
      try {
        // History excludes the user turn + empty assistant placeholder we
        // just pushed — slice(0, -2) drops both. Read via the ref so onSend's
        // identity stays stable across tokens.
        const priorMessages = messagesRef.current.slice(0, -2)
        await window.api.chat.stream(streamId, workspaceId, text, {
          conversationId: convId,
          history: priorMessages.map((m) => ({ role: m.role, content: m.content })),
          rerank: true,
          contextualize: true,
          activeDocumentIds: idsForSend,
        })
        // IPC stream events can race with the invoke reply that resolves
        // chat.stream — once we unsubscribe in `finally`, any late `done` or
        // trailing token is dropped, leaving the UI stuck mid-stream. Re-sync
        // from the DB so the final assistant turn is always rendered.
        if (convId != null) await openConversation(convId)
        // Auto-name brand-new chats from the first round-trip. The IPC
        // handler is idempotent — it skips when the row already has a title
        // — so a future manual rename survives subsequent sends.
        if (wasNewConversation && convId != null) {
          try {
            await window.api.conversations.generateTitle(convId)
            await refresh()
          } catch {
            /* title gen is best-effort; the chat keeps its fallback name */
          }
        }
      } finally {
        offEvent()
        setActiveStreamId(null)
        setBusy(false)
        void refresh()
      }
    },
    [currentConversationId, workspaceId, openConversation, refresh, onConversationChange, t],
  )

  // Stable wrapper for ChatInput — its `onSend` prop is `(text: string) => void`
  // while ours returns a Promise. Wrapping inline with `(t) => void onSend(t)`
  // allocated a fresh function per render and forced ChatInput to re-render on
  // every token.
  const onSendForInput = useCallback((t: string) => void onSend(t), [onSend])

  const onCancel = useCallback(() => {
    if (activeStreamId) void window.api.chat.cancel(activeStreamId)
  }, [activeStreamId])

  const onDelete = useCallback(
    async (id: number) => {
      await window.api.conversations.delete(id)
      if (currentConversationId === id) {
        onConversationChange(null, [])
        setMessages([])
      }
      setConfirmDelete(null)
      void refresh()
    },
    [currentConversationId, refresh, onConversationChange],
  )

  const currentTitle =
    currentConversationId != null
      ? (conversations.find((c) => c.id === currentConversationId)?.title ??
        t('chat.conversationFallback', { id: currentConversationId }))
      : t('chat.newChat')

  const onCitationClick = useCallback(
    ({
      documentId,
      chunkId,
      messageText,
    }: {
      documentId: number
      chunkId: number
      messageText: string
    }) => {
      const documentTitle = documents.find((d) => d.id === documentId)?.title ?? null
      setSourceViewer({ chunkId, messageText, documentTitle })
    },
    [documents],
  )

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '240px minmax(0, 1fr)',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <ConversationList
        conversations={conversations}
        currentId={currentConversationId}
        onSelect={(id) => void openConversation(id)}
        onNewChat={startNewChat}
        onRequestDelete={(c) => setConfirmDelete(c)}
      />
      <section className="chat">
        <ChatHeader
          title={currentTitle}
          onDelete={
            currentConversationId != null
              ? () =>
                  setConfirmDelete(
                    conversations.find((c) => c.id === currentConversationId) ?? null,
                  )
              : null
          }
        />
        <MessageList
          messages={messages}
          onCitationClick={onCitationClick}
          keepPipelineVisible={keepPipelineVisible}
        />
        <ChatInput onSend={onSendForInput} busy={busy} onCancel={onCancel} />
      </section>
      {sourceViewer && (
        <ErrorBoundary label={t('chat.sourcePreview')} onError={() => setSourceViewer(null)}>
          <SourceViewer
            chunkId={sourceViewer.chunkId}
            messageText={sourceViewer.messageText}
            documentTitle={sourceViewer.documentTitle}
            onClose={() => setSourceViewer(null)}
          />
        </ErrorBoundary>
      )}
      {confirmDelete && (
        <ConfirmModal
          title={t('chat.deleteConversationTitle')}
          body={t('chat.deleteConversationBody', {
            title: confirmDelete.title ?? `#${confirmDelete.id}`,
          })}
          onConfirm={() => void onDelete(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

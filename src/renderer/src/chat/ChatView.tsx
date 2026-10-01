import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Conversation,
  ConversationWithMessages,
  Document,
  StageName,
  StreamEvent,
} from '@shared/documents'
import { ChatHeader } from './ChatHeader'
import { ChatInput } from './ChatInput'
import { MessageList } from './MessageList'
import { ConversationList } from './ConversationList'
import { ConfirmModal } from './ConfirmModal'
import { SourceViewer, ReaderBoundary } from '../ui/lazyReaders'
import { ErrorBoundary } from '../ErrorBoundary'
import { useSettings } from '../settings/useSettings'
import { useGeneration } from '../generation/GenerationContext'
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
      /** Supplied passage allow-list, reconciled against the final answer. */
      citations?: Array<{ documentId: number; chunkId: number }>
    }

function newMessageId(): string {
  // Stable per-message id for React keys + memo. Lets MessageBubble skip
  // re-renders on token streams (only the streaming bubble's content changes
  // — index keys forced every bubble to re-run).
  return crypto.randomUUID()
}

function restoredMessages(messages: ConversationWithMessages['messages']): LocalMessage[] {
  return messages.map((message) => {
    if (message.role === 'user')
      return { id: newMessageId(), role: 'user', content: message.content }
    const hasMetrics =
      message.ttftMs != null || message.tokensPerSec != null || (message.tokenCount ?? 0) > 0
    return {
      id: newMessageId(),
      role: 'assistant',
      content: message.content,
      streaming: false,
      citations: message.citations.map((citation) => ({
        documentId: citation.documentId,
        chunkId: citation.chunkId,
      })),
      ...(message.pipeline?.length ? { pipeline: message.pipeline } : {}),
      ...(hasMetrics
        ? {
            metrics: {
              ttftMs: message.ttftMs,
              tokensPerSec: message.tokensPerSec,
              tokenCount: message.tokenCount ?? 0,
            },
          }
        : {}),
    }
  })
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
  const [error, setError] = useState<string | null>(null)
  const sendPending = useRef(false)
  const regeneratePending = useRef(false)
  const deletePending = useRef(false)
  const navigation = useRef(0)
  // Includes a selection whose database read has not completed yet. The
  // displayed ID alone cannot tell a terminal refresh from reopening a chat
  // the user is currently leaving.
  const navigationTarget = useRef<number | null>(currentConversationId)
  const cancelledStream = useRef<string | null>(null)
  const pendingSendCancelled = useRef(false)
  const [draftSuggestion, setDraftSuggestion] = useState<{ text: string } | null>(null)
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Conversation | null>(null)
  const [sourceViewer, setSourceViewer] = useState<{
    chunkId: number
    messageText: string
    documentTitle: string | null
  } | null>(null)
  const { settings } = useSettings()
  const { begin: beginGeneration } = useGeneration()
  const t = useT()
  // Default false matches the original "collapse on first token" UX; setting
  // is undefined while settings hydrate from disk on first launch.
  const keepPipelineVisible = settings?.basic.showPipelineSteps ?? false

  useEffect(
    () => () => {
      // Pending preflight reads must never start a new generation after this
      // workspace view has been removed (for example, while switching vaults).
      navigation.current++
      pendingSendCancelled.current = true
    },
    [],
  )

  // Closures captured by the stream listener see a stale `currentConversationId`
  // — we use a ref so the listener can compare against the live value and drop
  // tokens for conversations the user has already navigated away from. Without
  // this the tokens of a still-running stream get appended to the LAST message
  // of whichever conv the user happens to be viewing.
  const currentIdRef = useRef<number | null>(currentConversationId)
  useEffect(() => {
    if (currentIdRef.current !== currentConversationId) {
      navigation.current++
      navigationTarget.current = currentConversationId
    }
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
    try {
      const list = await window.api.conversations.list(workspaceId)
      setConversations(list)
    } catch (err) {
      setError(String(err))
    }
  }, [workspaceId])

  useEffect(() => {
    navigation.current++
    setMessages([])
    void refresh()
    // Kick the reranker load up-front so the first chat:stream call doesn't
    // pay the GGUF load time on top of retrieval + generation latency. Fire
    // and forget — failure (no GGUF on disk) is non-fatal, retrieval still
    // works without reranking.
    void window.api.reranker.warmup().catch(() => undefined)
  }, [workspaceId, refresh])

  const openConversation = useCallback(
    async (id: number, preserveError = false) => {
      const request = ++navigation.current
      navigationTarget.current = id
      // AP-9 Konv.-Wechsel: on an actual switch, tell main we're leaving the
      // current conversation so it can free the model under the "unload"
      // setting. Best-effort + fire-and-forget; "keep" makes this a no-op.
      if (id !== currentIdRef.current) {
        void window.api.chat.conversationSwitched().catch(() => undefined)
      }
      let data
      try {
        data = await window.api.conversations.getWithMessages(id)
      } catch (err) {
        if (request === navigation.current) {
          const message = t('chat.loadFailed', { message: String(err) })
          setError((previous) => (preserveError ? (previous ?? message) : message))
        }
        return
      }
      if (request !== navigation.current) return
      currentIdRef.current = id
      onConversationChange(id, data.conversation.activeDocumentIds)
      setMessages(restoredMessages(data.messages))
    },
    [onConversationChange, t],
  )

  const startNewChat = useCallback(() => {
    navigation.current++
    navigationTarget.current = null
    currentIdRef.current = null
    setError(null)
    onConversationChange(null, [])
    setMessages([])
  }, [onConversationChange])

  const onSelectConversation = useCallback(
    (id: number) => void openConversation(id),
    [openConversation],
  )

  const onCopyMessage = useCallback(
    (content: string) => {
      void navigator.clipboard.writeText(content).catch(() => setError(t('chat.copyFailed')))
    },
    [t],
  )

  const onSend = useCallback(
    async (text: string, retryHistory?: LocalMessage[]) => {
      if (sendPending.current || (regeneratePending.current && retryHistory === undefined)) return
      sendPending.current = true
      pendingSendCancelled.current = false
      const startedNavigation = navigation.current
      setError(null)
      setBusy(true)
      // Captured here so we still know it was a fresh chat after we mint a
      // conversation row below — `currentConversationId` won't reflect the
      // update until the next render.
      const wasNewConversation = currentConversationId == null
      const idsForSend = activeDocumentIdsRef.current
      // Snapshot the conversation history NOW, before this turn's user message +
      // assistant placeholder are pushed. messagesRef lags a render (synced via
      // useEffect), so reading it after the push — or slicing a fixed -2 — either
      // captures the empty placeholder or drops the 2 most recent real turns,
      // both of which feed the contextualizer the wrong history. Empty for a new
      // chat, so a fresh conversation never inherits prior turns.
      const priorMessages = retryHistory ?? messagesRef.current
      let convId = currentConversationId
      if (convId == null) {
        try {
          const conv = await window.api.conversations.create(workspaceId, undefined, idsForSend)
          convId = conv.id
          if (navigation.current !== startedNavigation || pendingSendCancelled.current) {
            if (navigation.current === startedNavigation) setDraftSuggestion({ text })
            sendPending.current = false
            setBusy(false)
            void refresh()
            return
          }
          currentIdRef.current = convId
          navigationTarget.current = convId
          onConversationChange(convId, idsForSend)
          await refresh()
        } catch (err) {
          // Creating the conversation row failed (transient DB error, or a lock
          // racing in — the auth-state broadcast re-routes to login in that
          // case). The stream try/finally below that resets `busy` hasn't been
          // entered yet, so reset it here or the composer stays stuck showing
          // the stop button with no way to send.
          console.error('[chat] failed to create conversation', err)
          setError(t('chat.sendFailed', { message: String(err) }))
          setDraftSuggestion({ text })
          sendPending.current = false
          setBusy(false)
          return
        }
      }
      if (navigation.current !== startedNavigation || pendingSendCancelled.current) {
        if (navigation.current === startedNavigation) setDraftSuggestion({ text })
        sendPending.current = false
        setBusy(false)
        return
      }
      const sendTime = performance.now()
      let firstTokenTime: number | null = null
      let tokenCount = 0
      const assistantId = newMessageId()
      setMessages((prev) => [
        ...prev,
        { id: newMessageId(), role: 'user', content: text },
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          streaming: true,
          metrics: { ttftMs: null, tokensPerSec: null, tokenCount: 0 },
          pipeline: [],
          citations: [],
        },
      ])
      const streamId = crypto.randomUUID()
      const streamConvId = convId
      let streamFailed = false
      let streamRefused = false
      let completedSuccessfully = false
      let durableError = false
      let terminalReceived = false
      cancelledStream.current = null
      setActiveStreamId(streamId)
      const onStreamEvent = (ev: StreamEvent): void => {
        if (terminalReceived) return
        // Outcome bookkeeping survives navigation; a failed background turn
        // must not launch a second generation to name the conversation.
        if (ev.type === 'refusal') streamRefused = true
        if (ev.type === 'error') {
          streamFailed = true
          durableError = ev.persisted === true
          terminalReceived = true
        } else if (ev.type === 'done') {
          completedSuccessfully = ev.outcome !== 'cancelled' && !streamRefused
          terminalReceived = true
        }
        // User navigated to a different conv mid-stream — drop the event so
        // we don't append to the wrong conv. The main process keeps streaming
        // and persists the full answer; openConversation() refetches on return.
        if (
          currentIdRef.current !== streamConvId ||
          navigationTarget.current !== streamConvId ||
          (navigation.current !== startedNavigation && !terminalReceived)
        )
          return
        if (ev.type === 'error') {
          setError(t('chat.streamError', { message: ev.message }))
        }
        setMessages((prev) => {
          const next = prev.slice()
          const index = next.findIndex((message) => message.id === assistantId)
          const last = next[index]
          if (!last || last.role !== 'assistant') {
            // Returning to this conversation can replace the live placeholder
            // with a DB snapshot taken before the assistant was saved. An
            // unsaved terminal has no later DB row to recover from.
            if (ev.type === 'error' && ev.persisted !== true && ev.full_text !== undefined) {
              next.push({
                id: assistantId,
                role: 'assistant',
                content: ev.full_text,
                streaming: false,
                citations: (ev.citations ?? []).map((c) => ({
                  documentId: c.doc_id,
                  chunkId: c.chunk_id,
                })),
              })
              return next
            }
            return prev
          }
          if (ev.type === 'token') {
            if (firstTokenTime == null) firstTokenTime = performance.now()
            // Worker coalesces ~8 ms worth of native onTextChunk callbacks
            // into one push; `ev.count` is how many it merged. Without it
            // the tokens/sec metric would cap at the batching rate (~125 Hz).
            tokenCount += ev.count ?? 1
            const ttftMs = firstTokenTime - sendTime
            const elapsedSinceFirst = (performance.now() - firstTokenTime) / 1000
            // tokenCount > 1 guard mirrors the main-process persistence path:
            // a single synthesized token (corpus route's one-shot templated
            // answer) has no real rate, so leave the chip's tok/s blank rather
            // than show a meaningless 100s–1000s figure.
            const tokensPerSec =
              tokenCount > 1 && elapsedSinceFirst > 0 ? tokenCount / elapsedSinceFirst : null
            next[index] = {
              ...last,
              content: last.content + ev.text,
              metrics: { ttftMs, tokensPerSec, tokenCount },
            }
          } else if (ev.type === 'citation') {
            const citations = last.citations ?? []
            if (citations.some((c) => c.documentId === ev.doc_id && c.chunkId === ev.chunk_id))
              return prev
            next[index] = {
              ...last,
              citations: [...citations, { documentId: ev.doc_id, chunkId: ev.chunk_id }],
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
            next[index] = { ...last, pipeline }
          } else if (ev.type === 'refusal') {
            next[index] = {
              ...last,
              content: ev.message,
              streaming: false,
              isRefusal: true,
            }
          } else if (ev.type === 'error') {
            next[index] = {
              ...last,
              content: ev.full_text ?? last.content,
              citations: ev.citations
                ? ev.citations.map((c) => ({ documentId: c.doc_id, chunkId: c.chunk_id }))
                : (last.citations ?? []),
              streaming: false,
            }
          } else if (ev.type === 'done') {
            next[index] = {
              ...last,
              content: ev.full_text,
              citations: ev.citations.map((c) => ({ documentId: c.doc_id, chunkId: c.chunk_id })),
              streaming: false,
            }
          }
          return next
        })
      }
      const offEvent = window.api.chat.onEvent(streamId, onStreamEvent)
      // Register this turn with the global generation registry so the TitleBar
      // Activity indicator reflects it (the model is serial; this is what makes
      // "busy / queued" legible while the user is on another tab).
      const endGeneration = beginGeneration('chat')
      try {
        // History = the turns captured at send-start (above), already excluding
        // this turn's user message + placeholder — no fragile post-push slice.
        const terminal = await window.api.chat.stream(streamId, workspaceId, text, {
          conversationId: convId,
          history: priorMessages.map((m) => ({ role: m.role, content: m.content })),
          rerank: true,
          contextualize: true,
          activeDocumentIds: idsForSend,
        })
        // The invoke result carries the exact terminal event too: Electron's
        // event and invoke channels can arrive in either order. Apply it through
        // the same handler before deciding whether a DB refresh is safe.
        if (terminal) onStreamEvent(terminal)
        // Rehydrate the conversation the user currently intends to view,
        // including returning to this chat while its generation was running.
        // A pending selection elsewhere must keep priority over this refresh.
        if (
          convId != null &&
          (!streamFailed || durableError) &&
          navigationTarget.current === convId
        )
          await openConversation(convId, streamFailed)
      } catch (err) {
        streamFailed = true
        if (currentIdRef.current === convId && navigation.current === startedNavigation) {
          setError((previous) => previous ?? t('chat.sendFailed', { message: String(err) }))
          setMessages((prev) =>
            prev.map((m) =>
              m.role === 'assistant' && m.streaming ? { ...m, streaming: false } : m,
            ),
          )
        }
      } finally {
        endGeneration()
        offEvent()
        setActiveStreamId(null)
        setBusy(false)
        sendPending.current = false
        void refresh()
      }
      // Auto-name brand-new chats AFTER the turn is no longer streaming. Title gen
      // is a SECOND LLM call (slow on the iGPU); awaiting it inside the try above
      // kept busy/activeStreamId set — so the conversation looked like it was still
      // streaming, the UI stayed blocked, and switching conversation mid-gen raced
      // the refresh and "broke out". Fire it DETACHED; refresh() is list-only, so
      // the name just updates when it lands, even after a switch. The IPC handler
      // is idempotent (skips a row that already has a title), so a later manual
      // rename survives subsequent sends.
      if (
        wasNewConversation &&
        convId != null &&
        completedSuccessfully &&
        !streamFailed &&
        cancelledStream.current !== streamId
      ) {
        void window.api.conversations
          .generateTitle(convId)
          .then((title) => {
            if (title) void refresh()
          })
          .catch(() => {
            /* best-effort; the chat keeps its fallback name */
          })
      }
    },
    [
      currentConversationId,
      workspaceId,
      openConversation,
      refresh,
      onConversationChange,
      t,
      beginGeneration,
    ],
  )

  // Stable wrapper for ChatInput — its `onSend` prop is `(text: string) => void`
  // while ours returns a Promise. Wrapping inline with `(t) => void onSend(t)`
  // allocated a fresh function per render and forced ChatInput to re-render on
  // every token.
  const onSendForInput = useCallback((t: string) => void onSend(t), [onSend])

  const onCancel = useCallback(() => {
    pendingSendCancelled.current = true
    if (activeStreamId) {
      cancelledStream.current = activeStreamId
      void window.api.chat.cancel(activeStreamId).catch((err: unknown) => setError(String(err)))
    }
  }, [activeStreamId])

  // Regeneration owns the same composer for its entire read/delete/send cycle.
  // Capture history from the stored prefix, excluding the turn being replaced.
  const onRegenerate = useCallback(async () => {
    if (sendPending.current || regeneratePending.current || currentConversationId == null) return
    const conversationId = currentConversationId
    const visibleHistory = messagesRef.current.map(({ role, content }) => ({ role, content }))
    const startedNavigation = navigation.current
    const stillHere = (): boolean =>
      navigation.current === startedNavigation &&
      currentIdRef.current === conversationId &&
      navigationTarget.current === conversationId
    regeneratePending.current = true
    pendingSendCancelled.current = false
    setBusy(true)
    setError(null)
    try {
      const data = await window.api.conversations.getWithMessages(conversationId)
      if (!stillHere() || pendingSendCancelled.current) return
      const userIndex = data.messages.length - 2
      const user = data.messages[userIndex]
      const assistant = data.messages[userIndex + 1]
      if (
        data.conversation.workspaceId !== workspaceId ||
        data.conversation.id !== conversationId ||
        user?.role !== 'user' ||
        assistant?.role !== 'assistant' ||
        data.messages.length !== visibleHistory.length ||
        data.messages.some(
          (message, index) =>
            message.role !== visibleHistory[index]?.role ||
            message.content !== visibleHistory[index]?.content,
        )
      ) {
        throw new Error('Conversation changed; reload it before regenerating')
      }
      await window.api.conversations.deleteLatestTurn({
        workspaceId,
        conversationId,
        userMessageId: user.id,
        assistantMessageId: assistant.id,
      })
      if (!stillHere()) return
      const history = restoredMessages(data.messages.slice(0, userIndex))
      setMessages(history)
      if (pendingSendCancelled.current) {
        setDraftSuggestion({ text: user.content })
        return
      }
      await onSend(user.content, history)
    } catch (err) {
      console.error('[chat] regenerate failed', err)
      if (stillHere()) {
        setError(t('chat.regenerateFailed'))
        await openConversation(conversationId, true)
      }
    } finally {
      regeneratePending.current = false
      setBusy(false)
    }
  }, [currentConversationId, workspaceId, onSend, openConversation, t])

  const onDelete = useCallback(
    async (id: number) => {
      if (deletePending.current) return
      deletePending.current = true
      try {
        await window.api.conversations.delete(id)
        if (currentIdRef.current === id) {
          navigation.current++
          navigationTarget.current = null
          currentIdRef.current = null
          onConversationChange(null, [])
          setMessages([])
        }
        void refresh()
      } catch (err) {
        setError(String(err))
      } finally {
        deletePending.current = false
        setConfirmDelete(null)
      }
    },
    [refresh, onConversationChange],
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
    <div className="chat-workspace">
      <ConversationList
        conversations={conversations}
        currentId={currentConversationId}
        onSelect={onSelectConversation}
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
        {error && (
          <div className="chat__error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              {t('common.close')}
            </button>
          </div>
        )}
        <MessageList
          onPrompt={(text) => setDraftSuggestion({ text })}
          messages={messages}
          onCitationClick={onCitationClick}
          keepPipelineVisible={keepPipelineVisible}
          onCopy={onCopyMessage}
          documents={documents}
          {...(busy ? {} : { onRegenerate: () => void onRegenerate() })}
        />
        <ChatInput
          onSend={onSendForInput}
          busy={busy}
          onCancel={onCancel}
          suggestion={draftSuggestion}
        />
      </section>
      {sourceViewer && (
        <ErrorBoundary label={t('chat.sourcePreview')} onError={() => setSourceViewer(null)}>
          <ReaderBoundary
            label={sourceViewer.documentTitle ?? t('chat.sourcePreview')}
            onClose={() => setSourceViewer(null)}
          >
            <SourceViewer
              chunkId={sourceViewer.chunkId}
              messageText={sourceViewer.messageText}
              documentTitle={sourceViewer.documentTitle}
              // Small / German answers routinely emit no inline [doc,chunk]
              // markers, so the "Quellen" footer is the only citation. Fuzzy-match
              // the whole answer against the cited chunk to surface its grounding
              // passage instead of opening the source with nothing highlighted.
              wholeMessageFallback={true}
              onClose={() => setSourceViewer(null)}
            />
          </ReaderBoundary>
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

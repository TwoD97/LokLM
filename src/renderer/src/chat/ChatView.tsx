import { useCallback, useEffect, useRef, useState } from 'react'
import type { Conversation, StreamEvent } from '@shared/documents'
import { ChatHeader } from './ChatHeader'
import { ChatInput } from './ChatInput'
import { MessageList } from './MessageList'
import { ConversationList } from './ConversationList'
import { ConfirmModal } from './ConfirmModal'
import { SourceViewer } from './SourceViewer'
import { ErrorBoundary } from '../ErrorBoundary'
import './chat.css'

type StreamMetrics = {
  ttftMs: number | null
  tokensPerSec: number | null
  tokenCount: number
}

type LocalMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string
      streaming: boolean
      isRefusal?: boolean
      metrics?: StreamMetrics
    }

type Props = {
  workspaceId: number
}

export function ChatView({ workspaceId }: Props): JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Conversation | null>(null)
  const [sourceViewer, setSourceViewer] = useState<{ chunkId: number } | null>(null)

  // Closures captured by the stream listener see a stale `currentId` — we use
  // a ref so the listener can compare against the live value and drop tokens
  // for conversations the user has already navigated away from. Without this
  // the tokens of a still-running stream get appended to the LAST message of
  // whichever conv the user happens to be viewing.
  const currentIdRef = useRef<number | null>(null)
  useEffect(() => {
    currentIdRef.current = currentId
  }, [currentId])

  const refresh = useCallback(async () => {
    const list = await window.api.conversations.list(workspaceId)
    setConversations(list)
  }, [workspaceId])

  useEffect(() => {
    setCurrentId(null)
    setMessages([])
    void refresh()
  }, [workspaceId, refresh])

  const openConversation = useCallback(async (id: number) => {
    setCurrentId(id)
    const data = await window.api.conversations.getWithMessages(id)
    setMessages(
      data.messages.map((m) => {
        if (m.role === 'user') return { role: 'user', content: m.content }
        // Persisted assistant turns carry the stream metrics they were
        // recorded with. Re-hydrate the metrics chip if any of them survived
        // the round-trip (older rows have all-null and render without a chip).
        const hasMetrics = m.ttftMs != null || m.tokensPerSec != null || (m.tokenCount ?? 0) > 0
        return {
          role: 'assistant',
          content: m.content,
          streaming: false,
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
  }, [])

  const startNewChat = useCallback(() => {
    setCurrentId(null)
    setMessages([])
  }, [])

  const onSend = useCallback(
    async (text: string) => {
      setBusy(true)
      // Captured here so we still know it was a fresh chat after we mint a
      // conversation row below — `currentId` won't reflect the setState until
      // the next render.
      const wasNewConversation = currentId == null
      let convId = currentId
      if (convId == null) {
        const conv = await window.api.conversations.create(workspaceId)
        convId = conv.id
        setCurrentId(convId)
        await refresh()
      }
      const sendTime = performance.now()
      let firstTokenTime: number | null = null
      let tokenCount = 0
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        {
          role: 'assistant',
          content: '',
          streaming: true,
          metrics: { ttftMs: null, tokensPerSec: null, tokenCount: 0 },
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
            tokenCount += 1
            const ttftMs = firstTokenTime - sendTime
            const elapsedSinceFirst = (performance.now() - firstTokenTime) / 1000
            const tokensPerSec = elapsedSinceFirst > 0 ? tokenCount / elapsedSinceFirst : null
            next[next.length - 1] = {
              ...last,
              content: last.content + ev.text,
              metrics: { ttftMs, tokensPerSec, tokenCount },
            }
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
              content: `Error: ${ev.message}`,
              streaming: false,
            }
          } else if (ev.type === 'done') {
            next[next.length - 1] = { ...last, streaming: false }
          }
          return next
        })
      })
      try {
        await window.api.chat.stream(streamId, workspaceId, text, {
          conversationId: convId,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          rerank: true,
          contextualize: true,
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
    [currentId, workspaceId, messages, openConversation, refresh],
  )

  const onCancel = useCallback(() => {
    if (activeStreamId) void window.api.chat.cancel(activeStreamId)
  }, [activeStreamId])

  const onDelete = useCallback(
    async (id: number) => {
      await window.api.conversations.delete(id)
      if (currentId === id) {
        setCurrentId(null)
        setMessages([])
      }
      setConfirmDelete(null)
      void refresh()
    },
    [currentId, refresh],
  )

  const currentTitle =
    currentId != null
      ? (conversations.find((c) => c.id === currentId)?.title ?? `Conversation #${currentId}`)
      : 'New chat'

  const onCitationClick = useCallback(({ chunkId }: { documentId: number; chunkId: number }) => {
    setSourceViewer({ chunkId })
  }, [])

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: sourceViewer ? '240px minmax(0, 1fr) auto' : '240px minmax(0, 1fr)',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <ConversationList
        conversations={conversations}
        currentId={currentId}
        onSelect={(id) => void openConversation(id)}
        onNewChat={startNewChat}
        onRequestDelete={(c) => setConfirmDelete(c)}
      />
      <section className="chat">
        <ChatHeader
          title={currentTitle}
          onDelete={
            currentId != null
              ? () => setConfirmDelete(conversations.find((c) => c.id === currentId) ?? null)
              : null
          }
        />
        <MessageList messages={messages} onCitationClick={onCitationClick} />
        <ChatInput onSend={(t) => void onSend(t)} busy={busy} onCancel={onCancel} />
      </section>
      {sourceViewer && (
        <ErrorBoundary label="Quellenvorschau" onError={() => setSourceViewer(null)}>
          <SourceViewer
            chunkId={sourceViewer.chunkId}
            documentTitle={null}
            onClose={() => setSourceViewer(null)}
          />
        </ErrorBoundary>
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete conversation?"
          body={`This permanently removes "${confirmDelete.title ?? `#${confirmDelete.id}`}" and all its messages.`}
          onConfirm={() => void onDelete(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

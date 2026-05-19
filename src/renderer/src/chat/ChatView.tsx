import { useCallback, useEffect, useState } from 'react'
import type { Conversation, StreamEvent } from '@shared/documents'
import { ChatHeader } from './ChatHeader'
import { ChatInput } from './ChatInput'
import { MessageList } from './MessageList'
import { ConversationList } from './ConversationList'
import { ConfirmModal } from './ConfirmModal'
import { SourceViewer } from './SourceViewer'
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
      data.messages.map((m) =>
        m.role === 'user'
          ? { role: 'user', content: m.content }
          : { role: 'assistant', content: m.content, streaming: false },
      ),
    )
  }, [])

  const startNewChat = useCallback(() => {
    setCurrentId(null)
    setMessages([])
  }, [])

  const onSend = useCallback(
    async (text: string) => {
      setBusy(true)
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
      setActiveStreamId(streamId)
      const offEvent = window.api.chat.onEvent(streamId, (ev: StreamEvent) => {
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
        })
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
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', height: '100%' }}>
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
        <SourceViewer
          chunkId={sourceViewer.chunkId}
          documentTitle={null}
          onClose={() => setSourceViewer(null)}
        />
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

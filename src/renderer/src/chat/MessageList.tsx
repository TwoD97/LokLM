import { useEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'

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
  messages: LocalMessage[]
  onCitationClick: (m: { documentId: number; chunkId: number }) => void
}

export function MessageList({ messages, onCitationClick }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="chat__messages" ref={ref}>
        <div style={{ opacity: 0.5, textAlign: 'center', marginTop: 40 }}>
          Stelle eine Frage zu deinen Dokumenten.
        </div>
      </div>
    )
  }
  return (
    <div className="chat__messages" ref={ref}>
      {messages.map((m, i) => (
        <div key={i} className="chat__message-row">
          <MessageBubble
            role={m.role}
            content={m.content}
            {...(m.role === 'assistant' && m.isRefusal ? { isRefusal: true } : {})}
            onCitationClick={onCitationClick}
          />
          {m.role === 'assistant' && m.metrics && m.metrics.ttftMs != null && (
            <div className="chat__metrics">
              TTFT {(m.metrics.ttftMs / 1000).toFixed(2)} s
              {m.metrics.tokensPerSec != null && <> · {m.metrics.tokensPerSec.toFixed(1)} tok/s</>}
              <> · {m.metrics.tokenCount} tok</>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

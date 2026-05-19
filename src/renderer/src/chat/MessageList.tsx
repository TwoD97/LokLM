import { useEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'

type LocalMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; streaming: boolean; isRefusal?: boolean }

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
        <MessageBubble
          key={i}
          role={m.role}
          content={m.content}
          {...(m.role === 'assistant' && m.isRefusal ? { isRefusal: true } : {})}
          onCitationClick={onCitationClick}
        />
      ))}
    </div>
  )
}

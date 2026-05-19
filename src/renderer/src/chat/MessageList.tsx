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

const NEAR_BOTTOM_PX = 64

export function MessageList({ messages, onCitationClick }: Props): JSX.Element {
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
        <div className="chat__messages-empty">Stelle eine Frage zu deinen Dokumenten.</div>
      </div>
    )
  }
  return (
    <div className="chat__messages" ref={ref} onScroll={onScroll}>
      <div className="chat__inner">
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
                {m.metrics.tokensPerSec != null && (
                  <> · {m.metrics.tokensPerSec.toFixed(1)} tok/s</>
                )}
                <> · {m.metrics.tokenCount} tok</>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

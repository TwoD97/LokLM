import { useLayoutEffect, useRef, useState } from 'react'

type Props = {
  onSend: (text: string) => void
  busy: boolean
  onCancel?: () => void
}

const MAX_HEIGHT_PX = 200

export function ChatInput({ onSend, busy, onCancel }: Props): JSX.Element {
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const trimmed = draft.trim()
  const canSend = trimmed.length > 0 && !busy

  // Auto-grow the textarea up to MAX_HEIGHT_PX, then let it scroll.
  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [draft])

  const submit = (): void => {
    if (!canSend) return
    onSend(trimmed)
    setDraft('')
  }

  return (
    <div className="chat__input-wrap">
      <div className="chat__input-row">
        <textarea
          ref={textareaRef}
          className="chat__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter / Ctrl+Enter inserts a newline.
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Stelle eine Frage zu deinen Dokumenten… (Enter senden · Shift+Enter neue Zeile)"
          disabled={busy && !onCancel}
          rows={1}
        />
        {busy && onCancel ? (
          <button
            type="button"
            className="chat__send chat__send--cancel"
            onClick={onCancel}
            aria-label="Cancel streaming"
            title="Cancel"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="chat__send"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
            title="Send (Enter)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <path d="M3.4 20.4 21 12 3.4 3.6l2 7.4 9.6 1-9.6 1-2 7.4Z" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

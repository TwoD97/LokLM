import { useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

type Props = {
  onSend: (text: string) => void
  busy: boolean
  onCancel?: () => void
}

const MAX_HEIGHT_PX = 200

export function ChatInput({ onSend, busy, onCancel }: Props): JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const trimmed = draft.trim()
  const canSend = trimmed.length > 0 && !busy

  // Auto-grow the textarea up to MAX_HEIGHT_PX, then let it scroll.
  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const full = ta.scrollHeight
    ta.style.height = `${Math.min(full, MAX_HEIGHT_PX)}px`
    // Only reveal the scrollbar once the content genuinely exceeds the cap.
    // Otherwise sub-pixel rounding of a single line (line-height 14×1.45) makes
    // scrollHeight read ~1px over the box and `overflow: auto` flashes a
    // needless scrollbar on the empty/one-line input.
    ta.style.overflowY = full > MAX_HEIGHT_PX ? 'auto' : 'hidden'
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
          placeholder={t('chat.inputPlaceholder')}
          disabled={busy && !onCancel}
          rows={1}
        />
        {busy && onCancel ? (
          <button
            type="button"
            className="chat__send chat__send--cancel"
            onClick={onCancel}
            aria-label={t('chat.cancelStreaming')}
            title={t('common.cancel')}
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
            aria-label={t('chat.sendMessage')}
            title={t('chat.sendHint')}
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

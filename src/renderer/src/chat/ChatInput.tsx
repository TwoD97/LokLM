import { useState } from 'react'

type Props = {
  onSend: (text: string) => void
  busy: boolean
  onCancel?: () => void
}

export function ChatInput({ onSend, busy, onCancel }: Props): JSX.Element {
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()
  const canSend = trimmed.length > 0 && !busy

  const submit = (): void => {
    if (!canSend) return
    onSend(trimmed)
    setDraft('')
  }

  return (
    <div className="chat__input-wrap">
      <textarea
        className="chat__input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="Stelle eine Frage zu deinen Dokumenten…"
        disabled={busy}
      />
      <div className="chat__input-bar">
        <button className="chat__send" onClick={submit} disabled={!canSend}>
          Send (Ctrl+Enter)
        </button>
        {busy && onCancel && (
          <button className="chat__send" onClick={onCancel} style={{ background: '#5a1f1f' }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

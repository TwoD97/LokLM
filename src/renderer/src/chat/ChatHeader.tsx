type Props = {
  title: string
  onDelete: (() => void) | null
}

export function ChatHeader({ title, onDelete }: Props): JSX.Element {
  return (
    <header className="chat__header">
      <span className="chat__header-title">{title}</span>
      {onDelete && (
        <button
          type="button"
          className="chat__header-action"
          onClick={onDelete}
          aria-label="Delete conversation"
          title="Delete conversation"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path
              d="M5 7h14M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2m-7 0v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7M10 11v6M14 11v6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </header>
  )
}

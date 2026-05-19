type Props = {
  title: string
  onDelete: (() => void) | null
}

export function ChatHeader({ title, onDelete }: Props): JSX.Element {
  return (
    <header className="chat__header">
      <span className="chat__header-title">{title}</span>
      {onDelete && (
        <button onClick={onDelete} aria-label="Delete conversation">
          🗑️
        </button>
      )}
    </header>
  )
}

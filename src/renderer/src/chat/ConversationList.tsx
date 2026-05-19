import type { Conversation } from '@shared/documents'

type Props = {
  conversations: Conversation[]
  currentId: number | null
  onSelect: (id: number) => void
  onNewChat: () => void
  onRequestDelete: (c: Conversation) => void
}

export function ConversationList({
  conversations,
  currentId,
  onSelect,
  onNewChat,
  onRequestDelete,
}: Props): JSX.Element {
  return (
    <aside
      style={{
        borderRight: '1px solid #1f2a3a',
        padding: 12,
        overflowY: 'auto',
      }}
    >
      <button
        onClick={onNewChat}
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 6,
          background: '#1d3c66',
          color: '#d6e3f5',
          border: '1px solid #2c4c7a',
          cursor: 'pointer',
          marginBottom: 12,
        }}
      >
        + New chat
      </button>
      {conversations.length === 0 ? (
        <div style={{ opacity: 0.5, fontSize: 13 }}>No conversations yet.</div>
      ) : (
        conversations.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginBottom: 2,
            }}
          >
            <button
              onClick={() => onSelect(c.id)}
              style={{
                flex: 1,
                textAlign: 'left',
                padding: '6px 8px',
                borderRadius: 6,
                background: c.id === currentId ? '#16263b' : 'transparent',
                color: 'inherit',
                border: c.id === currentId ? '1px solid #243a55' : '1px solid transparent',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 13,
              }}
            >
              {c.title ?? `Conversation #${c.id}`}
              <span style={{ display: 'block', fontSize: 11, opacity: 0.55 }}>
                {c.messageCount} messages
              </span>
            </button>
            <button
              onClick={() => onRequestDelete(c)}
              aria-label="Delete"
              title="Delete"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9aaac0',
                cursor: 'pointer',
                padding: '4px 6px',
              }}
            >
              🗑️
            </button>
          </div>
        ))
      )}
    </aside>
  )
}

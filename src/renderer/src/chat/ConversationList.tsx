import { Trash2 } from 'lucide-react'
import type { Conversation } from '@shared/documents'
import { useT } from '../i18n'

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
  const t = useT()
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
        {t('chat.newChatButton')}
      </button>
      {conversations.length === 0 ? (
        <div style={{ opacity: 0.5, fontSize: 13 }}>{t('chat.noConversations')}</div>
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
              {c.title ?? t('chat.conversationFallback', { id: c.id })}
              <span style={{ display: 'block', fontSize: 11, opacity: 0.55 }}>
                {t('chat.messageCount', { count: c.messageCount })}
              </span>
            </button>
            <button
              onClick={() => onRequestDelete(c)}
              aria-label={t('common.delete')}
              title={t('common.delete')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9aaac0',
                cursor: 'pointer',
                padding: '4px 6px',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        ))
      )}
    </aside>
  )
}

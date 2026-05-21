import { memo, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { transformCitationMarkers } from '@shared/citationMarkers'
import { CitationChip } from './CitationChip'

type Role = 'user' | 'assistant'

type Props = {
  role: Role
  content: string
  isRefusal?: boolean
  /** Receives the citation marker AND the original assistant message text , so
   *  the SourceViewer can fuzzy-match the surrounding sentence inside the
   *  cited chunk. */
  onCitationClick: (m: { documentId: number; chunkId: number; messageText: string }) => void
}

function MessageBubbleImpl({ role, content, isRefusal, onCitationClick }: Props): JSX.Element {
  // Hooks unconditionally before the user-role early return so React's hook
  // order stays stable across role flips (won't happen in practice — same
  // bubble doesn't switch roles — but lint enforces it).
  const handleChipClick = useCallback(
    (m: { documentId: number; chunkId: number }) => onCitationClick({ ...m, messageText: content }),
    [onCitationClick, content],
  )
  const components = useMemo(
    () => ({
      a: (props: React.ComponentProps<'a'>) => (
        <CitationChip {...props} onCitationClick={handleChipClick} />
      ),
    }),
    [handleChipClick],
  )

  if (role === 'user') {
    return <div className="bubble bubble--user">{content}</div>
  }
  const { text } = transformCitationMarkers(content)
  return (
    <div className={`bubble ${isRefusal ? 'bubble--refusal' : 'bubble--assistant'}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

// memoised so that, on a streaming send, only the bubble whose content
// actually changed re-runs ReactMarkdown , prior bubbles get skipped via
// shallow prop equality (role + content + isRefusal + the stable
// useCallback'd onCitationClick from ChatView all match).
export const MessageBubble = memo(MessageBubbleImpl)

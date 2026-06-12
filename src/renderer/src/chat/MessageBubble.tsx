import { memo, useCallback, useMemo } from 'react'
import { transformCitationMarkers } from '@shared/citationMarkers'
import { MarkdownView } from '../markdown/MarkdownView'
import { CitationChip } from './CitationChip'

type Role = 'user' | 'assistant'

type Props = {
  role: Role
  content: string
  isRefusal?: boolean
  /** The chunks this turn actually cited (fed AND referenced). When present,
   *  markers outside this set are stripped instead of rendered as broken chips.
   *  Undefined while a turn is still streaming (citations aren't known yet).
   *  Passed as the message's stable array so the surrounding memo() still
   *  short-circuits — the Set is derived here, not rebuilt by the parent. */
  citations?: ReadonlyArray<{ documentId: number; chunkId: number }>
  /** Receives the citation marker AND the original assistant message text , so
   *  the SourceViewer can fuzzy-match the surrounding sentence inside the
   *  cited chunk. */
  onCitationClick: (m: { documentId: number; chunkId: number; messageText: string }) => void
}

function MessageBubbleImpl({
  role,
  content,
  isRefusal,
  citations,
  onCitationClick,
}: Props): JSX.Element {
  const citedKeys = useMemo(
    () => (citations ? new Set(citations.map((c) => `${c.documentId}-${c.chunkId}`)) : undefined),
    [citations],
  )
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
  const { text } = transformCitationMarkers(content, citedKeys)
  return (
    <div className={`bubble ${isRefusal ? 'bubble--refusal' : 'bubble--assistant'}`}>
      <MarkdownView components={components}>{text}</MarkdownView>
    </div>
  )
}

// memoised so that, on a streaming send, only the bubble whose content
// actually changed re-runs ReactMarkdown , prior bubbles get skipped via
// shallow prop equality (role + content + isRefusal + the stable
// useCallback'd onCitationClick from ChatView all match).
export const MessageBubble = memo(MessageBubbleImpl)

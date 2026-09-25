import { memo, useCallback, useMemo } from 'react'
import { transformCitationMarkers } from '@shared/citationMarkers'
import { MarkdownView } from '../markdown/MarkdownView'
import { CitationChip } from './CitationChip'

type Role = 'user' | 'assistant'

type Props = {
  role: Role
  content: string
  isRefusal?: boolean
  /** Allowed supplied passages for this turn, including while streaming.
   *  Unknown markers remain text; an absent set grants no clickable sources.
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
    () => new Set((citations ?? []).map((c) => `${c.documentId}-${c.chunkId}`)),
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
        <CitationChip {...props} allowedKeys={citedKeys} onCitationClick={handleChipClick} />
      ),
    }),
    [handleChipClick, citedKeys],
  )

  if (role === 'user') {
    return <div className="bubble bubble--user">{content}</div>
  }
  // Inline [doc:X,chunk:Y] markers become clickable chips via the markdown `a`
  // override below. A marker-less answer is NOT left source-less here: the
  // per-turn source list under the bubble already distinguishes provided from
  // cited sources, so an in-bubble source footer
  // only duplicated it — removed.
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

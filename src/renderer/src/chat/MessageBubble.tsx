import { memo, useCallback, useMemo } from 'react'
import { transformCitationMarkers } from '@shared/citationMarkers'
import { MarkdownView } from '../markdown/MarkdownView'
import { CitationChip } from './CitationChip'
import { useT } from '../i18n'

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
  const t = useT()
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
  const { text, markers } = transformCitationMarkers(content, citedKeys)
  // Fallback sources: the answer was grounded on the fed chunks, but the model
  // emitted NO inline [doc:X,chunk:Y] markers (common with small / German
  // outputs) — so transformCitationMarkers produced no chips and the user sees
  // no source. Surface the fed citations (one chip per document, in score
  // order) as a footer so an answer is never source-less and the file is one
  // click away. Only when not a refusal and citations are actually known.
  const fallbackSources: Array<{ documentId: number; chunkId: number }> = []
  if (!isRefusal && markers.length === 0 && citations && citations.length > 0) {
    const seenDocs = new Set<number>()
    for (const c of citations) {
      if (seenDocs.has(c.documentId)) continue
      seenDocs.add(c.documentId)
      fallbackSources.push({ documentId: c.documentId, chunkId: c.chunkId })
      if (fallbackSources.length >= 6) break
    }
  }
  return (
    <div className={`bubble ${isRefusal ? 'bubble--refusal' : 'bubble--assistant'}`}>
      <MarkdownView components={components}>{text}</MarkdownView>
      {fallbackSources.length > 0 && (
        <div className="bubble__sources">
          <span className="bubble__sources-label">{t('chat.sources')}</span>
          {fallbackSources.map((c, i) => (
            <CitationChip
              key={`${c.documentId}-${c.chunkId}`}
              href={`#cite-${c.documentId}-${c.chunkId}`}
              onCitationClick={handleChipClick}
            >
              {i + 1}
            </CitationChip>
          ))}
        </div>
      )}
    </div>
  )
}

// memoised so that, on a streaming send, only the bubble whose content
// actually changed re-runs ReactMarkdown , prior bubbles get skipped via
// shallow prop equality (role + content + isRefusal + the stable
// useCallback'd onCitationClick from ChatView all match).
export const MessageBubble = memo(MessageBubbleImpl)

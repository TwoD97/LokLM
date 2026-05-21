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

export function MessageBubble({ role, content, isRefusal, onCitationClick }: Props): JSX.Element {
  if (role === 'user') {
    return <div className="bubble bubble--user">{content}</div>
  }
  const { text } = transformCitationMarkers(content)
  return (
    <div className={`bubble ${isRefusal ? 'bubble--refusal' : 'bubble--assistant'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <CitationChip
              {...props}
              onCitationClick={(m) => onCitationClick({ ...m, messageText: content })}
            />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { transformCitationMarkers } from '@shared/citationMarkers'
import { CitationChip } from './CitationChip'

type Role = 'user' | 'assistant'

type Props = {
  role: Role
  content: string
  isRefusal?: boolean
  onCitationClick: (m: { documentId: number; chunkId: number }) => void
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
          a: (props) => <CitationChip {...props} onCitationClick={onCitationClick} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

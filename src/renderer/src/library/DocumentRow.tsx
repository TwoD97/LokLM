import { useState } from 'react'
import type { Document, IndexProgress } from '@shared/documents'

type Props = {
  doc: Document
  progress?: IndexProgress
  onDelete: (id: number) => void
  onReindex: (id: number) => void
}

export function DocumentRow({ doc, progress, onDelete, onReindex }: Props): JSX.Element {
  const [menu, setMenu] = useState(false)
  const status =
    progress?.phase === 'failed' || doc.status === 'failed'
      ? 'failed'
      : progress && progress.phase !== 'done'
        ? 'indexing'
        : doc.status

  return (
    <tr>
      <td>{doc.title}</td>
      <td>
        <span className={`library__status library__status--${status}`}>{status}</span>
        {progress && progress.phase !== 'done' && progress.phase !== 'failed' && (
          <span style={{ marginLeft: 8, opacity: 0.7 }}>
            {progress.phase} {progress.step}/{progress.total}
          </span>
        )}
      </td>
      <td>{doc.chunkCount}</td>
      <td>{new Date(doc.addedAt * 1000).toLocaleString()}</td>
      <td style={{ width: 40, position: 'relative' }}>
        <button onClick={() => setMenu((v) => !v)} aria-label="actions">
          ⋯
        </button>
        {menu && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              background: '#0f1a2a',
              border: '1px solid #243a55',
              padding: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              zIndex: 10,
            }}
          >
            <button
              onClick={() => {
                setMenu(false)
                onReindex(doc.id)
              }}
            >
              Reindex
            </button>
            <button
              onClick={() => {
                setMenu(false)
                onDelete(doc.id)
              }}
            >
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

import { memo } from 'react'
import { AlertTriangle, Pin } from 'lucide-react'
import type { Document, IndexProgress } from '@shared/documents'
import { useT } from '../i18n'
import { DocumentActionsMenu, type DocumentActions } from './DocumentActionsMenu'
import { LanguageBadge } from './DocumentRow'

type Props = {
  doc: Document
  progress?: IndexProgress
} & DocumentActions

/**
 * File-row body for the Library's "Folders" view. The FolderTree owns the
 * draggable wrapper + indentation; this fills it with the same title/status/
 * actions a table row shows. Memoised so an indexing storm doesn't redraw every
 * leaf (same reason as DocumentRow).
 */
function LibraryFileRowImpl({ doc, progress, ...actions }: Props): JSX.Element {
  const t = useT()
  const status =
    progress?.phase === 'failed' || doc.status === 'failed'
      ? 'failed'
      : progress && progress.phase !== 'done'
        ? 'indexing'
        : doc.status
  const isMissing = doc.missingAt != null
  return (
    <div
      className={`library__tree-file-body${isMissing ? ' library__row--missing' : ''}`}
      onDoubleClick={() => actions.onRead(doc)}
    >
      <span className="library__tree-name library__row-title">
        {isMissing && (
          <AlertTriangle
            size={14}
            aria-label={t('library.sourceMissing')}
            className="library__row-missing-icon"
          />
        )}
        {doc.pinned && (
          <Pin size={12} aria-label={t('library.pinned')} className="library__row-pinned-icon" />
        )}
        <span className="library__tree-title-text">{doc.title}</span>
        {doc.language && <LanguageBadge language={doc.language} t={t} />}
      </span>
      <span className={`library__status library__status--${status}`}>{status}</span>
      <DocumentActionsMenu doc={doc} {...actions} />
    </div>
  )
}

export const LibraryFileRow = memo(LibraryFileRowImpl)

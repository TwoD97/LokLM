import { memo } from 'react'
import { AlertTriangle, Pin } from 'lucide-react'
import type { Document, IndexProgress } from '@shared/documents'
import { useT } from '../i18n'
import type { TFn } from '../i18n'
import { DocumentActionsMenu, type DocumentActions } from './DocumentActionsMenu'
import { deriveRowStatus, type RowStatus } from './documentStatus'

type Props = {
  doc: Document
  progress?: IndexProgress
  /** True while a workspace-wide vector re-embed (model swap / backfill) is in
   *  flight — see {@link deriveRowStatus}. */
  reembedding?: boolean
} & DocumentActions

// Single source of truth for the status pill — class + label — so the three row
// layouts (table, folders, location tree) stay in lockstep.
export function StatusBadge({ status }: { status: RowStatus }): JSX.Element {
  const label = status === 'reembedding' ? 're-embedding' : status
  return <span className={`library__status library__status--${status}`}>{label}</span>
}

function DocumentRowImpl({ doc, progress, reembedding, ...actions }: Props): JSX.Element {
  const t = useT()
  const status = deriveRowStatus(doc, progress, reembedding)
  const isMissing = doc.missingAt != null

  return (
    <tr
      className={isMissing ? 'library__row--missing' : ''}
      onDoubleClick={() => actions.onRead(doc)}
    >
      <td>
        <span className="library__row-title">
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
          {doc.title}
          {doc.language && <LanguageBadge language={doc.language} t={t} />}
        </span>
      </td>
      <td>
        <StatusBadge status={status} />
        {progress && progress.phase !== 'done' && progress.phase !== 'failed' && (
          <span style={{ marginLeft: 8, opacity: 0.7 }}>
            {progress.detail ?? `${progress.phase} ${progress.step}/${progress.total}`}
          </span>
        )}
      </td>
      <td>{doc.chunkCount}</td>
      <td>{new Date(doc.addedAt * 1000).toLocaleString()}</td>
      <td style={{ width: 40 }}>
        <DocumentActionsMenu doc={doc} {...actions} />
      </td>
    </tr>
  )
}

export function LanguageBadge({
  language,
  t,
}: {
  language: 'de' | 'en' | 'mixed'
  t: TFn
}): JSX.Element {
  const label = language === 'mixed' ? 'de+en' : language
  const className =
    language === 'mixed' ? 'library__lang-badge library__lang-badge--mixed' : 'library__lang-badge'
  return (
    <span
      className={className}
      title={
        language === 'mixed'
          ? t('library.langMixedTitle')
          : t('library.docLanguageTitle', {
              language: language === 'de' ? t('library.langGerman') : t('library.langEnglish'),
            })
      }
    >
      {label}
    </span>
  )
}

// memoised so rows whose (doc, progress) didn't change skip re-render when
// the parent's progress map updates a different row , under indexing
// storms the whole table used to redraw every tick.
export const DocumentRow = memo(DocumentRowImpl)

import { memo } from 'react'
import { AlertTriangle, Pin } from 'lucide-react'
import type { Document, IndexProgress } from '@shared/documents'
import { useT } from '../i18n'
import type { TFn } from '../i18n'
import { DocumentActionsMenu, type DocumentActions } from './DocumentActionsMenu'
import { deriveRowStatus, type RowStatus } from './documentStatus'
import { DocIcon } from '../ui/DocIcon'
import { useSettings } from '../settings/useSettings'

const DATE_FORMATTERS = {
  'de-DE': new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }),
  'en-GB': new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
}

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
  const t = useT()
  const label = t(
    {
      pending: 'ux.pending',
      indexing: 'library.statusIndexing',
      ready: 'library.statusReady',
      failed: 'library.statusFailed',
      reembedding: 'ux.reembedding',
    }[status],
  )
  return <span className={`library__status library__status--${status}`}>{label}</span>
}

function DocumentRowImpl({ doc, progress, reembedding, ...actions }: Props): JSX.Element {
  const t = useT()
  const { settings } = useSettings()
  const locale = settings?.basic.language === 'de' ? 'de-DE' : 'en-GB'
  const status = deriveRowStatus(doc, progress, reembedding)
  const isMissing = doc.missingAt != null

  return (
    <tr
      className={isMissing ? 'library__row--missing' : ''}
      onDoubleClick={() => actions.onRead(doc)}
    >
      <td>
        <span className="library__row-title">
          <DocIcon source={doc.sourcePath} size={18} />
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
          <button
            type="button"
            className="library__document-link"
            onClick={() => actions.onRead(doc)}
            title={doc.title}
          >
            {doc.title}
          </button>
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
      <td>{progress?.chunksTotal ?? doc.chunkCount}</td>
      <td className="library__added" title={new Date(doc.addedAt * 1000).toLocaleString(locale)}>
        {DATE_FORMATTERS[locale].format(doc.addedAt * 1000)}
      </td>
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

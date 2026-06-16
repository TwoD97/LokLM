import type { LibraryDocType, LibrarySearchHit } from '@shared/documents'
import { applyHighlights, findLiteralHighlights } from '@shared/fuzzyHighlight'
import type { SearchStatus } from './useLibrarySearch'
import { useT, type TFn } from '../i18n'

type Props = {
  hits: LibrarySearchHit[]
  status: SearchStatus
  onOpen: (hit: LibrarySearchHit) => void
  /** Current query — used to highlight the matched part of the filename (the
   *  searchLibrary filename arm matches the title with an ILIKE on this). */
  query?: string
}

const TYPE_LABEL_KEY: Record<LibraryDocType, string> = {
  pdf: 'library.typePdf',
  md: 'library.typeMd',
  txt: 'library.typeTxt',
  code: 'library.typeCode',
  docx: 'library.typeDocx',
}

// Page number for paginated docs (PDF); heading breadcrumb for markdown chunks
// (which have no pages); nothing for unstructured text.
function locationLabel(hit: LibrarySearchHit, t: TFn): string | null {
  if (hit.pageFrom != null) {
    if (hit.pageTo != null && hit.pageTo !== hit.pageFrom) {
      return t('library.pageRange', { from: hit.pageFrom, to: hit.pageTo })
    }
    return t('library.pageLabel', { page: hit.pageFrom })
  }
  if (hit.headingPath && hit.headingPath.length > 0) {
    return hit.headingPath.join(' › ')
  }
  return null
}

/** Library search result list — one row per matching document. The excerpt is
 *  rendered from pre-split highlight segments as <mark>/<span> (never innerHTML).
 *  Clicking a row opens the SourceViewer at the matched chunk. */
export function SearchResults({ hits, status, onOpen, query = '' }: Props): JSX.Element {
  const t = useT()
  if (status === 'done' && hits.length === 0) {
    return <p className="library__search-empty">{t('library.searchNoHits')}</p>
  }
  return (
    <ul className="library__results">
      {hits.map((h) => {
        const loc = locationLabel(h, t)
        const titleSegments = applyHighlights(
          h.documentTitle,
          findLiteralHighlights(h.documentTitle, query),
        )
        return (
          <li key={h.chunkId}>
            <button type="button" className="library__result" onClick={() => onOpen(h)}>
              <span className="library__result-head">
                <span
                  className={`library__result-type-badge library__result-type-badge--${h.docType}`}
                >
                  {t(TYPE_LABEL_KEY[h.docType])}
                </span>
                <span className="library__result-title">
                  {titleSegments.map((s, i) =>
                    s.highlighted ? (
                      <mark key={i} className="library__mark">
                        {s.text}
                      </mark>
                    ) : (
                      <span key={i}>{s.text}</span>
                    ),
                  )}
                </span>
                {loc && <span className="library__result-loc">{loc}</span>}
              </span>
              <span className="library__result-excerpt">
                {h.segments.map((s, i) =>
                  s.highlighted ? (
                    <mark key={i} className="library__mark">
                      {s.text}
                    </mark>
                  ) : (
                    <span key={i}>{s.text}</span>
                  ),
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

import type { LibraryDocType, LibrarySort } from '@shared/documents'
import { LIBRARY_DOC_TYPES } from '@shared/docType'
import { useT } from '../i18n'
import { Select } from '../ui/Select'
import type { DatePreset, LibrarySearchFilters, SizePreset, StatusFilter } from './useLibrarySearch'

type Props = {
  query: string
  onQueryChange: (q: string) => void
  onClear: () => void
  filters: LibrarySearchFilters
  onTypesChange: (types: Set<LibraryDocType>) => void
  onDateChange: (date: DatePreset) => void
  onSizeChange: (size: SizePreset) => void
  onStatusChange: (status: StatusFilter) => void
  sort: LibrarySort
  onSortChange: (sort: LibrarySort) => void
  active: boolean
  resultCount?: number | undefined
}

const TYPE_LABEL_KEY: Record<LibraryDocType, string> = {
  pdf: 'library.typePdf',
  md: 'library.typeMd',
  txt: 'library.typeTxt',
  code: 'library.typeCode',
  docx: 'library.typeDocx',
}
const SORTS: LibrarySort[] = ['relevance', 'filename', 'added']
const SORT_LABEL_KEY: Record<LibrarySort, string> = {
  relevance: 'library.sortRelevance',
  filename: 'library.sortFilename',
  added: 'library.sortAdded',
}
const DATE_PRESETS: DatePreset[] = ['any', '7d', '30d', 'year']
const DATE_LABEL_KEY: Record<DatePreset, string> = {
  any: 'library.dateAny',
  '7d': 'library.date7d',
  '30d': 'library.date30d',
  year: 'library.dateYear',
}
const SIZE_PRESETS: SizePreset[] = ['any', 'small', 'medium', 'large']
const SIZE_LABEL_KEY: Record<SizePreset, string> = {
  any: 'library.sizeAny',
  small: 'library.sizeSmall',
  medium: 'library.sizeMedium',
  large: 'library.sizeLarge',
}
const STATUS_PRESETS: StatusFilter[] = ['all', 'indexing', 'ready', 'failed']
const STATUS_LABEL_KEY: Record<StatusFilter, string> = {
  all: 'library.statusAll',
  indexing: 'library.statusIndexing',
  ready: 'library.statusReady',
  failed: 'library.statusFailed',
}

function toggleType(types: Set<LibraryDocType>, ty: LibraryDocType): Set<LibraryDocType> {
  const next = new Set(types)
  if (next.has(ty)) next.delete(ty)
  else next.add(ty)
  return next
}

/** Library search bar: query input + clear, type chips, date/size dropdowns and
 *  the sort dropdown — all inline. Purely presentational; state lives in
 *  useLibrarySearch and is lifted through the callbacks. */
export function LibrarySearchBar({
  query,
  onQueryChange,
  onClear,
  filters,
  onTypesChange,
  onDateChange,
  onSizeChange,
  onStatusChange,
  sort,
  onSortChange,
  active,
  resultCount,
}: Props): JSX.Element {
  const t = useT()
  return (
    <div className="library__search">
      <div className="library__search-row">
        <input
          type="search"
          className="library__search-input"
          placeholder={t('library.searchPlaceholder')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {active && (
          <button
            type="button"
            className="library__search-clear"
            aria-label={t('library.searchClear')}
            onClick={onClear}
          >
            ×
          </button>
        )}
        <Select
          ariaLabel={t('library.sortBy')}
          value={sort}
          options={SORTS.map((s) => ({ value: s, label: t(SORT_LABEL_KEY[s]) }))}
          onChange={onSortChange}
        />
      </div>
      <div className="library__filters">
        <span className="library__filters-label">{t('library.filterType')}</span>
        {LIBRARY_DOC_TYPES.map((ty) => {
          const on = filters.types.has(ty)
          return (
            <button
              key={ty}
              type="button"
              className={`library__filter-chip ${on ? 'library__filter-chip--active' : ''}`}
              aria-pressed={on}
              onClick={() => onTypesChange(toggleType(filters.types, ty))}
            >
              {t(TYPE_LABEL_KEY[ty])}
            </button>
          )
        })}
        <span className="library__filters-sep" aria-hidden="true" />
        <Select
          ariaLabel={t('library.filterDate')}
          prefix={t('library.filterDate')}
          value={filters.date}
          options={DATE_PRESETS.map((d) => ({ value: d, label: t(DATE_LABEL_KEY[d]) }))}
          onChange={onDateChange}
        />
        <Select
          ariaLabel={t('library.filterSize')}
          prefix={t('library.filterSize')}
          value={filters.size}
          options={SIZE_PRESETS.map((s) => ({ value: s, label: t(SIZE_LABEL_KEY[s]) }))}
          onChange={onSizeChange}
        />
        {/* Index-state has no meaning over search hits (always indexed text), so
            the Status filter shows only while browsing. */}
        {!active && (
          <Select
            ariaLabel={t('library.filterStatus')}
            prefix={t('library.filterStatus')}
            value={filters.status}
            options={STATUS_PRESETS.map((s) => ({ value: s, label: t(STATUS_LABEL_KEY[s]) }))}
            onChange={onStatusChange}
          />
        )}
        {active && resultCount != null && (
          <span className="library__results-count">
            {t('library.searchResultsCount', { count: resultCount })}
          </span>
        )}
      </div>
    </div>
  )
}

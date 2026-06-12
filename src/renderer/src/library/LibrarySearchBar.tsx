import type { LibraryDocType, LibrarySort } from '@shared/documents'
import { LIBRARY_DOC_TYPES } from '@shared/docType'
import { useT } from '../i18n'
import type { DatePreset, LibrarySearchFilters, SizePreset } from './useLibrarySearch'

type Props = {
  query: string
  onQueryChange: (q: string) => void
  onClear: () => void
  filters: LibrarySearchFilters
  onTypesChange: (types: Set<LibraryDocType>) => void
  onDateChange: (date: DatePreset) => void
  onSizeChange: (size: SizePreset) => void
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
        <select
          className="library__sort"
          aria-label={t('library.sortBy')}
          value={sort}
          onChange={(e) => onSortChange(e.target.value as LibrarySort)}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(SORT_LABEL_KEY[s])}
            </option>
          ))}
        </select>
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
        <select
          className="library__filter-select"
          aria-label={t('library.filterDate')}
          value={filters.date}
          onChange={(e) => onDateChange(e.target.value as DatePreset)}
        >
          {DATE_PRESETS.map((d) => (
            <option key={d} value={d}>
              {t(DATE_LABEL_KEY[d])}
            </option>
          ))}
        </select>
        <select
          className="library__filter-select"
          aria-label={t('library.filterSize')}
          value={filters.size}
          onChange={(e) => onSizeChange(e.target.value as SizePreset)}
        >
          {SIZE_PRESETS.map((s) => (
            <option key={s} value={s}>
              {t(SIZE_LABEL_KEY[s])}
            </option>
          ))}
        </select>
        {active && resultCount != null && (
          <span className="library__results-count">
            {t('library.searchResultsCount', { count: resultCount })}
          </span>
        )}
      </div>
    </div>
  )
}

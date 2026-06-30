import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LibraryDocType,
  LibrarySearchHit,
  LibrarySearchOptions,
  LibrarySort,
} from '@shared/documents'

export type DatePreset = 'any' | '7d' | '30d' | 'year'
export type SizePreset = 'any' | 'small' | 'medium' | 'large'
/** Browse-mode index-state filter. Search hits are always indexed text, so this
 *  only narrows the browse list (DocumentTable / tree views), never the search. */
export type StatusFilter = 'all' | 'indexing' | 'ready' | 'failed'

export interface LibrarySearchFilters {
  /** Selected type buckets. Empty = no type filter (all). */
  types: Set<LibraryDocType>
  date: DatePreset
  size: SizePreset
  /** Index-state bucket. Browse-only — ignored while a search query is active. */
  status: StatusFilter
}

const DAY_SECONDS = 86_400
const MB = 1_000_000

/** Map a date preset to an added_at lower bound (epoch seconds), or null for
 *  "any". `nowSeconds` is injected so the mapping is pure and unit-testable. */
export function datePresetToAddedAfter(preset: DatePreset, nowSeconds: number): number | null {
  switch (preset) {
    case '7d':
      return nowSeconds - 7 * DAY_SECONDS
    case '30d':
      return nowSeconds - 30 * DAY_SECONDS
    case 'year':
      return nowSeconds - 365 * DAY_SECONDS
    case 'any':
    default:
      return null
  }
}

/** Map a size preset to inclusive byte bounds. Null bound = unbounded on that side. */
export function sizePresetToBounds(preset: SizePreset): {
  minBytes: number | null
  maxBytes: number | null
} {
  switch (preset) {
    case 'small':
      return { minBytes: null, maxBytes: 1 * MB }
    case 'medium':
      return { minBytes: 1 * MB, maxBytes: 10 * MB }
    case 'large':
      return { minBytes: 10 * MB, maxBytes: null }
    case 'any':
    default:
      return { minBytes: null, maxBytes: null }
  }
}

export type SearchStatus = 'idle' | 'searching' | 'done'

export interface UseLibrarySearch {
  query: string
  setQuery: (q: string) => void
  filters: LibrarySearchFilters
  setTypes: (types: Set<LibraryDocType>) => void
  setDate: (date: DatePreset) => void
  setSize: (size: SizePreset) => void
  setStatusFilter: (status: StatusFilter) => void
  /** Reset every browse filter (type/date/size/status) back to "all". */
  resetFilters: () => void
  /** True when any filter is narrowing the list — drives the "clear filters"
   *  affordance and the filtered-empty state. */
  filtersActive: boolean
  sort: LibrarySort
  setSort: (sort: LibrarySort) => void
  hits: LibrarySearchHit[]
  status: SearchStatus
  /** True when there is a non-empty query — drives the search-vs-browse switch. */
  active: boolean
  clear: () => void
}

const DEBOUNCE_MS = 250

/** Optional external ownership of the query string. When supplied (AppShell
 *  lifts it so it survives a tab-switch unmount of the Library), the hook reads
 *  and writes through it; when omitted the hook owns the query internally — the
 *  standalone / test default. The filters and sort stay component-local. */
export interface LibrarySearchControl {
  query?: string | undefined
  onQueryChange?: ((q: string) => void) | undefined
}

/** Library search state: debounced query → window.api.documents.searchLibrary,
 *  with type/date/size filters and sort. Empty query short-circuits to idle (no
 *  IPC) so the Library falls back to its normal browse table. A request counter
 *  drops stale responses that resolve out of order. */
export function useLibrarySearch(
  workspaceId: number,
  control?: LibrarySearchControl,
): UseLibrarySearch {
  const [internalQuery, setInternalQuery] = useState('')
  const controlledQuery = control?.query
  const onQueryChange = control?.onQueryChange
  const query = controlledQuery ?? internalQuery
  const setQuery = useCallback(
    (q: string) => {
      onQueryChange?.(q)
      if (controlledQuery === undefined) setInternalQuery(q)
    },
    [onQueryChange, controlledQuery],
  )
  const [filters, setFilters] = useState<LibrarySearchFilters>({
    types: new Set<LibraryDocType>(),
    date: 'any',
    size: 'any',
    status: 'all',
  })
  const [sort, setSort] = useState<LibrarySort>('relevance')
  const [hits, setHits] = useState<LibrarySearchHit[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')

  const reqId = useRef(0)
  const active = query.trim().length > 0

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      reqId.current++ // invalidate any in-flight response
      setHits([])
      setStatus('idle')
      return
    }
    setStatus('searching')
    const myReq = ++reqId.current
    const handle = setTimeout(() => {
      const bounds = sizePresetToBounds(filters.size)
      const opts: LibrarySearchOptions = {
        types: filters.types.size > 0 ? [...filters.types] : null,
        addedAfter: datePresetToAddedAfter(filters.date, Math.floor(Date.now() / 1000)),
        minBytes: bounds.minBytes,
        maxBytes: bounds.maxBytes,
        sort,
      }
      void window.api.documents
        .searchLibrary(workspaceId, trimmed, opts)
        .then((res) => {
          if (myReq !== reqId.current) return
          setHits(res)
          setStatus('done')
        })
        .catch(() => {
          if (myReq !== reqId.current) return
          setHits([])
          setStatus('done')
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [query, filters, sort, workspaceId])

  const clear = useCallback(() => setQuery(''), [setQuery])
  const setTypes = useCallback(
    (types: Set<LibraryDocType>) => setFilters((f) => ({ ...f, types })),
    [],
  )
  const setDate = useCallback((date: DatePreset) => setFilters((f) => ({ ...f, date })), [])
  const setSize = useCallback((size: SizePreset) => setFilters((f) => ({ ...f, size })), [])
  const setStatusFilter = useCallback(
    (s: StatusFilter) => setFilters((f) => ({ ...f, status: s })),
    [],
  )
  const resetFilters = useCallback(
    () => setFilters({ types: new Set<LibraryDocType>(), date: 'any', size: 'any', status: 'all' }),
    [],
  )
  const filtersActive =
    filters.types.size > 0 ||
    filters.date !== 'any' ||
    filters.size !== 'any' ||
    filters.status !== 'all'

  return {
    query,
    setQuery,
    filters,
    setTypes,
    setDate,
    setSize,
    setStatusFilter,
    resetFilters,
    filtersActive,
    sort,
    setSort,
    hits,
    status,
    active,
    clear,
  }
}

import type { Document, IndexProgress, LibrarySort } from '@shared/documents'
import { classifyDocType } from '@shared/docType'
import { deriveRowStatus } from './documentStatus'
import {
  datePresetToAddedAfter,
  sizePresetToBounds,
  type LibrarySearchFilters,
  type StatusFilter,
} from './useLibrarySearch'

/** Does a document's derived row-status fall in the chosen status bucket?
 *  'indexing' collapses every in-flight state (pending / indexing / re-embedding)
 *  — the user thinks of "still working" as one thing. Mirrors the same buckets
 *  the search bar offers. */
function matchesStatus(
  doc: Document,
  bucket: Exclude<StatusFilter, 'all'>,
  progress: IndexProgress | undefined,
  reembedding: boolean,
): boolean {
  const s = deriveRowStatus(doc, progress, reembedding)
  switch (bucket) {
    case 'indexing':
      return s === 'indexing' || s === 'pending' || s === 'reembedding'
    case 'ready':
      return s === 'ready'
    case 'failed':
      return s === 'failed'
  }
}

/** Apply the browse-mode filters (type / date / size / status) to the document
 *  list shown when no search query is active. The search path filters server-side
 *  in DocumentsRepo.searchLibrary; this is the client-side equivalent so the same
 *  chips/dropdowns actually narrow the plain document list too — they used to be
 *  inert outside of search. Pure (now injected) so it stays unit-testable.
 *
 *  Byte/date semantics match the SQL: a NULL byte_size is excluded the moment a
 *  size bound is set (SQL `NULL <= x` is unknown → row dropped). */
export function filterBrowseDocs(
  docs: Document[],
  filters: LibrarySearchFilters,
  progress: Map<number, IndexProgress>,
  reembedDocIds: Set<number>,
  nowSeconds: number,
): Document[] {
  const addedAfter = datePresetToAddedAfter(filters.date, nowSeconds)
  const { minBytes, maxBytes } = sizePresetToBounds(filters.size)
  const sized = minBytes != null || maxBytes != null
  const { types, status } = filters
  return docs.filter((d) => {
    if (types.size > 0 && !types.has(classifyDocType(d.sourcePath, d.mimeType))) return false
    if (addedAfter != null && d.addedAt < addedAfter) return false
    if (sized) {
      if (d.byteSize == null) return false
      if (minBytes != null && d.byteSize < minBytes) return false
      if (maxBytes != null && d.byteSize > maxBytes) return false
    }
    if (
      status !== 'all' &&
      !matchesStatus(d, status, progress.get(d.id), reembedDocIds.has(d.id))
    ) {
      return false
    }
    return true
  })
}

/** Order the browse list by the shared sort control. 'relevance' has no meaning
 *  without a query, so it leaves the workspace's natural (insertion) order — the
 *  DocumentTable still floats in-progress rows to the top on top of this. Returns
 *  a fresh array for the sorted cases; the input untouched for 'relevance'. */
export function sortBrowseDocs(docs: Document[], sort: LibrarySort): Document[] {
  if (sort === 'filename') return [...docs].sort((a, b) => a.title.localeCompare(b.title))
  if (sort === 'added') return [...docs].sort((a, b) => b.addedAt - a.addedAt)
  return docs
}

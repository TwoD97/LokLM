import type { Document, IndexProgress } from '@shared/documents'

// The label shown in a row's status column, with one synthetic value beyond the
// persisted `doc.status`: 'reembedding'. A workspace-wide re-embed rebuilds every
// document's dense vectors at once, so an otherwise-'ready' doc has degraded
// semantic search until it lands — 'ready' would mislead. An in-flight per-doc
// index/failure is more specific and still wins.
export type RowStatus = Document['status'] | 'reembedding'

export function deriveRowStatus(
  doc: Document,
  progress: IndexProgress | undefined,
  reembedding: boolean | undefined,
): RowStatus {
  if (progress?.phase === 'failed' || doc.status === 'failed') return 'failed'
  if (progress && progress.phase !== 'done') return 'indexing'
  if (reembedding && doc.status === 'ready') return 'reembedding'
  return doc.status
}

import type { Document } from './documents'

/** Aggregate indexing progress for a workspace's document list, derived purely
 *  from each document's status. Drives the Library's batch progress bar
 *  ("X von N indexiert (Y %)"). No backend plumbing — the renderer already has
 *  the document statuses and receives live `indexing:progress` updates. */
export interface IndexBatchProgress {
  /** Total documents in the workspace. */
  total: number
  /** Documents fully indexed (status 'ready'). */
  ready: number
  /** Documents still queued or indexing ('pending' | 'indexing'). */
  active: number
  /** Documents whose indexing failed. */
  failed: number
  /** ready / total as a 0–100 integer percent; 0 when there are no documents. */
  percent: number
}

export function deriveIndexBatchProgress(
  docs: ReadonlyArray<Pick<Document, 'status'>>,
): IndexBatchProgress {
  let ready = 0
  let active = 0
  let failed = 0
  for (const { status } of docs) {
    if (status === 'ready') ready++
    else if (status === 'failed') failed++
    else if (status === 'pending' || status === 'indexing') active++
  }
  const total = docs.length
  const percent = total === 0 ? 0 : Math.round((ready / total) * 100)
  return { total, ready, active, failed, percent }
}

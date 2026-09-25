import type { Document, IndexProgress } from './documents'

/** Aggregate finished documents and live chunk progress. A single large file
 *  advances the bar during embedding, with 100% reserved for durable writes. */
export interface IndexBatchProgress {
  /** Total documents in the workspace. */
  total: number
  /** Documents fully indexed (status 'ready'). */
  ready: number
  /** Documents still queued or indexing ('pending' | 'indexing'). */
  active: number
  /** Documents whose indexing failed. */
  failed: number
  /** Finished documents plus partial chunk progress, as a 0–100 percent. */
  percent: number
}

export function deriveIndexBatchProgress(
  docs: ReadonlyArray<Pick<Document, 'status'> & { id?: number }>,
  progress?: ReadonlyMap<number, IndexProgress>,
): IndexBatchProgress {
  let ready = 0
  let active = 0
  let failed = 0
  let partial = 0
  for (const { id, status } of docs) {
    if (status === 'ready') ready++
    else if (status === 'failed') failed++
    else if (status === 'pending' || status === 'indexing') {
      active++
      const p = id == null ? undefined : progress?.get(id)
      if (p?.phase === 'done') partial += 1
      else if (p?.phase === 'embedding' && p.chunksTotal && p.chunksTotal > 0)
        partial += Math.max(0, Math.min(0.99, (p.chunksDone ?? 0) / p.chunksTotal))
      else if (p?.phase === 'persisting') partial += 0.99
    }
  }
  const total = docs.length
  const percent =
    total === 0 ? 0 : Math.min(active > 0 ? 99 : 100, Math.round(((ready + partial) / total) * 100))
  return { total, ready, active, failed, percent }
}

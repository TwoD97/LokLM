import { describe, it, expect } from 'vitest'
import { deriveIndexBatchProgress } from './indexProgress'
import type { IndexProgress } from './documents'

const docs = (
  ...statuses: Array<'pending' | 'indexing' | 'ready' | 'failed'>
): Array<{ status: 'pending' | 'indexing' | 'ready' | 'failed' }> =>
  statuses.map((status) => ({ status }))

describe('deriveIndexBatchProgress', () => {
  it('shows progress within a single document and waits for persistence before 100%', () => {
    const docs = [{ id: 1, status: 'indexing' as const }]
    const p: IndexProgress = {
      workspaceId: 1,
      documentId: 1,
      title: 'Test',
      phase: 'embedding',
      step: 3,
      total: 4,
      chunksDone: 10,
      chunksTotal: 20,
    }
    expect(deriveIndexBatchProgress(docs, new Map([[1, p]])).percent).toBe(50)
    expect(deriveIndexBatchProgress(docs, new Map([[1, { ...p, chunksDone: 20 }]])).percent).toBe(
      99,
    )
    expect(deriveIndexBatchProgress(docs, new Map([[1, { ...p, phase: 'failed' }]])).percent).toBe(
      0,
    )
  })
  it('returns all-zero progress for an empty workspace', () => {
    expect(deriveIndexBatchProgress([])).toEqual({
      total: 0,
      ready: 0,
      active: 0,
      failed: 0,
      percent: 0,
    })
  })

  it('counts ready, active (pending + indexing) and failed documents', () => {
    const p = deriveIndexBatchProgress(docs('ready', 'ready', 'pending', 'indexing', 'failed'))
    expect(p.total).toBe(5)
    expect(p.ready).toBe(2)
    expect(p.active).toBe(2)
    expect(p.failed).toBe(1)
  })

  it('reports percent as ready/total rounded to a whole number', () => {
    // 12 ready of 33 → 36.36 % → 36
    const statuses = [...Array(12).fill('ready'), ...Array(21).fill('indexing')] as Array<
      'ready' | 'indexing'
    >
    expect(deriveIndexBatchProgress(docs(...statuses)).percent).toBe(36)
  })

  it('is 100 % when every document is ready', () => {
    const p = deriveIndexBatchProgress(docs('ready', 'ready', 'ready'))
    expect(p.percent).toBe(100)
    expect(p.active).toBe(0)
  })

  it('bases percent on ready only — failed documents do not count as indexed', () => {
    // 1 ready, 1 failed → 50 %
    expect(deriveIndexBatchProgress(docs('ready', 'failed')).percent).toBe(50)
  })
})

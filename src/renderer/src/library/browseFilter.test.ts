import { describe, it, expect } from 'vitest'
import type { Document, IndexProgress } from '@shared/documents'
import { filterBrowseDocs, sortBrowseDocs } from './browseFilter'
import type { LibrarySearchFilters } from './useLibrarySearch'

function doc(overrides: Partial<Document> = {}): Document {
  return {
    id: 1,
    workspaceId: 1,
    title: 'Doc',
    sourcePath: '/d/doc.txt',
    mimeType: null,
    byteSize: null,
    status: 'ready',
    chunkCount: 1,
    tokenCount: 1,
    addedAt: 1000,
    pinned: false,
    ...overrides,
  }
}

const NOW = 1_000_000

function filters(overrides: Partial<LibrarySearchFilters> = {}): LibrarySearchFilters {
  return {
    types: new Set(),
    date: 'any',
    size: 'any',
    status: 'all',
    ...overrides,
  }
}

const ids = (docs: Document[]): number[] => docs.map((d) => d.id)

describe('filterBrowseDocs', () => {
  it('passes everything through when no filter is active', () => {
    const docs = [doc({ id: 1 }), doc({ id: 2 }), doc({ id: 3 })]
    expect(ids(filterBrowseDocs(docs, filters(), new Map(), new Set(), NOW))).toEqual([1, 2, 3])
  })

  it('narrows by document type bucket (extension-classified)', () => {
    const docs = [
      doc({ id: 1, sourcePath: '/a/report.pdf' }),
      doc({ id: 2, sourcePath: '/a/notes.md' }),
      doc({ id: 3, sourcePath: '/a/main.ts' }),
      doc({ id: 4, sourcePath: '/a/readme.txt' }),
    ]
    const f = filters({ types: new Set(['pdf', 'code']) })
    expect(ids(filterBrowseDocs(docs, f, new Map(), new Set(), NOW))).toEqual([1, 3])
  })

  it('excludes documents added before the date window', () => {
    const docs = [
      doc({ id: 1, addedAt: NOW - 3 * 86_400 }), // 3 days ago — within 7d
      doc({ id: 2, addedAt: NOW - 20 * 86_400 }), // 20 days ago — outside 7d
    ]
    const f = filters({ date: '7d' })
    expect(ids(filterBrowseDocs(docs, f, new Map(), new Set(), NOW))).toEqual([1])
  })

  it('applies inclusive byte-size bounds and drops null-sized docs once sized', () => {
    const docs = [
      doc({ id: 1, byteSize: 500_000 }), // < 1 MB
      doc({ id: 2, byteSize: 5_000_000 }), // 1–10 MB
      doc({ id: 3, byteSize: null }), // unknown size
    ]
    expect(
      ids(filterBrowseDocs(docs, filters({ size: 'small' }), new Map(), new Set(), NOW)),
    ).toEqual([1])
    expect(
      ids(filterBrowseDocs(docs, filters({ size: 'medium' }), new Map(), new Set(), NOW)),
    ).toEqual([2])
    // null byte_size is dropped the moment any size bound is set (SQL parity).
    expect(
      ids(filterBrowseDocs(docs, filters({ size: 'large' }), new Map(), new Set(), NOW)),
    ).toEqual([])
  })

  it('filters by status, collapsing every in-flight state into "indexing"', () => {
    const docs = [
      doc({ id: 1, status: 'ready' }),
      doc({ id: 2, status: 'indexing' }),
      doc({ id: 3, status: 'pending' }),
      doc({ id: 4, status: 'failed' }),
    ]
    const indexing = filterBrowseDocs(
      docs,
      filters({ status: 'indexing' }),
      new Map(),
      new Set(),
      NOW,
    )
    expect(ids(indexing)).toEqual([2, 3])
    const ready = filterBrowseDocs(docs, filters({ status: 'ready' }), new Map(), new Set(), NOW)
    expect(ids(ready)).toEqual([1])
    const failed = filterBrowseDocs(docs, filters({ status: 'failed' }), new Map(), new Set(), NOW)
    expect(ids(failed)).toEqual([4])
  })

  it('treats live progress and re-embedding as "indexing" for the status filter', () => {
    const docs = [
      doc({ id: 1, status: 'ready' }), // mid re-embed
      doc({ id: 2, status: 'ready' }), // genuinely ready
      doc({ id: 3, status: 'ready' }), // ready row but actively indexing per progress
    ]
    const progress = new Map<number, IndexProgress>([
      [3, { documentId: 3, title: 'Doc', phase: 'embedding', step: 1, total: 4 }],
    ])
    const reembed = new Set([1])
    const indexing = filterBrowseDocs(docs, filters({ status: 'indexing' }), progress, reembed, NOW)
    expect(ids(indexing)).toEqual([1, 3])
  })
})

describe('sortBrowseDocs', () => {
  const docs = [
    doc({ id: 1, title: 'Banana', addedAt: 30 }),
    doc({ id: 2, title: 'apple', addedAt: 10 }),
    doc({ id: 3, title: 'cherry', addedAt: 20 }),
  ]

  it('sorts by filename case-insensitively', () => {
    expect(ids(sortBrowseDocs(docs, 'filename'))).toEqual([2, 1, 3])
  })

  it('sorts by added date, newest first', () => {
    expect(ids(sortBrowseDocs(docs, 'added'))).toEqual([1, 3, 2])
  })

  it('leaves natural order untouched for relevance (returns the same array)', () => {
    const out = sortBrowseDocs(docs, 'relevance')
    expect(out).toBe(docs)
  })
})

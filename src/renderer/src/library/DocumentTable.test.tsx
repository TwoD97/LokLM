import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Document } from '@shared/documents'
import { DocumentTable } from './DocumentTable'

// Each page legitimately mounts up to PAGE_SIZE (100) DocumentRows; under the
// full suite's parallel jsdom load that render can blow past the 5s default, so
// give these row-heavy cases headroom (they finish in ~2s uncontended).
vi.setConfig({ testTimeout: 20000 })

function makeDocs(n: number, idBase = 0): Document[] {
  return Array.from({ length: n }, (_, i) => ({
    id: idBase + i + 1,
    workspaceId: 1,
    title: `Doc ${idBase + i + 1}`,
    sourcePath: `/d/${idBase + i + 1}`,
    mimeType: null,
    byteSize: null,
    status: 'ready' as const,
    chunkCount: 1,
    tokenCount: 1,
    addedAt: 0,
    pinned: false,
  }))
}

const handlers = {
  onDelete: vi.fn(),
  onReindex: vi.fn(),
  onReveal: vi.fn(),
  onOpenExternal: vi.fn(),
  onReplace: vi.fn(),
  onRefresh: vi.fn(),
  onRead: vi.fn(),
  onExport: vi.fn(),
  onSummarize: vi.fn(),
  onTogglePin: vi.fn(),
}

// header <tr> counts as a row, so subtract it to get the document-row count.
const visibleRows = (): number => screen.getAllByRole('row').length - 1
const nextBtn = (): HTMLElement => screen.getByRole('button', { name: /next/i })
const prevBtn = (): HTMLElement => screen.getByRole('button', { name: /previous/i })

describe('DocumentTable pagination', () => {
  it('caps the page at PAGE_SIZE (100) rows and pages through the rest', () => {
    render(<DocumentTable docs={makeDocs(250)} resetKey={1} progress={new Map()} {...handlers} />)
    // Page 1: 100 rows, Doc 1 present, Doc 101 not yet.
    expect(visibleRows()).toBe(100)
    expect(screen.getByText('Doc 1')).toBeTruthy()
    expect(screen.queryByText('Doc 101')).toBeNull()
    expect(prevBtn()).toBeDisabled()

    fireEvent.click(nextBtn())
    // Page 2: next 100 rows.
    expect(visibleRows()).toBe(100)
    expect(screen.queryByText('Doc 1')).toBeNull()
    expect(screen.getByText('Doc 101')).toBeTruthy()
    expect(prevBtn()).not.toBeDisabled()

    fireEvent.click(nextBtn())
    // Page 3: the 50-doc remainder, Next now disabled (last page).
    expect(visibleRows()).toBe(50)
    expect(screen.getByText('Doc 250')).toBeTruthy()
    expect(nextBtn()).toBeDisabled()
  })

  it('hides the pager when everything fits on one page', () => {
    render(<DocumentTable docs={makeDocs(40)} resetKey={1} progress={new Map()} {...handlers} />)
    expect(visibleRows()).toBe(40)
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
  })

  it('keeps the current page when the same workspace refreshes (new array, same resetKey)', () => {
    const { rerender } = render(
      <DocumentTable docs={makeDocs(250)} resetKey={1} progress={new Map()} {...handlers} />,
    )
    fireEvent.click(nextBtn())
    expect(screen.getByText('Doc 101')).toBeTruthy()

    // A background refresh (index 'done', sync, etc.) hands down a brand-new
    // array with identical contents for the SAME workspace. The pager must not
    // yank the user back to page 1.
    rerender(<DocumentTable docs={makeDocs(250)} resetKey={1} progress={new Map()} {...handlers} />)
    expect(screen.getByText('Doc 101')).toBeTruthy()
  })

  it('jumps back to page 1 on workspace switch (resetKey change)', () => {
    const { rerender } = render(
      <DocumentTable docs={makeDocs(250)} resetKey={1} progress={new Map()} {...handlers} />,
    )
    fireEvent.click(nextBtn())
    expect(screen.getByText('Doc 101')).toBeTruthy()

    rerender(
      <DocumentTable docs={makeDocs(250, 1000)} resetKey={2} progress={new Map()} {...handlers} />,
    )
    expect(screen.getByText('Doc 1001')).toBeTruthy()
    expect(prevBtn()).toBeDisabled()
  })
})

function makeDoc(id: number, status: Document['status']): Document {
  return {
    id,
    workspaceId: 1,
    title: `Doc ${id}`,
    sourcePath: `/d/${id}`,
    mimeType: null,
    byteSize: null,
    status,
    chunkCount: 1,
    tokenCount: 1,
    addedAt: 0,
    pinned: false,
  }
}

// Title text of the data rows, top to bottom (header row dropped).
const rowTitles = (): string[] =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.querySelector('.library__row-title')?.textContent ?? '')

describe('DocumentTable in-progress sort', () => {
  it('floats indexing / pending rows above ready ones, original order within groups', () => {
    const docs = [
      makeDoc(1, 'ready'),
      makeDoc(2, 'indexing'),
      makeDoc(3, 'ready'),
      makeDoc(4, 'pending'),
    ]
    render(<DocumentTable docs={docs} resetKey={1} progress={new Map()} {...handlers} />)
    // In-progress (2 indexing, 4 pending) lead, in their original order; the
    // ready ones (1, 3) follow in their original order.
    expect(rowTitles()).toEqual(['Doc 2', 'Doc 4', 'Doc 1', 'Doc 3'])
  })

  it('keeps failed rows in the body (only in-progress rows float up)', () => {
    const docs = [makeDoc(1, 'ready'), makeDoc(2, 'failed'), makeDoc(3, 'indexing')]
    render(<DocumentTable docs={docs} resetKey={1} progress={new Map()} {...handlers} />)
    // Only the indexing row floats; failed stays put alongside ready.
    expect(rowTitles()).toEqual(['Doc 3', 'Doc 1', 'Doc 2'])
  })
})

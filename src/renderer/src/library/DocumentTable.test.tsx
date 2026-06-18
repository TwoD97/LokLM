import { render, screen, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Document } from '@shared/documents'
import { DocumentTable } from './DocumentTable'

// jsdom has no IntersectionObserver. Capture the active callback(s) so a test
// can simulate the bottom sentinel scrolling into view and growing the window.
let ioCallbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void>
beforeEach(() => {
  ioCallbacks = []
  class MockIO {
    private cb: (entries: Array<{ isIntersecting: boolean }>) => void
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
      this.cb = cb
      ioCallbacks.push(cb)
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      ioCallbacks = ioCallbacks.filter((c) => c !== this.cb)
    }
    takeRecords(): [] {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', MockIO)
})

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

// header <tr> counts as a row; the sentinel <tr> is aria-hidden so it doesn't.
const visibleRows = (): number => screen.getAllByRole('row').length - 1
const loadMore = (): void => {
  act(() => {
    ioCallbacks.forEach((cb) => cb([{ isIntersecting: true }]))
  })
}

describe('DocumentTable infinite scroll', () => {
  it('keeps the expanded window when the same workspace refreshes (new array, same resetKey)', () => {
    const { rerender } = render(
      <DocumentTable docs={makeDocs(200)} resetKey={1} progress={new Map()} {...handlers} />,
    )
    expect(visibleRows()).toBe(80)
    loadMore()
    expect(visibleRows()).toBe(160)

    // A background refresh (index 'done', sync, etc.) hands down a brand-new
    // array with identical contents for the SAME workspace. The window must
    // not collapse back to 80 out from under the user's scroll position.
    rerender(<DocumentTable docs={makeDocs(200)} resetKey={1} progress={new Map()} {...handlers} />)
    expect(visibleRows()).toBe(160)
  })

  it('resets the window to the initial batch on workspace switch (resetKey change)', () => {
    const { rerender } = render(
      <DocumentTable docs={makeDocs(200)} resetKey={1} progress={new Map()} {...handlers} />,
    )
    loadMore()
    expect(visibleRows()).toBe(160)

    rerender(
      <DocumentTable docs={makeDocs(150, 1000)} resetKey={2} progress={new Map()} {...handlers} />,
    )
    expect(visibleRows()).toBe(80)
  })
})

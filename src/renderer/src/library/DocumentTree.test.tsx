import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Document } from '@shared/documents'
import { DocumentTree } from './DocumentTree'
import { LibraryFileRow } from './LibraryFileRow'

const doc: Document = {
  id: 1,
  workspaceId: 1,
  title: 'Notes.md',
  sourcePath: '/research/Notes.md',
  mimeType: 'text/markdown',
  byteSize: 10,
  status: 'ready',
  chunkCount: 1,
  tokenCount: 1,
  addedAt: 0,
  pinned: false,
}
function actions() {
  return {
    onRead: vi.fn(),
    onDelete: vi.fn(),
    onReindex: vi.fn(),
    onReveal: vi.fn(),
    onOpenExternal: vi.fn(),
    onReplace: vi.fn(),
    onRefresh: vi.fn(),
    onExport: vi.fn(),
    onSummarize: vi.fn(),
    onTogglePin: vi.fn(),
  }
}

describe('folder-style document access', () => {
  it('opens location folders with the keyboard and document titles with a single action', () => {
    const handlers = actions()
    render(
      <DocumentTree
        docs={[doc]}
        syncRoots={['/research']}
        resetKey={1}
        progress={new Map()}
        {...handlers}
      />,
    )
    const folder = screen.getByRole('treeitem', { expanded: true })
    expect(folder).toHaveAttribute('tabindex', '0')
    expect(folder).toHaveAttribute('aria-level', '1')
    fireEvent.keyDown(folder, { key: 'ArrowLeft' })
    expect(screen.queryByRole('button', { name: doc.title })).toBeNull()
    fireEvent.keyDown(folder, { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('button', { name: doc.title }))
    expect(handlers.onRead).toHaveBeenCalledExactlyOnceWith(doc)
    fireEvent.keyDown(folder, { key: ' ' })
    expect(folder).toHaveAttribute('aria-expanded', 'false')
  })

  it('provides the same named document button in custom folders', () => {
    const handlers = actions()
    render(<LibraryFileRow doc={doc} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: doc.title }))
    expect(handlers.onRead).toHaveBeenCalledExactlyOnceWith(doc)
  })
})

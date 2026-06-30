import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Document, Folder, FolderAssignment } from '@shared/documents'
import { FolderTree } from './FolderTree'
import { buildFolderTree } from './folderTreeModel'

function doc(id: number, title: string): Document {
  return {
    id,
    workspaceId: 1,
    title,
    sourcePath: `/x/${title}`,
    mimeType: null,
    byteSize: null,
    status: 'ready',
    chunkCount: 0,
    tokenCount: 0,
    addedAt: 0,
    pinned: false,
  }
}

/** A dataTransfer stub — RTL's synthetic drag events don't carry one, but the
 *  handlers touch setData / effectAllowed / dropEffect. */
function dt(): { dataTransfer: Record<string, unknown> } {
  return { dataTransfer: { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' } }
}

const NOOP = (): void => {}

function renderTree(
  folders: Folder[],
  assignments: FolderAssignment[],
  docs: Document[],
  onMoveDocument: (documentId: number, folderId: number | null) => void,
): void {
  const nodes = buildFolderTree(folders, assignments, docs)
  const expanded = new Set(folders.map((f) => `folder:${f.id}`))
  render(
    <FolderTree
      nodes={nodes}
      expanded={expanded}
      onToggleExpand={NOOP}
      onCreateFolder={NOOP}
      onRenameFolder={NOOP}
      onDeleteFolder={NOOP}
      onMoveDocument={onMoveDocument}
      compact
      renderFile={(d) => <span>{d.title}</span>}
    />,
  )
}

describe('FolderTree drag-and-drop targeting', () => {
  // The reported bug: a file living in the deepest folder could only ever land
  // back in that deepest child, never a parent. The drop target must be the
  // folder the file is dropped ON, regardless of where it came from.
  const folders: Folder[] = [
    { id: 1, parentId: null, name: 'A', createdAt: 0 },
    { id: 2, parentId: 1, name: 'B', createdAt: 0 },
    { id: 3, parentId: 2, name: 'C', createdAt: 0 },
  ]
  const file = doc(10, 'note.md')
  const assignments: FolderAssignment[] = [{ documentId: 10, folderId: 3 }] // deepest (C)

  function rowOf(name: string): HTMLElement {
    const el = screen.getByText(name).closest('.folder-tree__folder')
    if (!el) throw new Error(`no folder row for ${name}`)
    return el as HTMLElement
  }
  function fileRow(): HTMLElement {
    const el = screen.getByText('note.md').closest('.folder-tree__file')
    if (!el) throw new Error('no file row')
    return el as HTMLElement
  }

  it('drops the file into the GRANDPARENT (A) when dropped on A, not the deepest child', () => {
    const onMove = vi.fn()
    renderTree(folders, assignments, [file], onMove)

    fireEvent.dragStart(fileRow(), dt())
    fireEvent.dragOver(rowOf('A'), dt())
    fireEvent.drop(rowOf('A'), dt())

    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onMove).toHaveBeenCalledWith(10, 1)
  })

  it('drops the file into the immediate PARENT (B) when dropped on B', () => {
    const onMove = vi.fn()
    renderTree(folders, assignments, [file], onMove)

    fireEvent.dragStart(fileRow(), dt())
    fireEvent.dragOver(rowOf('B'), dt())
    fireEvent.drop(rowOf('B'), dt())

    expect(onMove).toHaveBeenCalledWith(10, 2)
  })
})

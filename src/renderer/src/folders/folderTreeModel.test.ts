import { describe, it, expect } from 'vitest'
import type { Document, Folder, FolderAssignment } from '@shared/documents'
import {
  buildFolderTree,
  flattenFolderTree,
  collectDescendantDocIds,
  topLevelFolderKeys,
  folderKey,
  type FolderNode,
  type FolderTreeNode,
} from './folderTreeModel'

function doc(id: number, title = `doc${id}`): Document {
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
const folder = (id: number, name: string, parentId: number | null = null): Folder => ({
  id,
  name,
  parentId,
  createdAt: 0,
})
const assign = (documentId: number, folderId: number): FolderAssignment => ({
  documentId,
  folderId,
})

function asFolder(n: FolderTreeNode): FolderNode {
  if (n.kind !== 'folder') throw new Error(`expected folder, got ${n.doc.title}`)
  return n
}
const names = (n: FolderNode): string[] =>
  n.children.map((c) => (c.kind === 'folder' ? `${c.name}/` : c.doc.title))

describe('buildFolderTree', () => {
  it('nests subfolders and places assigned documents', () => {
    const folders = [folder(1, 'Notes'), folder(2, 'Sub', 1)]
    const assignments = [assign(10, 1), assign(11, 2)]
    const docs = [doc(10, 'a'), doc(11, 'b'), doc(12, 'unfiled')]

    const tree = buildFolderTree(folders, assignments, docs)

    // Root: Notes folder (folders first) then the unfiled doc.
    expect(tree.map((n) => (n.kind === 'folder' ? `${n.name}/` : n.doc.title))).toEqual([
      'Notes/',
      'unfiled',
    ])
    const notes = asFolder(tree[0]!)
    expect(notes.fileCount).toBe(2) // a + b (b is in the subfolder)
    expect(names(notes)).toEqual(['Sub/', 'a']) // subfolder before file
    const sub = asFolder(notes.children[0]!)
    expect(names(sub)).toEqual(['b'])
  })

  it('treats a document assigned to a missing folder as unfiled', () => {
    const tree = buildFolderTree([folder(1, 'F')], [assign(10, 999)], [doc(10, 'orphan')])
    // No file inside F; the doc surfaces at root.
    expect(asFolder(tree[0]!).fileCount).toBe(0)
    expect(tree.some((n) => n.kind === 'file' && n.doc.id === 10)).toBe(true)
  })

  it('treats a folder with a dangling parent as a root', () => {
    const tree = buildFolderTree([folder(2, 'Lost', 404)], [], [])
    expect(tree).toHaveLength(1)
    expect(asFolder(tree[0]!).name).toBe('Lost')
  })

  it('sorts folders before files, alphabetically, at every level', () => {
    const folders = [folder(1, 'Zeta'), folder(2, 'Alpha')]
    const docs = [doc(10, 'zzz'), doc(11, 'aaa')]
    const tree = buildFolderTree(folders, [], docs)
    expect(tree.map((n) => (n.kind === 'folder' ? n.name : n.doc.title))).toEqual([
      'Alpha',
      'Zeta',
      'aaa',
      'zzz',
    ])
  })
})

describe('flattenFolderTree', () => {
  const folders = [folder(1, 'Notes'), folder(2, 'Sub', 1)]
  const tree = buildFolderTree(folders, [assign(11, 2)], [doc(11, 'b')])

  it('shows only roots when nothing is expanded', () => {
    const rows = flattenFolderTree(tree, new Set())
    expect(rows).toHaveLength(1)
    expect(rows[0]!.depth).toBe(0)
  })

  it('reveals nested children with increasing depth when expanded', () => {
    const expanded = new Set([folderKey(1), folderKey(2)])
    const rows = flattenFolderTree(tree, expanded)
    expect(rows.map((r) => [r.depth, r.node.kind])).toEqual([
      [0, 'folder'], // Notes
      [1, 'folder'], // Sub
      [2, 'file'], // b
    ])
  })

  it('topLevelFolderKeys returns each root folder key', () => {
    expect(topLevelFolderKeys(tree)).toEqual([folderKey(1)])
  })
})

describe('collectDescendantDocIds', () => {
  const folders = [folder(1, 'A'), folder(2, 'B', 1), folder(3, 'C', 2), folder(4, 'D')]
  const assignments = [assign(10, 1), assign(11, 2), assign(12, 3), assign(20, 4)]

  it('includes documents in the folder and every nested subfolder', () => {
    expect(collectDescendantDocIds(1, folders, assignments).sort()).toEqual([10, 11, 12])
  })

  it('does not include documents from sibling subtrees', () => {
    expect(collectDescendantDocIds(4, folders, assignments)).toEqual([20])
  })

  it('returns an empty array for an empty folder', () => {
    expect(collectDescendantDocIds(99, folders, assignments)).toEqual([])
  })

  it('is cycle-safe if the parent chain is malformed', () => {
    // 1 → 2 → 1 cycle; must terminate.
    const cyclic = [folder(1, 'A', 2), folder(2, 'B', 1)]
    const result = collectDescendantDocIds(1, cyclic, [assign(10, 1), assign(11, 2)])
    expect(result.sort()).toEqual([10, 11])
  })
})

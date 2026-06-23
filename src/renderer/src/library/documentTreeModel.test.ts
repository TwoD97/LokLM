import { describe, it, expect } from 'vitest'
import type { Document } from '@shared/documents'
import {
  buildDocumentTree,
  flattenTree,
  topLevelFolderKeys,
  OTHER_FILES_KEY,
  type FolderNode,
  type TreeNode,
} from './documentTreeModel'

// Minimal Document factory — only the fields the tree reads (id, title,
// sourcePath) matter; the rest are filled to satisfy the type.
function doc(id: number, sourcePath: string, title = sourcePath.split(/[/\\]/).pop()!): Document {
  return {
    id,
    workspaceId: 1,
    title,
    sourcePath,
    mimeType: null,
    byteSize: null,
    status: 'ready',
    chunkCount: 0,
    tokenCount: 0,
    addedAt: 0,
    pinned: false,
  }
}

function asFolder(n: TreeNode): FolderNode {
  if (n.kind !== 'folder') throw new Error(`expected folder, got file ${n.doc.title}`)
  return n
}

function childNames(n: FolderNode): string[] {
  return n.children.map((c) => (c.kind === 'folder' ? `${c.name}/` : c.doc.title))
}

describe('buildDocumentTree', () => {
  it('nests files under a synced root by their relative path', () => {
    const docs = [
      doc(1, 'C:\\proj\\src\\components\\Button.tsx'),
      doc(2, 'C:\\proj\\src\\index.ts'),
      doc(3, 'C:\\proj\\README.md'),
    ]
    const tree = buildDocumentTree(docs, ['C:\\proj'])

    expect(tree).toHaveLength(1)
    const root = asFolder(tree[0]!)
    expect(root.name).toBe('proj')
    expect(root.fullPath).toBe('C:\\proj')
    expect(root.fileCount).toBe(3)

    // Folders sort before files: src/ then README.md.
    expect(childNames(root)).toEqual(['src/', 'README.md'])
    const src = asFolder(root.children[0]!)
    expect(childNames(src)).toEqual(['components/', 'index.ts'])
    const components = asFolder(src.children[0]!)
    expect(components.children).toHaveLength(1)
    expect(components.children[0]!.kind).toBe('file')
  })

  it('attaches files to the deepest (longest) matching root when roots nest', () => {
    const docs = [doc(1, 'C:\\proj\\sub\\a.ts'), doc(2, 'C:\\proj\\top.ts')]
    const tree = buildDocumentTree(docs, ['C:\\proj', 'C:\\proj\\sub'])

    const byPath = new Map(tree.map((n) => [asFolder(n).fullPath, asFolder(n)]))
    const sub = byPath.get('C:\\proj\\sub')!
    const top = byPath.get('C:\\proj')!
    // a.ts lives directly under the nested root, not double-nested under proj.
    expect(childNames(sub)).toEqual(['a.ts'])
    expect(childNames(top)).toEqual(['top.ts'])
  })

  it('buckets files outside every root into a flat "Other files" group', () => {
    const docs = [
      doc(1, 'C:\\proj\\src\\a.ts'),
      doc(2, 'C:\\Users\\me\\Downloads\\paper.pdf'),
      doc(3, 'D:\\scratch\\notes.md'),
    ]
    const tree = buildDocumentTree(docs, ['C:\\proj'])

    expect(tree).toHaveLength(2)
    const other = asFolder(tree[1]!)
    expect(other.key).toBe(OTHER_FILES_KEY)
    expect(other.fullPath).toBeNull()
    expect(other.fileCount).toBe(2)
    // Flat — no nested folders rebuilt from the absolute paths.
    expect(other.children.every((c) => c.kind === 'file')).toBe(true)
    expect(childNames(other).sort()).toEqual(['notes.md', 'paper.pdf'])
  })

  it('renders loose files flat at top level when there are no synced roots', () => {
    const docs = [doc(1, 'C:\\a\\x.md'), doc(2, 'C:\\b\\y.md')]
    const tree = buildDocumentTree(docs, [])
    expect(tree.every((n) => n.kind === 'file')).toBe(true)
    expect(tree).toHaveLength(2)
  })

  it('matches roots case-insensitively (Windows drive/path casing)', () => {
    const docs = [doc(1, 'c:\\Proj\\src\\a.ts')]
    const tree = buildDocumentTree(docs, ['C:\\proj'])
    expect(tree).toHaveLength(1)
    expect(asFolder(tree[0]!).fileCount).toBe(1)
  })

  it('handles POSIX paths and forward slashes', () => {
    const docs = [doc(1, '/home/me/proj/src/a.ts'), doc(2, '/home/me/proj/b.ts')]
    const tree = buildDocumentTree(docs, ['/home/me/proj'])
    const root = asFolder(tree[0]!)
    expect(root.name).toBe('proj')
    expect(childNames(root)).toEqual(['src/', 'b.ts'])
  })

  it('keeps multiple roots in the order they were supplied', () => {
    const docs = [doc(1, 'C:\\beta\\a.ts'), doc(2, 'C:\\alpha\\b.ts')]
    const tree = buildDocumentTree(docs, ['C:\\beta', 'C:\\alpha'])
    expect(tree.map((n) => asFolder(n).name)).toEqual(['beta', 'alpha'])
  })
})

describe('flattenTree', () => {
  const docs = [doc(1, 'C:\\proj\\src\\a.ts'), doc(2, 'C:\\proj\\b.ts')]
  const tree = buildDocumentTree(docs, ['C:\\proj'])

  it('shows only the roots when nothing is expanded', () => {
    const rows = flattenTree(tree, new Set())
    expect(rows).toHaveLength(1)
    expect(rows[0]!.depth).toBe(0)
    expect(asFolder(rows[0]!.node).name).toBe('proj')
  })

  it('reveals children of expanded folders with increasing depth', () => {
    const expanded = new Set(['root:C:\\proj', 'root:C:\\proj/src'])
    const rows = flattenTree(tree, expanded)
    // proj(0) > src(1) > a.ts(2), and b.ts(1)
    const shape = rows.map((r) => [r.depth, r.node.kind])
    expect(shape).toEqual([
      [0, 'folder'],
      [1, 'folder'],
      [2, 'file'],
      [1, 'file'],
    ])
  })

  it('topLevelFolderKeys returns every top-level group key', () => {
    expect(topLevelFolderKeys(tree)).toEqual(['root:C:\\proj'])
  })
})

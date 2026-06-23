// Pure construction of the user-created folder tree from the DB rows. Folders
// (id + parentId) form the hierarchy; document→folder assignments place each
// file; documents with no assignment are "unfiled" and render at the root.
// The React layer (FolderTree.tsx) only renders what this returns.
import type { Document, Folder, FolderAssignment } from '@shared/documents'

export interface FolderNode {
  kind: 'folder'
  /** Stable key for expansion state: `folder:${id}`. */
  key: string
  folderId: number
  name: string
  parentId: number | null
  children: FolderTreeNode[]
  /** Files in this subtree (recursive) — drives the count badge. */
  fileCount: number
}

export interface FileNode {
  kind: 'file'
  /** `doc:${id}` — a document appears once (it lives in one folder, or unfiled). */
  key: string
  doc: Document
}

export type FolderTreeNode = FolderNode | FileNode

export const folderKey = (id: number): string => `folder:${id}`

/** Folders before files, each alphabetical (locale-aware, case-insensitive). */
function compareNodes(a: FolderTreeNode, b: FolderTreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  const an = a.kind === 'folder' ? a.name : a.doc.title
  const bn = b.kind === 'folder' ? b.name : b.doc.title
  return an.localeCompare(bn, undefined, { sensitivity: 'base', numeric: true })
}

function sortRec(nodes: FolderTreeNode[]): void {
  nodes.sort(compareNodes)
  for (const n of nodes) if (n.kind === 'folder') sortRec(n.children)
}

function countFiles(node: FolderNode): number {
  let n = 0
  for (const c of node.children) n += c.kind === 'file' ? 1 : countFiles(c)
  node.fileCount = n
  return n
}

/**
 * Build the folder tree. Returns top-level nodes: root folders (parentId null)
 * plus unfiled documents, folders-first and alphabetical at every level. A
 * document whose assigned folder no longer exists is treated as unfiled
 * (defensive — the DB cascade normally prevents this).
 */
export function buildFolderTree(
  folders: readonly Folder[],
  assignments: readonly FolderAssignment[],
  docs: readonly Document[],
): FolderTreeNode[] {
  const nodeById = new Map<number, FolderNode>()
  for (const f of folders) {
    nodeById.set(f.id, {
      kind: 'folder',
      key: folderKey(f.id),
      folderId: f.id,
      name: f.name,
      parentId: f.parentId,
      children: [],
      fileCount: 0,
    })
  }

  // Wire folders to parents; a missing/dangling parent makes it a root.
  const roots: FolderTreeNode[] = []
  for (const node of nodeById.values()) {
    const parent = node.parentId != null ? nodeById.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  // Place documents under their assigned folder, else unfiled at the root.
  const folderByDoc = new Map<number, number>()
  for (const a of assignments) folderByDoc.set(a.documentId, a.folderId)
  for (const doc of docs) {
    const fid = folderByDoc.get(doc.id)
    const target = fid != null ? nodeById.get(fid) : undefined
    const fileNode: FileNode = { kind: 'file', key: `doc:${doc.id}`, doc }
    if (target) target.children.push(fileNode)
    else roots.push(fileNode)
  }

  for (const n of roots) if (n.kind === 'folder') countFiles(n)
  sortRec(roots)
  return roots
}

export interface FlatRow {
  node: FolderTreeNode
  depth: number
}

/** Flatten to the currently-visible rows (expanded folders only). */
export function flattenFolderTree(
  nodes: readonly FolderTreeNode[],
  expanded: ReadonlySet<string>,
): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (list: readonly FolderTreeNode[], depth: number): void => {
    for (const n of list) {
      out.push({ node: n, depth })
      if (n.kind === 'folder' && expanded.has(n.key)) walk(n.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return out
}

/**
 * All document ids inside a folder, including every nested subfolder — the set
 * that toggling a folder into chat scope adds/removes. Cycle-guarded so a
 * malformed parent chain can't loop.
 */
export function collectDescendantDocIds(
  folderId: number,
  folders: readonly Folder[],
  assignments: readonly FolderAssignment[],
): number[] {
  const childrenByParent = new Map<number, number[]>()
  for (const f of folders) {
    if (f.parentId == null) continue
    const arr = childrenByParent.get(f.parentId)
    if (arr) arr.push(f.id)
    else childrenByParent.set(f.parentId, [f.id])
  }

  const inScope = new Set<number>()
  const queue = [folderId]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (inScope.has(id)) continue
    inScope.add(id)
    for (const child of childrenByParent.get(id) ?? []) queue.push(child)
  }

  const docIds = new Set<number>()
  for (const a of assignments) if (inScope.has(a.folderId)) docIds.add(a.documentId)
  return [...docIds]
}

/** Keys of the top-level folder groups — the default-expanded set. */
export function topLevelFolderKeys(nodes: readonly FolderTreeNode[]): string[] {
  return nodes.filter((n): n is FolderNode => n.kind === 'folder').map((n) => n.key)
}

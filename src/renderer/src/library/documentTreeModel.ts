// Pure folder-tree construction from the flat document list. Files already carry
// their absolute `sourcePath` (see src/shared/documents.ts), and synced folders
// are known (workspaces.listSyncFolders), so the whole hierarchy is derivable
// client-side with no schema/IPC change. This module owns the path math; the
// React layer (DocumentTree.tsx) only renders the result.
//
// Grouping rule (per product decision):
//   - Each synced-folder root becomes a top-level group; files under it nest by
//     their path segments relative to that root.
//   - Files not under any root ("loose" / manually-imported one-offs) go flat
//     into a single "Other files" bucket rather than rebuilding their full
//     absolute path, which would produce ugly single-chain system folders.
import type { Document } from '@shared/documents'

export interface FolderNode {
  kind: 'folder'
  /** Stable identity for expansion state. Unique within one tree. */
  key: string
  /** Display label (folder basename, root basename, or the "Other" sentinel). */
  name: string
  /** Absolute path for real folders; null for the synthetic "Other files"
   *  bucket. The renderer keys its translated label off `fullPath === null`. */
  fullPath: string | null
  children: TreeNode[]
  /** Files in this subtree — drives the count badge on the folder row. */
  fileCount: number
}

export interface FileNode {
  kind: 'file'
  key: string
  doc: Document
}

export type TreeNode = FolderNode | FileNode

/** Key of the synthetic bucket holding files outside every synced root. */
export const OTHER_FILES_KEY = '__other__'

/** Split an absolute path into segments, tolerating either separator and
 *  collapsing runs. Drive letters survive as their own segment (`C:`). */
function segments(p: string): string[] {
  return p.split(/[/\\]+/).filter((s) => s.length > 0)
}

/** Windows + macOS default filesystems are case-insensitive; comparing root
 *  prefixes case-insensitively avoids a synced folder failing to match its own
 *  files because the OS handed back a differently-cased drive letter or path. */
function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** True when `docSegs` lives strictly below `rootSegs` (so there's at least a
 *  filename segment left over to hang on the tree). */
function isUnder(docSegs: string[], rootSegs: string[]): boolean {
  if (docSegs.length <= rootSegs.length) return false
  for (let i = 0; i < rootSegs.length; i++) {
    if (!eq(docSegs[i]!, rootSegs[i]!)) return false
  }
  return true
}

function fileNode(doc: Document): FileNode {
  return { kind: 'file', key: `doc:${doc.id}`, doc }
}

/** Walk `rel` (segments below a root, filename last), materialising folder
 *  nodes as needed, then drop the file at the deepest level. */
function insertFile(root: FolderNode, rel: string[], doc: Document): void {
  let cur = root
  for (let i = 0; i < rel.length - 1; i++) {
    const seg = rel[i]!
    let child = cur.children.find((c): c is FolderNode => c.kind === 'folder' && c.name === seg)
    if (!child) {
      child = {
        kind: 'folder',
        key: `${cur.key}/${seg}`,
        name: seg,
        fullPath: cur.fullPath === null ? null : `${cur.fullPath}/${seg}`,
        children: [],
        fileCount: 0,
      }
      cur.children.push(child)
    }
    cur = child
  }
  cur.children.push(fileNode(doc))
}

/** Folders before files, each alphabetical (locale-aware, case-insensitive). */
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  const an = a.kind === 'folder' ? a.name : a.doc.title
  const bn = b.kind === 'folder' ? b.name : b.doc.title
  return an.localeCompare(bn, undefined, { sensitivity: 'base', numeric: true })
}

/** Order each folder's children (folders-first, alphabetical) recursively. The
 *  top-level group order is set deliberately by the caller (roots in supplied
 *  order, then "Other files") and must NOT be alphabetised, so this only
 *  touches children — never the array it's handed. */
function sortChildren(node: FolderNode): void {
  node.children.sort(compareNodes)
  for (const c of node.children) if (c.kind === 'folder') sortChildren(c)
}

/** Sum leaf files per folder, bottom-up. */
function countFiles(node: FolderNode): number {
  let n = 0
  for (const c of node.children) n += c.kind === 'file' ? 1 : countFiles(c)
  node.fileCount = n
  return n
}

/**
 * Build the display tree from the workspace's documents and its synced-folder
 * roots. Output ordering: one group per root in the order `roots` was given,
 * then the "Other files" bucket (when any loose files exist). If there are no
 * roots at all, loose files render flat at top level (no redundant wrapper).
 */
export function buildDocumentTree(docs: readonly Document[], roots: readonly string[]): TreeNode[] {
  // Longest root first so a file under a nested root attaches to the deepest
  // matching one (roots can be nested: C:\proj and C:\proj\sub).
  const rootDefs = roots
    .map((raw) => {
      const segs = segments(raw)
      return { raw, segs, name: segs[segs.length - 1] ?? raw }
    })
    .sort((a, b) => b.segs.length - a.segs.length)

  const groupByRoot = new Map<string, FolderNode>()
  const loose: FileNode[] = []

  for (const doc of docs) {
    const ds = segments(doc.sourcePath)
    const def = rootDefs.find((rd) => isUnder(ds, rd.segs))
    if (!def) {
      loose.push(fileNode(doc))
      continue
    }
    let group = groupByRoot.get(def.raw)
    if (!group) {
      group = {
        kind: 'folder',
        key: `root:${def.raw}`,
        name: def.name,
        fullPath: def.raw,
        children: [],
        fileCount: 0,
      }
      groupByRoot.set(def.raw, group)
    }
    insertFile(group, ds.slice(def.segs.length), doc)
  }

  // Assemble groups in the caller's root order, dropping empty ones.
  const out: TreeNode[] = []
  for (const raw of roots) {
    const g = groupByRoot.get(raw)
    if (g) out.push(g)
  }

  if (loose.length > 0) {
    if (out.length === 0) {
      // Nothing synced — present a plain flat list, no "Other files" wrapper.
      loose.sort(compareNodes)
      out.push(...loose)
    } else {
      out.push({
        kind: 'folder',
        key: OTHER_FILES_KEY,
        name: OTHER_FILES_KEY,
        fullPath: null,
        children: loose,
        fileCount: loose.length,
      })
    }
  }

  // Count + order within each group; top-level group order stays as assembled.
  for (const n of out) if (n.kind === 'folder') countFiles(n)
  for (const n of out) if (n.kind === 'folder') sortChildren(n)
  return out
}

export interface FlatRow {
  node: TreeNode
  depth: number
}

/** Flatten the tree to the currently-visible rows (expanded folders only), so
 *  the renderer can window/virtualise a plain list instead of a nested DOM. */
export function flattenTree(nodes: readonly TreeNode[], expanded: ReadonlySet<string>): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (list: readonly TreeNode[], depth: number): void => {
    for (const n of list) {
      out.push({ node: n, depth })
      if (n.kind === 'folder' && expanded.has(n.key)) walk(n.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return out
}

/** Keys of the top-level folder groups — the default-expanded set. */
export function topLevelFolderKeys(nodes: readonly TreeNode[]): string[] {
  return nodes.filter((n): n is FolderNode => n.kind === 'folder').map((n) => n.key)
}

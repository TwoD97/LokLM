import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  File,
  AlertTriangle,
  Pin,
} from 'lucide-react'
import type { Document, IndexProgress } from '@shared/documents'
import { useT } from '../i18n'
import { DocumentActionsMenu, type DocumentActions } from './DocumentActionsMenu'
import { LanguageBadge, StatusBadge } from './DocumentRow'
import { deriveRowStatus } from './documentStatus'
import {
  buildDocumentTree,
  flattenTree,
  topLevelFolderKeys,
  type FolderNode,
} from './documentTreeModel'

type Props = {
  docs: Document[]
  /** Absolute synced-folder roots — the anchors files nest under. */
  syncRoots: string[]
  /** Workspace id; resets expansion + window on a genuine workspace switch. */
  resetKey: number
  progress: Map<number, IndexProgress>
  /** Documents with chunks pending re-embedding — their rows read 're-embedding'. */
  reembedDocIds?: Set<number>
} & DocumentActions

// Same windowing budget as DocumentTable — cap the initial DOM, expand on scroll.
const INITIAL_BATCH = 120
const BATCH_STEP = 120
// Indent per nesting level; files get an extra step to clear the chevron column.
const INDENT = 16
const PAD = 8

export function DocumentTree({
  docs,
  syncRoots,
  resetKey,
  progress,
  reembedDocIds,
  ...actions
}: Props): JSX.Element {
  const t = useT()
  const tree = useMemo(() => buildDocumentTree(docs, syncRoots), [docs, syncRoots])
  const topKeys = useMemo(() => topLevelFolderKeys(tree), [tree])

  // Expansion state. Top-level groups auto-open the first time they appear
  // (docs arrive async after a workspace switch, so we can't seed once at mount).
  // `seenRef` remembers which top groups we've already auto-opened so a user
  // who collapses one doesn't see it spring back on the next doc refresh.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const seenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    seenRef.current = new Set()
    setExpanded(new Set())
  }, [resetKey])

  useEffect(() => {
    setExpanded((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const k of topKeys) {
        if (!seenRef.current.has(k)) {
          seenRef.current.add(k)
          next.add(k)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [topKeys])

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded])

  // Windowing (mirrors DocumentTable): show INITIAL_BATCH rows, grow when the
  // sentinel scrolls near. Reset only on workspace switch, not on doc refresh.
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => setVisibleCount(INITIAL_BATCH), [resetKey])
  useEffect(() => {
    if (visibleCount >= rows.length) return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((n) => Math.min(n + BATCH_STEP, rows.length))
        }
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visibleCount, rows.length])

  if (docs.length === 0) {
    return <div className="library__empty">{t('library.empty')}</div>
  }

  const visibleRows = visibleCount >= rows.length ? rows : rows.slice(0, visibleCount)
  const hiddenCount = rows.length - visibleRows.length

  return (
    <div className="library__tree" role="tree">
      {visibleRows.map(({ node, depth }) => {
        if (node.kind === 'folder') {
          return (
            <FolderRow
              key={node.key}
              node={node}
              depth={depth}
              open={expanded.has(node.key)}
              onToggle={toggle}
            />
          )
        }
        // Local const so TS narrows away `undefined` for the conditional spread
        // (exactOptionalPropertyTypes) — same trick DocumentTable uses.
        const p = progress.get(node.doc.id)
        return (
          <TreeFileRow
            key={node.key}
            doc={node.doc}
            depth={depth}
            {...(p !== undefined ? { progress: p } : {})}
            {...(reembedDocIds?.has(node.doc.id) ? { reembedding: true } : {})}
            {...actions}
          />
        )
      })}
      {hiddenCount > 0 && (
        <div ref={sentinelRef} className="library__tree-sentinel" aria-hidden="true">
          {t('library.loadingMore', { count: hiddenCount })}
        </div>
      )}
    </div>
  )
}

function FolderRow({
  node,
  depth,
  open,
  onToggle,
}: {
  node: FolderNode
  depth: number
  open: boolean
  onToggle: (key: string) => void
}): JSX.Element {
  const t = useT()
  // The synthetic loose-files bucket (fullPath === null) gets a translated label;
  // real folders show their own name.
  const label = node.fullPath === null ? t('library.otherFiles') : node.name
  return (
    <div
      className="library__tree-row library__tree-folder"
      style={{ paddingLeft: depth * INDENT + PAD }}
      role="treeitem"
      aria-expanded={open}
      title={node.fullPath ?? undefined}
      onClick={() => onToggle(node.key)}
    >
      {open ? (
        <ChevronDown size={14} aria-hidden="true" className="library__tree-chevron" />
      ) : (
        <ChevronRight size={14} aria-hidden="true" className="library__tree-chevron" />
      )}
      {open ? (
        <FolderOpen size={15} aria-hidden="true" className="library__tree-foldericon" />
      ) : (
        <Folder size={15} aria-hidden="true" className="library__tree-foldericon" />
      )}
      <span className="library__tree-name">{label}</span>
      <span className="library__tree-count">{node.fileCount}</span>
    </div>
  )
}

type FileRowProps = {
  doc: Document
  depth: number
  progress?: IndexProgress
  reembedding?: boolean
} & DocumentActions

function TreeFileRowImpl({
  doc,
  depth,
  progress,
  reembedding,
  ...actions
}: FileRowProps): JSX.Element {
  const t = useT()
  const status = deriveRowStatus(doc, progress, reembedding)
  const isMissing = doc.missingAt != null
  return (
    <div
      className={`library__tree-row library__tree-file${isMissing ? ' library__row--missing' : ''}`}
      // Extra INDENT so the file icon clears the folder's chevron column.
      style={{ paddingLeft: depth * INDENT + PAD + INDENT }}
      role="treeitem"
      onDoubleClick={() => actions.onRead(doc)}
    >
      <File size={15} aria-hidden="true" className="library__tree-fileicon" />
      <span className="library__tree-name library__row-title">
        {isMissing && (
          <AlertTriangle
            size={14}
            aria-label={t('library.sourceMissing')}
            className="library__row-missing-icon"
          />
        )}
        {doc.pinned && (
          <Pin size={12} aria-label={t('library.pinned')} className="library__row-pinned-icon" />
        )}
        <span className="library__tree-title-text">{doc.title}</span>
        {doc.language && <LanguageBadge language={doc.language} t={t} />}
      </span>
      <StatusBadge status={status} />
      <DocumentActionsMenu doc={doc} {...actions} />
    </div>
  )
}

// Memoised for the same reason as DocumentRow: an indexing storm refreshes the
// progress map every tick, and without this every leaf would redraw.
const TreeFileRow = memo(TreeFileRowImpl)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { List, Folders, FolderTree as FolderTreeIcon, Upload } from 'lucide-react'
import type { Document, IndexProgress, LibrarySearchHit } from '@shared/documents'
import type { WorkspaceStorageFootprint } from '@shared/workspaceStorage'
import { deriveIndexBatchProgress } from '@shared/indexProgress'
import { DocumentTable } from './DocumentTable'
import { DocumentTree } from './DocumentTree'
import { LibraryFileRow } from './LibraryFileRow'
import { FolderTree } from '../folders/FolderTree'
import { useFolders } from '../folders/useFolders'
import { buildFolderTree, topLevelFolderKeys } from '../folders/folderTreeModel'
import { DocumentPreview } from './DocumentPreview'
import { SummaryModal } from './SummaryModal'
import { SyncFoldersPanel } from './SyncFoldersPanel'
import { MissingDocsBanner } from './MissingDocsBanner'
import { FailedDocsBanner } from './FailedDocsBanner'
import { LibrarySearchBar } from './LibrarySearchBar'
import { SearchResults } from './SearchResults'
import { useLibrarySearch } from './useLibrarySearch'
import { filterBrowseDocs, sortBrowseDocs } from './browseFilter'
import { PasswordRetypeGate } from '../auth/PasswordRetypeGate'
import { SourceViewer } from '../chat/SourceViewer'
import { ErrorBoundary } from '../ErrorBoundary'
import { useT } from '../i18n'
import { formatBytes, formatDuration, formatCount } from '../lib/format'
import './library.css'

type Props = {
  workspaceId: number
  workspaceName: string
  // Search query and table page are lifted to AppShell (which stays mounted)
  // so they survive this view unmounting on a tab switch. Optional — when
  // omitted the view owns both internally (standalone / test default).
  searchQuery?: string | undefined
  onSearchQueryChange?: ((q: string) => void) | undefined
  page?: number | undefined
  onPageChange?: ((page: number) => void) | undefined
}

export function LibraryView({
  workspaceId,
  workspaceName,
  searchQuery,
  onSearchQueryChange,
  page,
  onPageChange,
}: Props): JSX.Element {
  const t = useT()
  const [docs, setDocs] = useState<Document[]>([])
  // Three views of the same documents, persisted so the choice sticks:
  //   'list'     — flat sortable table
  //   'folders'  — user-created organizational folders (shared with the chat
  //                sidebar; the "unify" decision)
  //   'location' — VS-Code-style tree derived from each doc's sourcePath under
  //                the synced-folder roots ("by file location")
  const [viewMode, setViewMode] = useState<'list' | 'folders' | 'location'>(() => {
    if (typeof localStorage === 'undefined') return 'list'
    const v = localStorage.getItem('loklm.libraryViewMode')
    if (v === 'folders' || v === 'location') return v
    if (v === 'tree') return 'location' // migrate the old two-way value
    return 'list'
  })
  const setView = useCallback((mode: 'list' | 'folders' | 'location') => {
    setViewMode(mode)
    try {
      localStorage.setItem('loklm.libraryViewMode', mode)
    } catch {
      /* private mode / disabled storage — fall back to in-memory only */
    }
  }, [])
  // Workspace storage footprint (ADR-0005 transparency). Measured at-rest sizes
  // (enc/ + meta.db) + derived open-size / decrypt-on-open time. Re-fetched on
  // workspace switch and after ingest/sync completes, since the sizes change
  // when documents are added.
  const [storage, setStorage] = useState<WorkspaceStorageFootprint | null>(null)
  const refreshStorage = useCallback((wsId: number) => {
    void window.api.workspaces
      .storageEstimate(wsId)
      .then(setStorage)
      .catch(() => setStorage(null))
  }, [])
  useEffect(() => {
    refreshStorage(workspaceId)
  }, [workspaceId, refreshStorage])
  // Manual folders for this workspace (shared model with the chat sidebar).
  const folders = useFolders(workspaceId)
  const folderTree = useMemo(
    () => buildFolderTree(folders.folders, folders.assignments, docs),
    [folders.folders, folders.assignments, docs],
  )
  const folderTopKeys = useMemo(() => topLevelFolderKeys(folderTree), [folderTree])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const folderSeenRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    folderSeenRef.current = new Set()
    setExpandedFolders(new Set())
  }, [workspaceId])
  useEffect(() => {
    setExpandedFolders((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const k of folderTopKeys) {
        if (!folderSeenRef.current.has(k)) {
          folderSeenRef.current.add(k)
          next.add(k)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [folderTopKeys])
  const toggleFolderExpand = useCallback((key: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  // Synced-folder roots — the anchors the tree nests files under. Refetched on
  // workspace switch and after every sync run (folders may have been added).
  const [syncRoots, setSyncRoots] = useState<string[]>([])
  const [progress, setProgress] = useState<Map<number, IndexProgress>>(new Map())
  // Last embedding throughput reported by any doc's embedding phase. STICKY on
  // purpose: each doc spends most of its index cycle in parsing/chunking/
  // persisting, so deriving this from the live phase made the readout flicker
  // in and out during bulk indexing. Held while the batch drains, cleared when
  // the queue empties (effect below) or the workspace changes.
  const [embedRate, setEmbedRate] = useState<number | null>(null)
  // Documents that still have un-embedded chunks while a vector re-embed (model
  // swap / backfill) runs for this workspace — only these rows read
  // 're-embedding' instead of painting the whole library. Refreshed as the
  // backfill drains, cleared when it ends.
  const [reembedDocIds, setReembedDocIds] = useState<Set<number>>(new Set())
  // Bumped after any flow that could change the missing-banner contents
  // (sync run, doc delete, replace, refresh). The banner refetches on every
  // bump rather than subscribing to four separate event sources.
  const [missingTick, setMissingTick] = useState(0)
  const bumpMissing = useCallback(() => setMissingTick((n) => n + 1), [])
  // In-app reader for the highlighted document. Null = closed.
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null)
  // Document whose summary modal is open. Null = closed.
  const [summaryDoc, setSummaryDoc] = useState<Document | null>(null)
  // Pending export — the user clicked Exportieren ; we hold the document
  // here while the PasswordRetypeGate is up. On confirm we run the gated
  // exportDocument flow.
  const [exportPending, setExportPending] = useState<Document | null>(null)
  // AP-6 search state (query/filters/sort/hits) + the clicked hit whose source
  // is open in the SourceViewer modal. Null = no source open.
  const search = useLibrarySearch(workspaceId, {
    query: searchQuery,
    onQueryChange: onSearchQueryChange,
  })
  const [sourceHit, setSourceHit] = useState<{ chunkId: number; documentTitle: string } | null>(
    null,
  )
  const onOpenHit = useCallback(
    (h: LibrarySearchHit) => setSourceHit({ chunkId: h.chunkId, documentTitle: h.documentTitle }),
    [],
  )

  // Depend on the stable `refresh` callback, NOT the whole folders object (which
  // useFolders mints fresh each render) — otherwise the mount effect below would
  // re-run every render and refetch in a loop.
  const refreshFolders = folders.refresh
  const refreshDocs = useCallback(
    async (id: number) => {
      setDocs(await window.api.documents.list(id))
      // Keep folder assignments/counts in step with adds/deletes/moves.
      void refreshFolders()
    },
    [refreshFolders],
  )

  const refreshSyncRoots = useCallback(async (id: number) => {
    setSyncRoots(await window.api.workspaces.listSyncFolders(id))
  }, [])

  useEffect(() => {
    void refreshDocs(workspaceId)
    void refreshSyncRoots(workspaceId)
  }, [workspaceId, refreshDocs, refreshSyncRoots])

  // Backfill status is broadcast per-workspace; ignore events for any workspace
  // other than the one on screen. We also fetch the current status on mount/switch
  // — a re-embed that started before the Library was opened never re-broadcasts,
  // so subscribing alone would miss an already-running backfill.
  //
  // Alongside the status we refresh `reembedDocIds` (the docs with un-embedded
  // chunks) so rows flip back to 'ready' as the backfill drains them, and clear
  // it + refresh the doc list on done/failed.
  useEffect(() => {
    let cancelled = false
    const refreshPending = (): void => {
      void window.api.embedder.pendingReembedDocs(workspaceId).then((ids) => {
        if (!cancelled) setReembedDocIds(new Set(ids))
      })
    }
    setReembedDocIds(new Set())
    void window.api.embedder.backfillStatus(workspaceId).then((s) => {
      if (cancelled || s.workspaceId !== workspaceId) return
      if (s.state === 'running') refreshPending()
    })
    const off = window.api.embedder.onBackfillStatus((s) => {
      if (s.workspaceId !== workspaceId) return
      if (s.state === 'running') {
        refreshPending()
      } else {
        setReembedDocIds(new Set())
        if (s.state === 'done' || s.state === 'failed') void refreshDocs(workspaceId)
      }
    })
    return () => {
      cancelled = true
      off()
    }
  }, [workspaceId, refreshDocs])

  useEffect(() => {
    const off = window.api.documents.onIndexProgress((p) => {
      setProgress((prev) => {
        const next = new Map(prev)
        next.set(p.documentId, p)
        return next
      })
      if (p.phase === 'embedding' && typeof p.chunksPerSec === 'number') {
        setEmbedRate(p.chunksPerSec)
      }
      if (p.phase === 'done' || p.phase === 'failed') {
        void refreshDocs(workspaceId)
        refreshStorage(workspaceId)
      }
    })
    return () => off()
  }, [workspaceId, refreshDocs, refreshStorage])

  // The rate belongs to whichever queue is on screen — drop it on switch.
  useEffect(() => setEmbedRate(null), [workspaceId])

  // Sync events arrive on a separate channel ; on 'done' we refresh the doc
  // list once so deletions + new imports appear without per-doc roundtrips,
  // and bump the missing-banner refresh key so it surfaces newly-marked
  // vanished files immediately (no per-event subscription on the banner).
  useEffect(() => {
    const off = window.api.workspaces.onSyncProgress((ev) => {
      if (ev.workspaceId !== workspaceId) return
      if (ev.phase === 'done' || ev.phase === 'failed') {
        void refreshDocs(workspaceId)
        void refreshSyncRoots(workspaceId)
        refreshStorage(workspaceId)
        bumpMissing()
      }
    })
    return () => off()
  }, [workspaceId, refreshDocs, refreshSyncRoots, refreshStorage, bumpMissing])

  const onImport = useCallback(
    async (paths: string[]) => {
      for (const p of paths) {
        try {
          await window.api.documents.import(workspaceId, p)
        } catch (err) {
          console.error('import failed', err)
        }
      }
      void refreshDocs(workspaceId)
    },
    [workspaceId, refreshDocs],
  )

  const onDelete = useCallback(
    async (id: number) => {
      await window.api.documents.delete(id)
      void refreshDocs(workspaceId)
    },
    [workspaceId, refreshDocs],
  )

  const onReindex = useCallback(
    async (id: number) => {
      await window.api.documents.reindex(id)
      void refreshDocs(workspaceId)
    },
    [workspaceId, refreshDocs],
  )

  const onReveal = useCallback(
    async (id: number) => {
      const res = await window.api.documents.revealSource(id)
      if (!res.ok) {
        window.alert(t('library.sourceNotFound', { path: res.sourcePath }))
      }
    },
    [t],
  )

  const onOpenExternal = useCallback(
    async (id: number) => {
      const res = await window.api.documents.openExternal(id)
      if (!res.ok) {
        window.alert(t('library.cannotOpenFile', { message: res.message }))
      }
    },
    [t],
  )

  const onReplace = useCallback(
    async (id: number) => {
      try {
        const replaced = await window.api.documents.replaceSource(id)
        if (replaced != null) void refreshDocs(workspaceId)
      } catch (err) {
        console.error('replace failed', err)
        window.alert(err instanceof Error ? err.message : String(err))
      }
    },
    [workspaceId, refreshDocs],
  )

  const onCancelIndexing = useCallback(async () => {
    await window.api.documents.cancelIndexing(workspaceId)
    void refreshDocs(workspaceId)
  }, [workspaceId, refreshDocs])

  // Bulk "retry failed" — re-index every failed doc in one shot instead of
  // doing it one-by-one through each row's ⋯ menu. Loops the existing per-doc
  // reindex IPC (same pattern as onImport), then refreshes once at the end.
  const onRetryFailed = useCallback(
    async (ids: number[]) => {
      for (const id of ids) {
        try {
          await window.api.documents.reindex(id)
        } catch (err) {
          console.error('retry failed doc', err)
        }
      }
      void refreshDocs(workspaceId)
    },
    [workspaceId, refreshDocs],
  )

  const onRead = useCallback((d: Document) => {
    setPreviewDoc(d)
  }, [])

  const onSummarize = useCallback((d: Document) => {
    setSummaryDoc(d)
  }, [])

  const onTogglePin = useCallback(
    async (d: Document) => {
      try {
        await window.api.documents.setPinned(d.id, !d.pinned)
      } catch (err) {
        window.alert(
          t('library.pinFailed', { message: err instanceof Error ? err.message : String(err) }),
        )
        return
      }
      void refreshDocs(workspaceId)
    },
    [workspaceId, refreshDocs, t],
  )

  const onExport = useCallback((d: Document) => {
    setExportPending(d)
  }, [])

  const onRefresh = useCallback(
    async (id: number) => {
      const res = await window.api.documents.refresh(id)
      if (res.ok) {
        // 'missing' now stamps the soft-marker in main ; the banner surfaces it,
        // so we just bump and refresh instead of popping an alert.
        void refreshDocs(workspaceId)
        bumpMissing()
      } else {
        window.alert(res.message)
      }
    },
    [workspaceId, refreshDocs, bumpMissing],
  )

  // Aggregate indexing progress (ready / total / percent) — drives the batch
  // progress bar. Updates as the queue drains (each finished doc fires an
  // indexing:progress 'done' → refreshDocs).
  const indexBatch = deriveIndexBatchProgress(docs)

  // Queue drained (or nothing indexing) — the sticky throughput readout is no
  // longer describing anything live, so retire it before the bar unmounts.
  const indexActive = indexBatch.active
  useEffect(() => {
    if (indexActive === 0) setEmbedRate(null)
  }, [indexActive])

  // Docs that failed to index — drives the bulk "retry failed" banner. A doc
  // with an in-flight non-failed progress is mid-retry, so exclude it (its
  // persisted status is still 'failed' until the run reports 'done').
  const failedIds = docs
    .filter((d) => {
      const p = progress.get(d.id)
      if (p && p.phase !== 'failed') return false
      return d.status === 'failed' || p?.phase === 'failed'
    })
    .map((d) => d.id)

  // The browse list = documents narrowed by the toolbar's type/date/size/status
  // filters and ordered by the sort control. Search runs its own server-side
  // filtering, so this only feeds the no-query browse views (list + location).
  // 'relevance' sort is a no-op while browsing; DocumentTable still floats the
  // in-progress rows to the top on top of this order.
  const browseDocs = useMemo(
    () =>
      sortBrowseDocs(
        filterBrowseDocs(
          docs,
          search.filters,
          progress,
          reembedDocIds,
          Math.floor(Date.now() / 1000),
        ),
        search.sort,
      ),
    [docs, search.filters, search.sort, progress, reembedDocIds],
  )
  // A filter narrowed the list down to nothing — distinct from a genuinely empty
  // library, so it gets its own "no matches + reset" state instead of the
  // "import files" empty prompt.
  const filteredEmpty = search.filtersActive && docs.length > 0 && browseDocs.length === 0

  return (
    <div className="library">
      <h1 style={{ margin: '8px 0 4px' }}>{workspaceName}</h1>
      {/* workspaceName is user data, rendered verbatim. */}
      {storage && (storage.atRestBytes > 0 || storage.vectorCount > 0) && (
        <div className="library__storage" role="group">
          <span className="library__storage-stat">
            <span className="library__storage-label">{t('library.storage.atRest')}</span>
            <span className="library__storage-value">
              {!storage.measured && '~'}
              {formatBytes(storage.atRestBytes)}
            </span>
          </span>
          <span className="library__storage-stat" title={t('library.storage.whenOpenHint')}>
            <span className="library__storage-label">{t('library.storage.whenOpen')}</span>
            <span className="library__storage-value">≈ {formatBytes(storage.openBytes)}</span>
          </span>
          <span className="library__storage-stat" title={t('library.storage.openTimeHint')}>
            <span className="library__storage-label">{t('library.storage.openTime')}</span>
            <span className="library__storage-value">
              ≈ {formatDuration(storage.estDecryptOnOpenMs)}
            </span>
          </span>
          <span className="library__storage-meta">
            {docs.length} {t('library.storage.docsLabel')} · {formatCount(storage.vectorCount)}{' '}
            {t('library.storage.vectorsLabel')}
          </span>
        </div>
      )}
      <SyncFoldersPanel
        workspaceId={workspaceId}
        onSyncDone={() => void refreshDocs(workspaceId)}
      />
      <MissingDocsBanner
        workspaceId={workspaceId}
        refreshKey={missingTick}
        onChanged={() => void refreshDocs(workspaceId)}
      />
      <FailedDocsBanner count={failedIds.length} onRetryAll={() => void onRetryFailed(failedIds)} />
      <DropZone
        onFiles={(paths) => void onImport(paths)}
        onPick={async () => {
          const paths = await window.api.documents.pickFiles()
          if (paths.length > 0) void onImport(paths)
        }}
      />
      {indexBatch.active > 0 && (
        <div className="library__indexing-bar" role="status" aria-live="polite">
          <div className="library__indexing-head">
            <span>
              {t('library.indexProgress', {
                ready: indexBatch.ready,
                total: indexBatch.total,
                percent: indexBatch.percent,
              })}
              {embedRate !== null &&
                ` · ${t('library.indexThroughput', { rate: embedRate.toFixed(1) })}`}
            </span>
            <button
              type="button"
              className="library__indexing-stop"
              onClick={() => void onCancelIndexing()}
            >
              {t('library.stopIndexing')}
            </button>
          </div>
          <div className="library__index-progress" aria-hidden="true">
            <div
              className="library__index-progress-fill"
              style={{ width: `${indexBatch.percent}%` }}
            />
          </div>
        </div>
      )}
      <LibrarySearchBar
        query={search.query}
        onQueryChange={search.setQuery}
        onClear={search.clear}
        filters={search.filters}
        onTypesChange={search.setTypes}
        onDateChange={search.setDate}
        onSizeChange={search.setSize}
        onStatusChange={search.setStatusFilter}
        sort={search.sort}
        onSortChange={search.setSort}
        active={search.active}
        resultCount={search.status === 'done' ? search.hits.length : undefined}
      />
      {/* Search mode replaces the browse table while a query is active. When the
       *  field is empty the normal document list returns. */}
      {search.active ? (
        <SearchResults
          hits={search.hits}
          status={search.status}
          onOpen={onOpenHit}
          query={search.query}
          docs={docs}
          actions={{
            onDelete,
            onReindex,
            onReveal,
            onOpenExternal,
            onReplace,
            onRefresh,
            onRead,
            onExport,
            onSummarize,
            onTogglePin,
          }}
        />
      ) : (
        <>
          <div className="library__viewtoggle" role="group" aria-label={t('library.viewMode')}>
            <button
              type="button"
              className={viewMode === 'list' ? 'is-active' : ''}
              aria-pressed={viewMode === 'list'}
              onClick={() => setView('list')}
              title={t('library.viewList')}
            >
              <List size={14} aria-hidden="true" />
              {t('library.viewList')}
            </button>
            <button
              type="button"
              className={viewMode === 'folders' ? 'is-active' : ''}
              aria-pressed={viewMode === 'folders'}
              onClick={() => setView('folders')}
              title={t('library.viewFolders')}
            >
              <Folders size={14} aria-hidden="true" />
              {t('library.viewFolders')}
            </button>
            <button
              type="button"
              className={viewMode === 'location' ? 'is-active' : ''}
              aria-pressed={viewMode === 'location'}
              onClick={() => setView('location')}
              title={t('library.viewLocation')}
            >
              <FolderTreeIcon size={14} aria-hidden="true" />
              {t('library.viewLocation')}
            </button>
          </div>
          {/* Pass the callbacks straight , each is already useCallback'd above, so
           *  the rows' React.memo can actually skip re-renders for rows whose
           *  doc + progress didn't change. Wrapping them inline with arrows used
           *  to mint fresh fns each render and defeat the memo. */}
          {filteredEmpty && viewMode !== 'folders' ? (
            <div className="library__filtered-empty">
              <span>{t('library.noFilterMatches')}</span>
              <button type="button" className="library__empty-action" onClick={search.resetFilters}>
                {t('library.clearFilters')}
              </button>
            </div>
          ) : viewMode === 'folders' ? (
            <FolderTree
              nodes={folderTree}
              expanded={expandedFolders}
              onToggleExpand={toggleFolderExpand}
              onCreateFolder={(name, parentId) => void folders.createFolder(name, parentId)}
              onRenameFolder={(id, name) => void folders.renameFolder(id, name)}
              onDeleteFolder={(id) => void folders.deleteFolder(id)}
              onMoveDocument={(docId, folderId) => void folders.moveDocument(docId, folderId)}
              newFolderLabel={t('folders.new')}
              renderFile={(d) => {
                // Local const so TS narrows away undefined for the conditional
                // spread (exactOptionalPropertyTypes).
                const p = progress.get(d.id)
                return (
                  <LibraryFileRow
                    doc={d}
                    {...(p !== undefined ? { progress: p } : {})}
                    {...(reembedDocIds.has(d.id) ? { reembedding: true } : {})}
                    onDelete={onDelete}
                    onReindex={onReindex}
                    onReveal={onReveal}
                    onOpenExternal={onOpenExternal}
                    onReplace={onReplace}
                    onRefresh={onRefresh}
                    onRead={onRead}
                    onExport={onExport}
                    onSummarize={onSummarize}
                    onTogglePin={onTogglePin}
                  />
                )
              }}
            />
          ) : viewMode === 'location' ? (
            <DocumentTree
              docs={browseDocs}
              syncRoots={syncRoots}
              resetKey={workspaceId}
              progress={progress}
              reembedDocIds={reembedDocIds}
              onDelete={onDelete}
              onReindex={onReindex}
              onReveal={onReveal}
              onOpenExternal={onOpenExternal}
              onReplace={onReplace}
              onRefresh={onRefresh}
              onRead={onRead}
              onExport={onExport}
              onSummarize={onSummarize}
              onTogglePin={onTogglePin}
            />
          ) : (
            <DocumentTable
              docs={browseDocs}
              resetKey={workspaceId}
              progress={progress}
              reembedDocIds={reembedDocIds}
              page={page}
              onPageChange={onPageChange}
              onDelete={onDelete}
              onReindex={onReindex}
              onReveal={onReveal}
              onOpenExternal={onOpenExternal}
              onReplace={onReplace}
              onRefresh={onRefresh}
              onRead={onRead}
              onExport={onExport}
              onSummarize={onSummarize}
              onTogglePin={onTogglePin}
            />
          )}
        </>
      )}
      {sourceHit && (
        <ErrorBoundary label={t('library.previewDoc')} onError={() => setSourceHit(null)}>
          <SourceViewer
            chunkId={sourceHit.chunkId}
            documentTitle={sourceHit.documentTitle}
            messageText={null}
            onClose={() => setSourceHit(null)}
          />
        </ErrorBoundary>
      )}
      {previewDoc && <DocumentPreview doc={previewDoc} onClose={() => setPreviewDoc(null)} />}
      {summaryDoc && <SummaryModal doc={summaryDoc} onClose={() => setSummaryDoc(null)} />}
      <PasswordRetypeGate
        open={exportPending !== null}
        title={t('library.exportTitle')}
        body={exportPending ? t('library.exportBody', { title: exportPending.title }) : ''}
        confirmLabel={t('library.exportLabel')}
        onCancel={() => setExportPending(null)}
        onConfirm={async () => {
          const target = exportPending
          if (!target) return
          const res = await window.api.documents.exportDocument(target.id)
          setExportPending(null)
          if (res.ok === false && res.kind !== 'cancelled') {
            window.alert(t('library.exportFailed', { message: res.message }))
          }
        }}
      />
    </div>
  )
}

function DropZone({
  onFiles,
  onPick,
}: {
  onFiles: (paths: string[]) => void
  onPick: () => void
}): JSX.Element {
  const t = useT()
  const [over, setOver] = useState(false)
  return (
    <button
      type="button"
      className={`library__drop ${over ? 'library__drop--over' : ''}`}
      onClick={onPick}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const files = Array.from(e.dataTransfer.files)
          .map((f) => window.api.documents.getPathForFile(f))
          .filter(Boolean)
        onFiles(files)
      }}
    >
      <Upload size={15} aria-hidden="true" className="library__drop-icon" />
      <span>{t('library.dropZone')}</span>
    </button>
  )
}

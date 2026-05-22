import { useCallback, useEffect, useState } from 'react'
import type { Document, IndexProgress } from '@shared/documents'
import { DocumentTable } from './DocumentTable'
import { DocumentPreview } from './DocumentPreview'
import { SyncFoldersPanel } from './SyncFoldersPanel'
import { MissingDocsBanner } from './MissingDocsBanner'
import { PasswordRetypeGate } from '../auth/PasswordRetypeGate'
import './library.css'

type Props = {
  workspaceId: number
  workspaceName: string
}

export function LibraryView({ workspaceId, workspaceName }: Props): JSX.Element {
  const [docs, setDocs] = useState<Document[]>([])
  const [progress, setProgress] = useState<Map<number, IndexProgress>>(new Map())
  // Bumped after any flow that could change the missing-banner contents
  // (sync run, doc delete, replace, refresh). The banner refetches on every
  // bump rather than subscribing to four separate event sources.
  const [missingTick, setMissingTick] = useState(0)
  const bumpMissing = useCallback(() => setMissingTick((n) => n + 1), [])
  // In-app reader for the highlighted document. Null = closed.
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null)
  // Pending export — the user clicked Exportieren ; we hold the document
  // here while the PasswordRetypeGate is up. On confirm we run the gated
  // exportDocument flow.
  const [exportPending, setExportPending] = useState<Document | null>(null)

  const refreshDocs = useCallback(async (id: number) => {
    setDocs(await window.api.documents.list(id))
  }, [])

  useEffect(() => {
    void refreshDocs(workspaceId)
  }, [workspaceId, refreshDocs])

  useEffect(() => {
    const off = window.api.documents.onIndexProgress((p) => {
      setProgress((prev) => {
        const next = new Map(prev)
        next.set(p.documentId, p)
        return next
      })
      if (p.phase === 'done' || p.phase === 'failed') {
        void refreshDocs(workspaceId)
      }
    })
    return () => off()
  }, [workspaceId, refreshDocs])

  // Sync events arrive on a separate channel ; on 'done' we refresh the doc
  // list once so deletions + new imports appear without per-doc roundtrips,
  // and bump the missing-banner refresh key so it surfaces newly-marked
  // vanished files immediately (no per-event subscription on the banner).
  useEffect(() => {
    const off = window.api.workspaces.onSyncProgress((ev) => {
      if (ev.workspaceId !== workspaceId) return
      if (ev.phase === 'done' || ev.phase === 'failed') {
        void refreshDocs(workspaceId)
        bumpMissing()
      }
    })
    return () => off()
  }, [workspaceId, refreshDocs, bumpMissing])

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

  const onReveal = useCallback(async (id: number) => {
    const res = await window.api.documents.revealSource(id)
    if (!res.ok) {
      window.alert(`Quelldatei nicht gefunden:\n${res.sourcePath}`)
    }
  }, [])

  const onOpenExternal = useCallback(async (id: number) => {
    const res = await window.api.documents.openExternal(id)
    if (!res.ok) {
      window.alert(`Datei kann nicht geöffnet werden: ${res.message}`)
    }
  }, [])

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

  const onRead = useCallback((d: Document) => {
    setPreviewDoc(d)
  }, [])

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

  return (
    <div className="library">
      <h1 style={{ margin: '8px 0 4px' }}>{workspaceName}</h1>
      <SyncFoldersPanel
        workspaceId={workspaceId}
        onSyncDone={() => void refreshDocs(workspaceId)}
      />
      <MissingDocsBanner
        workspaceId={workspaceId}
        refreshKey={missingTick}
        onChanged={() => void refreshDocs(workspaceId)}
      />
      <DropZone
        onFiles={(paths) => void onImport(paths)}
        onPick={async () => {
          const paths = await window.api.documents.pickFiles()
          if (paths.length > 0) void onImport(paths)
        }}
      />
      {/* Pass the callbacks straight , each is already useCallback'd above, so
       *  DocumentRow's React.memo can actually skip re-renders for rows whose
       *  doc + progress didn't change. Wrapping them inline with arrows used
       *  to mint fresh fns each render and defeat the memo. */}
      <DocumentTable
        docs={docs}
        progress={progress}
        onDelete={onDelete}
        onReindex={onReindex}
        onReveal={onReveal}
        onOpenExternal={onOpenExternal}
        onReplace={onReplace}
        onRefresh={onRefresh}
        onRead={onRead}
        onExport={onExport}
      />
      {previewDoc && <DocumentPreview doc={previewDoc} onClose={() => setPreviewDoc(null)} />}
      <PasswordRetypeGate
        open={exportPending !== null}
        title="Dokument exportieren"
        body={
          exportPending
            ? `"${exportPending.title}" verlässt den Tresor als unverschlüsselte Kopie. Passwort zur Bestätigung eingeben.`
            : ''
        }
        confirmLabel="Exportieren"
        onCancel={() => setExportPending(null)}
        onConfirm={async () => {
          const target = exportPending
          if (!target) return
          const res = await window.api.documents.exportDocument(target.id)
          setExportPending(null)
          if (res.ok === false && res.kind !== 'cancelled') {
            window.alert(`Export fehlgeschlagen: ${res.message}`)
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
      Klicken zum Auswählen – oder Dateien hierher ziehen.
    </button>
  )
}

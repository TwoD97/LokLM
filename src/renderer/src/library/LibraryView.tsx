import { useCallback, useEffect, useState } from 'react'
import type { Document, IndexProgress } from '@shared/documents'
import { DocumentTable } from './DocumentTable'
import './library.css'

type Props = {
  workspaceId: number
  workspaceName: string
}

export function LibraryView({ workspaceId, workspaceName }: Props): JSX.Element {
  const [docs, setDocs] = useState<Document[]>([])
  const [progress, setProgress] = useState<Map<number, IndexProgress>>(new Map())

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

  return (
    <div className="library">
      <h1 style={{ margin: '8px 0 4px' }}>{workspaceName}</h1>
      <DropZone
        onFiles={(paths) => void onImport(paths)}
        onPick={async () => {
          const paths = await window.api.documents.pickFiles()
          if (paths.length > 0) void onImport(paths)
        }}
      />
      <DocumentTable
        docs={docs}
        progress={progress}
        onDelete={(id) => void onDelete(id)}
        onReindex={(id) => void onReindex(id)}
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

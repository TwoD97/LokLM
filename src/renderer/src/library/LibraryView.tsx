import { useCallback, useEffect, useState } from 'react'
import type { Document, Workspace, IndexProgress } from '@shared/documents'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { DocumentTable } from './DocumentTable'
import './library.css'

export function LibraryView(): JSX.Element {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [docs, setDocs] = useState<Document[]>([])
  const [progress, setProgress] = useState<Map<number, IndexProgress>>(new Map())

  const refreshWorkspaces = useCallback(async () => {
    const ws = await window.api.workspaces.list()
    setWorkspaces(ws)
    setActiveId((current) => current ?? (ws.length > 0 ? (ws[0]?.id ?? null) : null))
  }, [])

  const refreshDocs = useCallback(async (id: number) => {
    setDocs(await window.api.documents.list(id))
  }, [])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  useEffect(() => {
    if (activeId != null) void refreshDocs(activeId)
  }, [activeId, refreshDocs])

  useEffect(() => {
    const off = window.api.documents.onIndexProgress((p) => {
      setProgress((prev) => {
        const next = new Map(prev)
        next.set(p.documentId, p)
        return next
      })
      if (p.phase === 'done' || p.phase === 'failed') {
        if (activeId != null) void refreshDocs(activeId)
      }
    })
    return () => off()
  }, [activeId, refreshDocs])

  const onCreateWorkspace = useCallback(
    async (name: string) => {
      const ws = await window.api.workspaces.create(name)
      await refreshWorkspaces()
      setActiveId(ws.id)
    },
    [refreshWorkspaces],
  )

  const onImport = useCallback(
    async (paths: string[]) => {
      if (activeId == null) return
      for (const p of paths) {
        try {
          await window.api.documents.import(activeId, p)
        } catch (err) {
          console.error('import failed', err)
        }
      }
      void refreshDocs(activeId)
    },
    [activeId, refreshDocs],
  )

  const onDelete = useCallback(
    async (id: number) => {
      await window.api.documents.delete(id)
      if (activeId != null) void refreshDocs(activeId)
    },
    [activeId, refreshDocs],
  )

  const onReindex = useCallback(
    async (id: number) => {
      await window.api.documents.reindex(id)
      if (activeId != null) void refreshDocs(activeId)
    },
    [activeId, refreshDocs],
  )

  return (
    <div className="library">
      <WorkspaceSidebar
        workspaces={workspaces}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={(name) => void onCreateWorkspace(name)}
      />
      <main className="library__main">
        <h1 style={{ margin: '8px 0 4px' }}>
          {workspaces.find((w) => w.id === activeId)?.name ?? '—'}
        </h1>
        <DropZone onFiles={(paths) => void onImport(paths)} />
        <DocumentTable
          docs={docs}
          progress={progress}
          onDelete={(id) => void onDelete(id)}
          onReindex={(id) => void onReindex(id)}
        />
      </main>
    </div>
  )
}

function DropZone({ onFiles }: { onFiles: (paths: string[]) => void }): JSX.Element {
  const [over, setOver] = useState(false)
  return (
    <div
      className={`library__drop ${over ? 'library__drop--over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const files = Array.from(e.dataTransfer.files)
          .map((f) => (f as unknown as { path: string }).path)
          .filter(Boolean)
        onFiles(files)
      }}
    >
      Dateien hierher ziehen, um zu importieren.
    </div>
  )
}

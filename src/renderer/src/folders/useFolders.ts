import { useCallback, useEffect, useRef, useState } from 'react'
import type { Folder, FolderAssignment } from '@shared/documents'

export interface UseFolders {
  folders: Folder[]
  assignments: FolderAssignment[]
  error: string | null
  /** Refetch folders + assignments (call after document add/delete elsewhere). */
  refresh: () => Promise<void>
  createFolder: (name: string, parentId: number | null) => Promise<void>
  renameFolder: (id: number, name: string) => Promise<void>
  deleteFolder: (id: number) => Promise<void>
  moveDocument: (documentId: number, folderId: number | null) => Promise<void>
}

/**
 * Folder state for one workspace: the folder rows + document→folder assignments,
 * with CRUD that re-fetches so consumers always render fresh. Shared by the chat
 * Sidebar and the LibraryView so both see the same organization (the "unify"
 * decision). Null workspaceId yields empty data (no active workspace).
 */
export function useFolders(workspaceId: number | null): UseFolders {
  const [snapshot, setSnapshot] = useState<{
    workspaceId: number | null
    folders: Folder[]
    assignments: FolderAssignment[]
    error: string | null
  }>({ workspaceId, folders: [], assignments: [], error: null })
  const currentWorkspace = useRef(workspaceId)
  currentWorkspace.current = workspaceId
  const request = useRef(0)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    if (currentWorkspace.current !== workspaceId || !alive.current) return
    const generation = ++request.current
    if (workspaceId == null) return
    try {
      const data = await window.api.folders.list(workspaceId)
      if (
        alive.current &&
        generation === request.current &&
        currentWorkspace.current === workspaceId
      ) {
        setSnapshot({
          workspaceId,
          folders: data.folders,
          assignments: data.assignments,
          error: null,
        })
      }
    } catch (error) {
      if (
        alive.current &&
        generation === request.current &&
        currentWorkspace.current === workspaceId
      ) {
        setSnapshot((current) => ({
          ...current,
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        }))
      }
      throw error
    }
  }, [workspaceId])

  useEffect(() => {
    alive.current = true
    setSnapshot({ workspaceId, folders: [], assignments: [], error: null })
    void refresh().catch(() => {})
    return () => {
      alive.current = false
    }
  }, [workspaceId, refresh])

  const mutate = useCallback(
    async (operation: () => Promise<unknown>) => {
      if (workspaceId == null || currentWorkspace.current !== workspaceId || !alive.current) return
      try {
        await operation()
        await refresh()
      } catch (error) {
        // Callers launch row actions without awaiting them; retain visible error
        // state instead of leaking an unhandled rejected IPC promise.
        if (alive.current && currentWorkspace.current === workspaceId) {
          setSnapshot((current) => ({
            ...current,
            workspaceId,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }
    },
    [workspaceId, refresh],
  )

  const createFolder = useCallback(
    async (name: string, parentId: number | null) => {
      if (workspaceId == null) return
      const trimmed = name.trim()
      if (trimmed.length === 0) return
      await mutate(() => window.api.folders.create(workspaceId, trimmed, parentId))
    },
    [workspaceId, mutate],
  )

  const renameFolder = useCallback(
    async (id: number, name: string) => {
      if (workspaceId == null) return
      const trimmed = name.trim()
      if (trimmed.length === 0) return
      await mutate(() => window.api.folders.rename(workspaceId, id, trimmed))
    },
    [workspaceId, mutate],
  )

  const deleteFolder = useCallback(
    async (id: number) => {
      if (workspaceId == null) return
      await mutate(() => window.api.folders.delete(workspaceId, id))
    },
    [workspaceId, mutate],
  )

  const moveDocument = useCallback(
    async (documentId: number, folderId: number | null) => {
      if (workspaceId == null) return
      await mutate(() => window.api.folders.setDocumentFolder(workspaceId, documentId, folderId))
    },
    [workspaceId, mutate],
  )

  const current =
    snapshot.workspaceId === workspaceId ? snapshot : { folders: [], assignments: [], error: null }
  return {
    folders: current.folders,
    assignments: current.assignments,
    error: current.error,
    refresh,
    createFolder,
    renameFolder,
    deleteFolder,
    moveDocument,
  }
}

import { useCallback, useEffect, useState } from 'react'
import type { Folder, FolderAssignment } from '@shared/documents'

export interface UseFolders {
  folders: Folder[]
  assignments: FolderAssignment[]
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
  const [folders, setFolders] = useState<Folder[]>([])
  const [assignments, setAssignments] = useState<FolderAssignment[]>([])

  const refresh = useCallback(async () => {
    if (workspaceId == null) {
      setFolders([])
      setAssignments([])
      return
    }
    const data = await window.api.folders.list(workspaceId)
    setFolders(data.folders)
    setAssignments(data.assignments)
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createFolder = useCallback(
    async (name: string, parentId: number | null) => {
      if (workspaceId == null) return
      const trimmed = name.trim()
      if (trimmed.length === 0) return
      await window.api.folders.create(workspaceId, trimmed, parentId)
      await refresh()
    },
    [workspaceId, refresh],
  )

  const renameFolder = useCallback(
    async (id: number, name: string) => {
      if (workspaceId == null) return
      const trimmed = name.trim()
      if (trimmed.length === 0) return
      await window.api.folders.rename(workspaceId, id, trimmed)
      await refresh()
    },
    [workspaceId, refresh],
  )

  const deleteFolder = useCallback(
    async (id: number) => {
      if (workspaceId == null) return
      await window.api.folders.delete(workspaceId, id)
      await refresh()
    },
    [workspaceId, refresh],
  )

  const moveDocument = useCallback(
    async (documentId: number, folderId: number | null) => {
      if (workspaceId == null) return
      await window.api.folders.setDocumentFolder(workspaceId, documentId, folderId)
      await refresh()
    },
    [workspaceId, refresh],
  )

  return { folders, assignments, refresh, createFolder, renameFolder, deleteFolder, moveDocument }
}

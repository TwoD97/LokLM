import type { AuthService } from '../auth/AuthService'
import type { Workspace } from '../../db/schema'

const NAME_MIN = 1
const NAME_MAX = 128

export class WorkspaceService {
  constructor(private readonly auth: AuthService) {}

  async list(): Promise<Workspace[]> {
    return this.auth.requireDatabase().workspaces().list()
  }

  async create(name: string): Promise<Workspace> {
    this.validateName(name)
    const ws = await this.auth.requireDatabase().workspaces().create(name.trim())
    // ADR-0005: register the manifest entry (mints the per-workspace WDEK) so the
    // encrypted vector store + default-workspace picker know about it immediately.
    await this.auth.getWorkspaceStore().ensure(ws.id, ws.name)
    return ws
  }

  async rename(id: number, name: string): Promise<void> {
    this.validateName(name)
    await this.auth.requireDatabase().workspaces().rename(id, name.trim())
  }

  async delete(id: number): Promise<void> {
    await this.auth.requireDatabase().workspaces().delete(id)
    // ADR-0005: drop the encrypted vector dir + manifest entry. Best-effort —
    // the relational delete already succeeded; a missing manifest entry is fine.
    try {
      await this.auth.getWorkspaceStore().delete(id)
    } catch {
      /* workspace had no manifest entry yet — nothing to clean up */
    }
  }

  /** The workspace auto-loaded on unlock (ADR-0005), or null for the picker. */
  async getDefault(): Promise<number | null> {
    return this.auth.getWorkspaceStore().getDefaultWorkspaceId()
  }

  /** Sets (or clears) the default workspace. Ensures the manifest entry exists
   *  first so a never-indexed workspace can still be made default. */
  async setDefault(id: number | null): Promise<void> {
    if (id != null) {
      const ws = (await this.list()).find((w) => w.id === id)
      if (!ws) throw new Error(`workspace ${id} not found`)
      await this.auth.getWorkspaceStore().ensure(id, ws.name)
    }
    await this.auth.getWorkspaceStore().setDefault(id)
  }

  private validateName(name: string): void {
    const trimmed = name?.trim() ?? ''
    if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
      throw new Error(`Workspace name must be ${NAME_MIN}-${NAME_MAX} chars`)
    }
  }
}

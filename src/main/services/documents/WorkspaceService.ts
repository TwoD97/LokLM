import type { AuthService } from '../auth/AuthService'
import type { Workspace } from '../../../shared/documents'

const NAME_MIN = 1
const NAME_MAX = 128

export class WorkspaceService {
  constructor(private readonly auth: AuthService) {}

  async list(): Promise<Workspace[]> {
    return this.auth.requireDatabase().workspaces().list()
  }

  async create(name: string): Promise<Workspace> {
    this.validateName(name)
    // ADR-0005: the workspaces() API is the VaultManifest now — create() mints
    // the per-workspace WDEK and records the manifest entry directly. The
    // on-disk encrypted SQLite + Lance stores materialise lazily on first open.
    return this.auth.requireDatabase().workspaces().create(name.trim())
  }

  async rename(id: number, name: string): Promise<void> {
    this.validateName(name)
    await this.auth.requireDatabase().workspaces().rename(id, name.trim())
  }

  async delete(id: number): Promise<void> {
    // Drops the manifest entry + the encrypted workspace directory.
    await this.auth.requireDatabase().workspaces().delete(id)
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

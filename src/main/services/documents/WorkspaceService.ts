import type { AuthService } from '../auth/AuthService'
import type { Workspace } from '../../../shared/documents'
import type { WorkspaceStorageFootprint } from '../../../shared/workspaceStorage'

const NAME_MIN = 1
const NAME_MAX = 128

export class WorkspaceService {
  constructor(private readonly auth: AuthService) {}

  async list(): Promise<Workspace[]> {
    return this.auth.requireDatabase().workspaces().list()
  }

  async create(name: string, opts?: { encrypted?: boolean }): Promise<Workspace> {
    this.validateName(name)
    // ADR-0005: the workspaces() API is the VaultManifest now — create() mints
    // the per-workspace WDEK and records the manifest entry directly. The
    // on-disk encrypted SQLite + Lance stores materialise lazily on first open.
    // `encrypted` (default true) fixes the vector store's at-rest encryption at
    // creation; see WorkspaceStore.create.
    return this.auth.requireDatabase().workspaces().create(name.trim(), opts)
  }

  async rename(id: number, name: string): Promise<void> {
    this.validateName(name)
    await this.auth.requireDatabase().workspaces().rename(id, name.trim())
  }

  async delete(id: number): Promise<void> {
    // Drops the manifest entry + the encrypted workspace directory.
    await this.auth.requireDatabase().workspaces().delete(id)
  }

  /** Measured + estimated on-disk storage footprint of a workspace (ADR-0005),
   *  surfaced to the user for transparency. Stats enc/ + meta.db; no decrypt. */
  async getStorageEstimate(id: number): Promise<WorkspaceStorageFootprint> {
    return this.auth.getWorkspaceStore().storageFootprint(id)
  }

  /** The workspace auto-loaded on unlock (ADR-0005), or null for the picker.
   *  A vault with a single workspace has no meaningful picker choice, so the
   *  sole workspace is promoted to the default here: unlock then auto-activates
   *  it instead of stranding the user on the picker with no active workspace
   *  (which would also leave background folder-sync with nowhere to write). This
   *  covers both a fresh single-workspace vault and the "deleted the former
   *  default, one survivor remains" case, where the stored default is null. */
  async getDefault(): Promise<number | null> {
    const store = this.auth.getWorkspaceStore()
    const explicit = store.getDefaultWorkspaceId()
    if (explicit != null) return explicit
    const all = store.list()
    if (all.length === 1) {
      const sole = all[0]!.id
      await store.setDefault(sole)
      return sole
    }
    return null
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

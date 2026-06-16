import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { secureWipe } from '../auth/secureMemory'
import { createWorkspaceKey, unwrapWorkspaceKey } from '../auth/workspaceKeys'
import { EncryptedWorkspaceDir } from './encryptedWorkspaceDir'
import { LanceWorkspaceStore } from './LanceWorkspaceStore'
import { WorkspaceDb } from '../../db/sqlite/WorkspaceDb'
import type { VectorStore } from './VectorStore'
import {
  emptyManifest,
  resolveDefaultWorkspace,
  suggestIndexConfig,
  type VaultManifest,
  type WorkspaceManifestEntry,
} from '../../../shared/workspaceStorage'

// Per-workspace lifecycle orchestrator (ADR-0005).
//
// Owns the VaultManifest (which workspaces exist, the default, each wrapped
// WDEK) and the single currently-open workspace. Opening a workspace unwraps
// only that workspace's WDEK, decrypts its files into a plaintext working dir,
// and opens a LanceDB store on them; closing re-encrypts and wipes. Only one
// workspace is open at a time, so resident memory tracks the largest single
// workspace, not the whole corpus.
//
// The master DEK is supplied by AuthService for the live session. The manifest
// lives inside the encrypted vault body; AuthService injects load/persist so
// this class stays storage-only and unit-testable with a plain callback.

const EMBED_DIMS = 1024 // BGE-M3

// Two open costs, two lifetimes (ADR-0005):
//  - meta.db (encrypted SQLite/SQLCipher): cheap to open (file handle + key, no
//    materialisation). Several can be open at once, so background folder-sync can
//    write text into any workspace. Kept in `metaDbs`, closed on lock.
//  - LanceDB vectors: expensive (decrypt-on-open materialises enc/→work/). Bound
//    to the single `active` workspace; switching deactivates the previous one.

interface ActiveWorkspace {
  id: number
  encDir: EncryptedWorkspaceDir
  store: LanceWorkspaceStore
}

export interface WorkspaceStoreDeps {
  /** Root dir for per-workspace data, e.g. <userData>/workspaces. */
  baseDir: string
  /** Live session master DEK (32 bytes). WDEKs wrap/unwrap under it. */
  masterDek: Buffer
  /** Current manifest (from the decrypted vault body). */
  manifest: VaultManifest
  /** Persists the manifest back into the vault. Called after every mutation. */
  persistManifest: (manifest: VaultManifest) => Promise<void>
  /** Embedding dimensionality; defaults to BGE-M3 1024. */
  dims?: number
}

export class WorkspaceStore {
  private readonly baseDir: string
  private readonly masterDek: Buffer
  private readonly persistManifest: (m: VaultManifest) => Promise<void>
  private readonly dims: number
  private manifest: VaultManifest
  private active: ActiveWorkspace | null = null
  /** All open per-workspace SQLite handles (cheap), keyed by workspace id, with
   *  the unwrapped WDEK to wipe on close. Outlives workspace switches; cleared
   *  on lock. */
  private readonly metaDbs = new Map<number, { db: WorkspaceDb; wdek: Buffer }>()

  constructor(deps: WorkspaceStoreDeps) {
    this.baseDir = deps.baseDir
    this.masterDek = deps.masterDek
    this.manifest = deps.manifest
    this.persistManifest = deps.persistManifest
    this.dims = deps.dims ?? EMBED_DIMS
  }

  list(): WorkspaceManifestEntry[] {
    return this.manifest.workspaces
  }

  getDefaultWorkspaceId(): number | null {
    return this.manifest.defaultWorkspaceId
  }

  activeWorkspaceId(): number | null {
    return this.active?.id ?? null
  }

  /** Creates a new workspace: mints a WDEK, records the manifest entry. The
   *  on-disk dir + Lance table are created lazily when first opened/written. */
  async create(name: string): Promise<WorkspaceManifestEntry> {
    const id = this.manifest.workspaces.reduce((m, w) => Math.max(m, w.id), 0) + 1
    const { wdek, wrapped } = createWorkspaceKey(this.masterDek)
    secureWipe(wdek) // not opening yet; the wrapped form is what we persist
    const entry: WorkspaceManifestEntry = {
      id,
      name,
      createdAt: Math.floor(Date.now() / 1000),
      encryptionLevel: 'full',
      dir: `ws-${id}`,
      wrappedKey: wrapped,
      vectorCount: 0,
      indexConfig: suggestIndexConfig(this.dims, 0),
    }
    this.manifest.workspaces.push(entry)
    if (this.manifest.defaultWorkspaceId == null) this.manifest.defaultWorkspaceId = id
    await this.persistManifest(this.manifest)
    return entry
  }

  /** Ensures a manifest entry with the given id exists (mirroring an app
   *  workspace from the relational DB), minting a WDEK on first sight. Idempotent
   *  — only persists when it actually creates the entry. Returns the entry. */
  async ensure(id: number, name: string): Promise<WorkspaceManifestEntry> {
    const existing = this.manifest.workspaces.find((w) => w.id === id)
    if (existing) return existing
    const { wdek, wrapped } = createWorkspaceKey(this.masterDek)
    secureWipe(wdek)
    const entry: WorkspaceManifestEntry = {
      id,
      name,
      createdAt: Math.floor(Date.now() / 1000),
      encryptionLevel: 'full',
      dir: `ws-${id}`,
      wrappedKey: wrapped,
      vectorCount: 0,
      indexConfig: suggestIndexConfig(this.dims, 0),
    }
    this.manifest.workspaces.push(entry)
    if (this.manifest.defaultWorkspaceId == null) this.manifest.defaultWorkspaceId = id
    await this.persistManifest(this.manifest)
    return entry
  }

  /** Opens (cheap) a workspace's encrypted SQLite store WITHOUT materialising its
   *  LanceDB vectors. Several can be open at once — used by background folder-sync
   *  + ingestion text writes for any workspace, and as the BM25/relational reader.
   *  Cached for the session; closed on lock. */
  async openMetaDb(id: number): Promise<WorkspaceDb> {
    const existing = this.metaDbs.get(id)
    if (existing) return existing.db
    const entry = this.requireEntry(id)
    const wdek = unwrapWorkspaceKey(this.masterDek, entry.wrappedKey)
    if (!wdek) throw new Error(`workspace ${id} key failed to unwrap (wrong/rotated master key?)`)
    const dir = join(this.baseDir, entry.dir)
    await fs.mkdir(dir, { recursive: true })
    let db: WorkspaceDb
    try {
      db = await WorkspaceDb.open(join(dir, 'meta.db'), wdek.toString('hex'), id)
    } catch (err) {
      secureWipe(wdek)
      throw err
    }
    this.metaDbs.set(id, { db, wdek })
    return db
  }

  /** Opens a workspace's vector store (materialises LanceDB), making it the
   *  single `active` workspace; deactivates any previous one. The cheap meta.db
   *  is opened/reused alongside. Returns its VectorStore. */
  async open(id: number): Promise<VectorStore> {
    if (this.active?.id === id) return this.active.store
    if (this.active) await this.deactivate()

    // ensure the (cheap) meta db is open; reuse its unwrapped WDEK for LanceDB.
    await this.openMetaDb(id)
    const wdek = this.metaDbs.get(id)!.wdek
    const entry = this.requireEntry(id)

    const encDir = new EncryptedWorkspaceDir(join(this.baseDir, entry.dir), wdek)
    const datasetDir = await encDir.open()
    if (encDir.recovered) {
      // Corrupt enc store was quarantined; vectors will be re-embedded from the
      // workspace's chunk text (WorkspaceVectorService.reconcileOnOpen). Reset the
      // cached count so the manifest reflects the empty-then-rebuilt store.
      entry.vectorCount = 0
      console.warn(`[workspace ${id}] recovered from a corrupt vector store`)
    }
    const store = new LanceWorkspaceStore({
      workspaceId: id,
      config: entry.indexConfig,
      datasetDir,
    })
    await store.open()
    this.active = { id, encDir, store }
    return store
  }

  /** The relational/FTS store for `id` (cheap meta open). Alias kept for callers. */
  async openDb(id: number): Promise<WorkspaceDb> {
    return this.openMetaDb(id)
  }

  /** The active workspace's relational store, or null when none is active. */
  currentDb(): WorkspaceDb | null {
    return this.active ? (this.metaDbs.get(this.active.id)?.db ?? null) : null
  }

  /** Opens the default workspace (configured → newest → none). Null if there
   *  are no workspaces yet. */
  async openDefault(): Promise<VectorStore | null> {
    const entry = resolveDefaultWorkspace(this.manifest)
    if (!entry) return null
    return this.open(entry.id)
  }

  /** Keeps the manifest entry's display name in sync with a relational rename.
   *  No-op if there's no entry yet (it'll pick up the name on first ensure). */
  async rename(id: number, name: string): Promise<void> {
    const entry = this.manifest.workspaces.find((w) => w.id === id)
    if (!entry || entry.name === name) return
    entry.name = name
    await this.persistManifest(this.manifest)
  }

  /** Sets the auto-load default workspace. */
  async setDefault(id: number | null): Promise<void> {
    if (id != null) this.requireEntry(id)
    this.manifest.defaultWorkspaceId = id
    await this.persistManifest(this.manifest)
  }

  /** The open workspace's store, or null when none is open. */
  current(): VectorStore | null {
    return this.active?.store ?? null
  }

  /** Deactivates the active workspace's VECTOR store: refresh its count,
   *  re-encrypt its Lance files, wipe the plaintext copy. The meta.db stays open
   *  (cheap). `discard` skips the re-encrypt (e.g. workspace deletion). */
  private async deactivate(opts: { discard?: boolean } = {}): Promise<void> {
    const a = this.active
    if (!a) return
    this.active = null
    if (!opts.discard) {
      const entry = this.manifest.workspaces.find((w) => w.id === a.id)
      if (entry) entry.vectorCount = await a.store.count()
    }
    await a.store.close()
    await a.encDir.close({ ...(opts.discard ? { discard: true } : {}) })
    if (!opts.discard) await this.persistManifest(this.manifest)
  }

  /** Full teardown (lock/logout): deactivate the vector store and close every
   *  open meta.db, wiping all WDEKs. */
  async close(opts: { discard?: boolean } = {}): Promise<void> {
    await this.deactivate(opts)
    for (const { db, wdek } of this.metaDbs.values()) {
      try {
        db.close()
      } finally {
        secureWipe(wdek)
      }
    }
    this.metaDbs.clear()
  }

  /** Deletes a workspace: closes its stores, removes its directory + manifest
   *  entry, and clears the default if it pointed here. */
  async delete(id: number): Promise<void> {
    const entry = this.requireEntry(id)
    if (this.active?.id === id) await this.deactivate({ discard: true })
    const meta = this.metaDbs.get(id)
    if (meta) {
      try {
        meta.db.close()
      } finally {
        secureWipe(meta.wdek)
      }
      this.metaDbs.delete(id)
    }
    await fs.rm(join(this.baseDir, entry.dir), { recursive: true, force: true })
    this.manifest.workspaces = this.manifest.workspaces.filter((w) => w.id !== id)
    if (this.manifest.defaultWorkspaceId === id) this.manifest.defaultWorkspaceId = null
    await this.persistManifest(this.manifest)
  }

  /** Builds/refreshes the active workspace's ANN index using a size-appropriate
   *  config (call after a bulk load). */
  async buildActiveIndex(): Promise<void> {
    const a = this.active
    if (!a) return
    const entry = this.manifest.workspaces.find((w) => w.id === a.id)
    const rows = await a.store.count()
    const config = suggestIndexConfig(this.dims, rows)
    if (entry) entry.indexConfig = config
    await a.store.buildIndex(config)
    if (entry) await this.persistManifest(this.manifest)
  }

  private requireEntry(id: number): WorkspaceManifestEntry {
    const entry = this.manifest.workspaces.find((w) => w.id === id)
    if (!entry) throw new Error(`workspace ${id} not found in manifest`)
    return entry
  }
}

export { emptyManifest }

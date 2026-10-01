import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { secureWipe } from '../auth/secureMemory'
import { createWorkspaceKey, unwrapWorkspaceKey } from '../auth/workspaceKeys'
import { EncryptedWorkspaceDir } from './encryptedWorkspaceDir'
import { LanceWorkspaceStore } from './LanceWorkspaceStore'
import { WorkspaceDb } from '../../db/sqlite/WorkspaceDb'
import { CODE_EMBEDDING_DIM } from '../codebase/codeEmbedder'
import type { VectorStore } from './VectorStore'
import {
  emptyManifest,
  estimateWorkspaceFootprint,
  isWorkspaceEncrypted,
  resolveDefaultWorkspace,
  suggestIndexConfig,
  DEFAULT_WORKSPACE_TYPE,
  type VaultManifest,
  type WorkspaceManifestEntry,
  type WorkspaceStorageFootprint,
  type WorkspaceType,
} from '../../../shared/workspaceStorage'

// Per-workspace lifecycle orchestrator (ADR-0005).
//
// Owns the VaultManifest (which workspaces exist, the default, each wrapped
// WDEK) and the single resident vector store. Opening vectors unwraps
// only that workspace's WDEK, decrypts its files into a plaintext working dir,
// and opens a LanceDB store on them; closing re-encrypts and wipes. Only one
// vector store is open at a time, so resident memory tracks the largest single
// workspace, not the whole corpus. Explicit selection is separate: background
// indexing/retrieval may load another vector store without redirecting local IDs.
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
  private nextWorkspaceId: number
  /** User selection is independent of the vector store temporarily resident for
   * background indexing/retrieval. Local relational IDs route through this. */
  private selectedWorkspaceId: number | null = null
  private active: ActiveWorkspace | null = null
  /** All open per-workspace SQLite handles (cheap), keyed by workspace id, with
   *  the unwrapped WDEK to wipe on close. Outlives workspace switches; cleared
   *  on lock. */
  private readonly metaDbs = new Map<number, { db: WorkspaceDb; wdek: Buffer }>()
  private readonly pendingMetaDbs = new Map<number, Promise<WorkspaceDb>>()
  private readonly deleting = new Set<number>()
  private vectorOperations: Promise<void> = Promise.resolve()
  private closed = false
  private closing: Promise<void> | null = null

  constructor(deps: WorkspaceStoreDeps) {
    this.baseDir = deps.baseDir
    this.masterDek = deps.masterDek
    this.manifest = deps.manifest
    // Retired background jobs can still carry their workspace ID until they
    // observe cancellation. Do not give that ID to another workspace this session.
    this.nextWorkspaceId =
      deps.manifest.workspaces.reduce((max, entry) => Math.max(max, entry.id), 0) + 1
    this.persistManifest = deps.persistManifest
    this.dims = deps.dims ?? EMBED_DIMS
  }

  list(): WorkspaceManifestEntry[] {
    this.assertOpen()
    return this.manifest.workspaces
  }

  getDefaultWorkspaceId(): number | null {
    this.assertOpen()
    return this.manifest.defaultWorkspaceId
  }

  activeWorkspaceId(): number | null {
    return this.selectedWorkspaceId
  }

  /** Measured + estimated on-disk footprint of a workspace (transparency
   *  feature). Stats the Lance vector store and the SQLCipher meta.db — file
   *  metadata only, never decrypts. The vector count is live for the active
   *  workspace, last-known (manifest) otherwise. Open-size + decrypt-on-open
   *  time are derived in estimateWorkspaceFootprint. */
  async storageFootprint(id: number): Promise<WorkspaceStorageFootprint> {
    this.assertOpen(id)
    const entry = this.requireEntry(id)
    const dir = join(this.baseDir, entry.dir)
    const active = this.active
    const isActive = active != null && active.id === id
    // Live vector bytes: while a workspace is ACTIVE its current Lance data lives
    // in the plaintext work/ copy, and enc/ holds only the last-PERSISTED state —
    // which is stale, or empty on a just-created workspace that was never
    // deactivated. Reading enc/ alone therefore under-reports a freshly-ingested
    // workspace to ~0 (making "on disk" == "when open" and open-time ≈ 0). When
    // inactive, work/ is wiped and enc/ is authoritative. Take whichever is
    // populated; fall back to estimating from the vector count if neither is.
    const encrypted = isWorkspaceEncrypted(entry)
    // Unencrypted: work/ is the persistent store (no enc/), so it is the
    // authoritative size whether or not the workspace is active. Encrypted: enc/
    // is authoritative at rest; while active, work/ holds the live (post-ingest)
    // state and enc/ is stale, so take whichever is populated.
    const vectorBytes = encrypted
      ? Math.max(
          await this.dirSize(join(dir, 'enc')),
          isActive ? await this.dirSize(join(dir, 'work')) : 0,
        )
      : await this.dirSize(join(dir, 'work'))
    const metaDbBytes = await fs
      .stat(join(dir, 'meta.db'))
      .then((s) => s.size)
      .catch(() => 0)
    const vectorCount = await this.enqueueVectorOperation(async () => {
      this.assertOpen(id)
      return this.active?.id === id ? this.active.store.count() : entry.vectorCount
    })
    this.assertOpen(id)
    return estimateWorkspaceFootprint({
      workspaceId: id,
      vectorBytes: vectorBytes > 0 ? vectorBytes : null,
      metaDbBytes,
      vectorCount,
      dims: entry.indexConfig.dims,
      encrypted,
    })
  }

  /** Recursively sums file sizes under `dir` (file metadata only — no decrypt).
   *  Returns 0 for a missing dir (e.g. a workspace whose store isn't persisted
   *  yet). */
  private async dirSize(dir: string): Promise<number> {
    const entries = await fs
      .readdir(dir, { withFileTypes: true })
      .catch(() => [] as import('node:fs').Dirent[])
    let total = 0
    for (const e of entries) {
      const p = join(dir, e.name)
      total += e.isDirectory()
        ? await this.dirSize(p)
        : await fs
            .stat(p)
            .then((s) => s.size)
            .catch(() => 0)
    }
    return total
  }

  /** Creates a new workspace: mints a WDEK, records the manifest entry. The
   *  on-disk dir + Lance table are created lazily when first opened/written.
   *  `encrypted` (default true) is fixed at creation: when false the vector
   *  store is kept plaintext at rest for an instant open + half the disk; the
   *  meta.db is still encrypted under the WDEK either way. */
  async create(name: string, opts: { encrypted?: boolean } = {}): Promise<WorkspaceManifestEntry> {
    this.assertOpen()
    const id = this.nextWorkspaceId++
    const { wdek, wrapped } = createWorkspaceKey(this.masterDek)
    secureWipe(wdek) // not opening yet; the wrapped form is what we persist
    const entry: WorkspaceManifestEntry = {
      id,
      name,
      createdAt: Math.floor(Date.now() / 1000),
      encryptionLevel: opts.encrypted === false ? 'none' : 'full',
      type: DEFAULT_WORKSPACE_TYPE,
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
    this.assertOpen(id)
    const existing = this.manifest.workspaces.find((w) => w.id === id)
    if (existing) return existing
    this.nextWorkspaceId = Math.max(this.nextWorkspaceId, id + 1)
    const { wdek, wrapped } = createWorkspaceKey(this.masterDek)
    secureWipe(wdek)
    const entry: WorkspaceManifestEntry = {
      id,
      name,
      createdAt: Math.floor(Date.now() / 1000),
      encryptionLevel: 'full',
      type: DEFAULT_WORKSPACE_TYPE,
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
    this.assertOpen(id)
    const existing = this.metaDbs.get(id)
    if (existing) return existing.db
    const pending = this.pendingMetaDbs.get(id)
    if (pending) return pending
    const opening = this.openMetaDbUncached(id)
    this.pendingMetaDbs.set(id, opening)
    try {
      return await opening
    } finally {
      if (this.pendingMetaDbs.get(id) === opening) this.pendingMetaDbs.delete(id)
    }
  }

  private async openMetaDbUncached(id: number): Promise<WorkspaceDb> {
    const entry = this.requireEntry(id)
    const wdek = unwrapWorkspaceKey(this.masterDek, entry.wrappedKey)
    if (!wdek) throw new Error(`workspace ${id} key failed to unwrap (wrong/rotated master key?)`)
    const dir = join(this.baseDir, entry.dir)
    let db: WorkspaceDb | undefined
    try {
      await fs.mkdir(dir, { recursive: true })
      this.assertOpen(id)
      db = await WorkspaceDb.open(join(dir, 'meta.db'), wdek.toString('hex'), id)
      this.assertOpen(id)
      this.metaDbs.set(id, { db, wdek })
      return db
    } catch (err) {
      try {
        db?.close()
      } finally {
        secureWipe(wdek)
      }
      throw err
    }
  }

  /** Explicitly selects a workspace once its SQLite and vector stores are open.
   *  Background vector operations use withVectorStore without changing selection. */
  open(id: number): Promise<VectorStore> {
    return this.enqueueVectorOperation(async () => {
      const vectors = await this.openVectors(id)
      this.assertOpen(id)
      this.selectedWorkspaceId = id
      return vectors
    })
  }

  /** Pin both stores for an entire vector operation. Activation/deletion/lock
   * waits for this callback, rather than closing the store after open() returns
   * while a caller is still reconciling, querying or writing native data. */
  withVectorStore<T>(
    id: number,
    operation: (vectors: VectorStore, metadata: WorkspaceDb) => Promise<T>,
  ): Promise<T> {
    return this.enqueueVectorOperation(async () => {
      const vectors = await this.openVectors(id)
      this.assertOpen(id)
      const metadata = this.metaDbs.get(id)!.db
      return operation(vectors, metadata)
    })
  }

  private async openVectors(id: number): Promise<VectorStore> {
    this.assertOpen(id)
    if (this.active?.id === id) return this.active.store
    if (this.active) await this.deactivate()
    this.assertOpen(id)

    // ensure the (cheap) meta db is open; reuse its unwrapped WDEK for LanceDB.
    await this.openMetaDb(id)
    this.assertOpen(id)
    const wdek = this.metaDbs.get(id)!.wdek
    const entry = this.requireEntry(id)

    const encDir = new EncryptedWorkspaceDir(join(this.baseDir, entry.dir), wdek, {
      encrypted: isWorkspaceEncrypted(entry),
    })
    let store: LanceWorkspaceStore | undefined
    try {
      const datasetDir = await encDir.open()
      this.assertOpen(id)
      if (encDir.recovered) {
        // Corrupt enc store was quarantined; vectors will be re-embedded from the
        // workspace's chunk text (WorkspaceVectorService.reconcileOnOpen). Reset the
        // cached count so the manifest reflects the empty-then-rebuilt store.
        entry.vectorCount = 0
        console.warn(`[workspace ${id}] recovered from a corrupt vector store`)
      }
      store = new LanceWorkspaceStore({
        workspaceId: id,
        config: entry.indexConfig,
        datasetDir,
      })
      await store.open()
      this.assertOpen(id)
      this.active = { id, encDir, store }
      return store
    } catch (error) {
      // A lock/delete may have begun during decryption or native open. Release
      // this unpublished handle before close() is allowed to wipe its WDEK.
      try {
        await store?.close()
      } finally {
        await encDir.close()
      }
      throw error
    }
  }

  /** The relational/FTS store for `id` (cheap meta open). Alias kept for callers. */
  async openDb(id: number): Promise<WorkspaceDb> {
    return this.openMetaDb(id)
  }

  /** The selected workspace's relational store, independent of vector residency. */
  currentDb(): WorkspaceDb | null {
    const id = this.selectedWorkspaceId
    if (this.closed || id === null || this.deleting.has(id)) return null
    return this.metaDbs.get(id)?.db ?? null
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
    this.assertOpen(id)
    const entry = this.manifest.workspaces.find((w) => w.id === id)
    if (!entry || entry.name === name) return
    entry.name = name
    await this.persistManifest(this.manifest)
  }

  /** Sets a workspace's type (ADR-0006). Called after folder-sync classification
   *  flips a workspace to 'codebase', or when the user overrides it. Also retunes
   *  the recorded index config to the type's embedding dimension (jina-code 896 vs
   *  BGE-M3 1024); the on-disk Lance table dim is inferred from the actual vectors,
   *  so this only keeps the manifest's index params honest. */
  async setType(id: number, type: WorkspaceType): Promise<void> {
    this.assertOpen(id)
    const entry = this.requireEntry(id)
    if (entry.type === type) return
    entry.type = type
    const dim = type === 'codebase' ? CODE_EMBEDDING_DIM : this.dims
    entry.indexConfig = suggestIndexConfig(dim, entry.vectorCount)
    await this.persistManifest(this.manifest)
  }

  /** Sets the auto-load default workspace. */
  async setDefault(id: number | null): Promise<void> {
    this.assertOpen(id ?? undefined)
    if (id != null) this.requireEntry(id)
    this.manifest.defaultWorkspaceId = id
    await this.persistManifest(this.manifest)
  }

  /** The open workspace's store, or null when none is open. */
  current(): VectorStore | null {
    return this.closed ? null : (this.active?.store ?? null)
  }

  /** Deactivates the active workspace's VECTOR store: refresh its count,
   *  re-encrypt its Lance files, wipe the plaintext copy. The meta.db stays open
   *  (cheap). `discard` skips the re-encrypt (e.g. workspace deletion). */
  private async deactivate(opts: { discard?: boolean } = {}): Promise<void> {
    const a = this.active
    if (!a) return
    this.active = null
    const errors: unknown[] = []
    try {
      if (!opts.discard) {
        const entry = this.manifest.workspaces.find((w) => w.id === a.id)
        if (entry) entry.vectorCount = await a.store.count()
      }
    } catch (error) {
      errors.push(error)
    }
    try {
      await a.store.close()
    } catch (error) {
      errors.push(error)
    }
    try {
      await a.encDir.close({ ...(opts.discard ? { discard: true } : {}) })
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw new AggregateError(errors, 'Workspace deactivation failed.')
    if (!opts.discard) await this.persistManifest(this.manifest)
  }

  /** Full teardown (lock/logout): deactivate the vector store and close every
   *  open meta.db, wiping all WDEKs. */
  close(opts: { discard?: boolean } = {}): Promise<void> {
    if (this.closing) return this.closing
    // Close admission synchronously, before any native/FS await. A fresh login
    // creates a new WorkspaceStore; this instance can never reopen old keys.
    this.closed = true
    this.selectedWorkspaceId = null
    this.closing = (async () => {
      await this.vectorOperations
      await Promise.allSettled(this.pendingMetaDbs.values())
      const errors: unknown[] = []
      try {
        await this.deactivate(opts)
      } catch (error) {
        errors.push(error)
      }
      for (const { db, wdek } of this.metaDbs.values()) {
        try {
          db.close()
        } catch (error) {
          errors.push(error)
        } finally {
          secureWipe(wdek)
        }
      }
      this.metaDbs.clear()
      if (errors.length) throw new AggregateError(errors, 'Workspace session cleanup failed.')
    })()
    return this.closing
  }

  /** Deletes a workspace: closes its stores, removes its directory + manifest
   *  entry, and clears the default if it pointed here. */
  async delete(id: number): Promise<void> {
    this.assertOpen(id)
    const entry = this.requireEntry(id)
    this.deleting.add(id)
    if (this.selectedWorkspaceId === id) this.selectedWorkspaceId = null
    try {
      await this.enqueueVectorOperation(async () => {
        await this.pendingMetaDbs.get(id)?.catch(() => undefined)
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
      })
    } finally {
      this.deleting.delete(id)
    }
  }

  /** Builds/refreshes the active workspace's ANN index using a size-appropriate
   *  config (call after a bulk load). */
  async buildActiveIndex(): Promise<void> {
    this.assertOpen()
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

  private assertOpen(id?: number): void {
    if (this.closed) throw new Error('Workspace session is closed.')
    if (id !== undefined && this.deleting.has(id))
      throw new Error(`Workspace ${id} is being deleted.`)
  }

  private enqueueVectorOperation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.vectorOperations.then(() => {
      this.assertOpen()
      return operation()
    })
    this.vectorOperations = run.then(
      () => {},
      () => {},
    )
    return run
  }
}

export { emptyManifest }

// Shared types for the per-workspace, disk-scaled, encrypted storage model
// (ADR-0005). Lives in shared/ because the manifest shape and the
// encryption-level enum are referenced by main (storage + auth), preload (IPC
// surface), and renderer (settings: default-workspace picker, per-workspace
// encryption badge).

/**
 * Per-workspace encryption level (chosen at creation; immutable afterwards).
 *
 *  - `'full'`  — the default (ADR-0005): the workspace's vector store is
 *    block-encrypted at rest and decrypted into a plaintext working copy only
 *    while the workspace is open.
 *  - `'none'`  — the vector store stays plaintext on disk. Trades at-rest
 *    confidentiality of the embeddings for an instant unlock (no decrypt-on-open
 *    pass) and half the disk (no enc/ + work/ duplication) — see
 *    estimateWorkspaceFootprint. The relational/text store (meta.db, SQLCipher)
 *    stays encrypted regardless, so document text is never written in the clear;
 *    only the derived vector index is. Opt-in for large, non-sensitive corpora
 *    on a trusted machine.
 */
export type EncryptionLevel = 'full' | 'none'

export const DEFAULT_ENCRYPTION_LEVEL: EncryptionLevel = 'full'

/** Whether `entry`'s vector store is encrypted at rest. Centralised so callers
 *  agree on the meaning of the level and pre-ADR-0005 entries (no level) default
 *  to encrypted. */
export function isWorkspaceEncrypted(entry: { encryptionLevel?: EncryptionLevel }): boolean {
  return (entry.encryptionLevel ?? DEFAULT_ENCRYPTION_LEVEL) !== 'none'
}

/**
 * Workspace type (ADR-0006). A `library` workspace indexes documents (PDFs,
 * notes) as today; a `codebase` workspace syncs a source-code project folder and
 * indexes code and docs/info on SEPARATE tracks (AST-aware code chunks vs prose).
 * The type is auto-classified when a folder is synced (marker files + language
 * heuristics) and can be overridden by the user.
 */
export type WorkspaceType = 'library' | 'codebase'

export const DEFAULT_WORKSPACE_TYPE: WorkspaceType = 'library'

/** Vector-index build parameters per workspace (IVF-PQ / RaBitQ family). Stored
 *  so a workspace's index can be rebuilt deterministically and so the active
 *  config is visible without opening the index. Tuned by workspace size — see
 *  ADR-0005 §Indexparameter. */
export interface VectorIndexConfig {
  /** Distance metric. BGE-M3 embeddings are cosine-normalised. */
  metric: 'cosine'
  /** Embedding dimensionality (BGE-M3 = 1024). */
  dims: number
  /** IVF partition count. Rule of thumb ≈ sqrt(rowCount), clamped. */
  numPartitions: number
  /** PQ sub-vector count (bytes per compressed vector). 0 ⇒ no PQ (small WS). */
  numSubVectors: number
}

/** One workspace's entry in the vault manifest. */
export interface WorkspaceManifestEntry {
  id: number
  name: string
  createdAt: number
  encryptionLevel: EncryptionLevel
  /** Workspace type (ADR-0006). Absent on pre-ADR-0006 manifests ⇒ treat as
   *  'library' (see workspaceTypeOf). */
  type?: WorkspaceType
  /** Directory (relative to the workspaces root) holding this workspace's
   *  block-encrypted Lance dataset + metadata DB. */
  dir: string
  /** Wrapped per-workspace data key (WDEK), encrypted under the master DEK.
   *  Shape is WrappedWorkspaceKey from main/services/auth/workspaceKeys; typed
   *  loosely here to keep shared/ free of node:crypto imports. */
  wrappedKey: { nonce: string; ciphertext: string }
  /** Last-known vector count — cheap stat for the UI + index sizing. */
  vectorCount: number
  indexConfig: VectorIndexConfig
}

/** The vault manifest: the small, always-loaded index of which workspaces
 *  exist, which one is the default, and how to unlock each. Persisted inside
 *  the encrypted vault body (so it inherits the vault's confidentiality) and
 *  read in full on unlock — it is tiny regardless of corpus size. */
export interface VaultManifest {
  version: 1
  /** Workspace opened automatically on unlock; null ⇒ show the picker. */
  defaultWorkspaceId: number | null
  workspaces: WorkspaceManifestEntry[]
}

export function emptyManifest(): VaultManifest {
  return { version: 1, defaultWorkspaceId: null, workspaces: [] }
}

/** Reads a manifest entry's workspace type, defaulting to 'library' for entries
 *  written before ADR-0006 (the field is optional for back-compat). */
export function workspaceTypeOf(entry: { type?: WorkspaceType }): WorkspaceType {
  return entry.type ?? DEFAULT_WORKSPACE_TYPE
}

/** Picks the workspace to auto-load on unlock: the configured default if it
 *  still exists, else the most recently created, else null (nothing to open). */
export function resolveDefaultWorkspace(m: VaultManifest): WorkspaceManifestEntry | null {
  if (m.defaultWorkspaceId != null) {
    const hit = m.workspaces.find((w) => w.id === m.defaultWorkspaceId)
    if (hit) return hit
  }
  if (m.workspaces.length === 0) return null
  return m.workspaces.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
}

// ---------------------------------------------------------------------------
// Storage footprint (transparency feature). Surfaces "how heavy is this
// workspace, and what does opening it cost" to the user. The at-rest sizes are
// MEASURED by the caller (enc/ + meta.db exist on disk whether or not the
// workspace is open); the open-size and open-time are DERIVED here from those
// measured bytes and the constants below. Kept in shared/ so the renderer can
// reuse the same math/labels the main process computes.

/** On-disk bytes per stored vector. Measured on the storage-scale stress test
 *  (tests/evals/scale, run 2026-06-23): ~4448 B for a 1024-dim float32 vector.
 *  Breakdown: dims×4 raw vector + ~352 B of IVF-PQ codes + chunk/doc ids +
 *  columnar/manifest overhead. LanceDB keeps the FULL-precision vectors on disk
 *  (for rescoring), so the raw vector dominates — hence the dims×4 term. Used
 *  only to ESTIMATE when a workspace's enc/ isn't measurable yet (e.g. created
 *  but never persisted); a real enc/ stat always wins. */
export const VECTOR_DISK_OVERHEAD_BYTES = 352
export function estimatedBytesPerVector(dims: number): number {
  return dims * 4 + VECTOR_DISK_OVERHEAD_BYTES
}

/** Decrypt-on-open throughput, measured ~163 MB/s on the dev box NVMe. It is
 *  crypto/fs-loop-bound (64 KiB AES-256-GCM blocks, not disk-bandwidth-bound),
 *  so it's roughly disk-independent for the sequential open pass — an HDD is
 *  only modestly slower here (seek-heavy queries are the part HDDs hurt, not
 *  this). Used to estimate the per-unlock wait. */
export const DECRYPT_THROUGHPUT_BYTES_PER_SEC = 163 * 1_000_000

/** Measured + estimated storage footprint of one workspace (ADR-0005). */
export interface WorkspaceStorageFootprint {
  workspaceId: number
  /** Encrypted Lance vector store on disk (enc/) — measured, or estimated from
   *  vectorCount × bytes/vector when the store isn't persisted yet. */
  vectorBytes: number
  /** Encrypted relational/text store (meta.db, SQLCipher) — measured. */
  metaDbBytes: number
  /** vectorBytes + metaDbBytes — total encrypted-at-rest footprint. */
  atRestBytes: number
  /** While an ENCRYPTED workspace is open, decrypt-on-open materialises a
   *  plaintext copy of the Lance store (work/) next to enc/, so the vector bytes
   *  are on disk twice; meta.db (SQLCipher, per-page) does NOT double. →
   *  atRestBytes + vectorBytes. An UNENCRYPTED workspace keeps a single plaintext
   *  copy, so openBytes == atRestBytes. */
  openBytes: number
  /** Estimated decrypt-on-open wait — the whole Lance store is decrypted to
   *  plaintext on every unlock/switch (vectorBytes ÷ decrypt throughput). 0 for
   *  an unencrypted workspace (it opens in place, nothing to decrypt). */
  estDecryptOnOpenMs: number
  /** Vectors indexed (live count for the active workspace, else last-known). */
  vectorCount: number
  /** Whether the vector store is encrypted at rest (false ⇒ instant open, no
   *  disk doubling). Drives the lock/unlock badge + the open-cost copy. */
  encrypted: boolean
  /** True when vectorBytes was measured from enc/ (or the plaintext store) on
   *  disk; false when estimated from vectorCount (store not yet persisted).
   *  Drives a "~" hint in the UI. */
  measured: boolean
}

/** Pure footprint math (testable, no I/O). The caller measures `vectorBytes`
 *  (enc/ size) and `metaDbBytes` and passes them in; pass `vectorBytes: null`
 *  to estimate from vectorCount instead (store not persisted yet). */
export function estimateWorkspaceFootprint(input: {
  workspaceId: number
  vectorBytes: number | null
  metaDbBytes: number
  vectorCount: number
  dims: number
  /** Vector store encrypted at rest? Defaults to true (the ADR-0005 default).
   *  When false, opening costs no decrypt pass and the store is not duplicated. */
  encrypted?: boolean
}): WorkspaceStorageFootprint {
  const encrypted = input.encrypted ?? true
  const measured = input.vectorBytes != null && input.vectorBytes > 0
  const vectorBytes = measured
    ? input.vectorBytes!
    : input.vectorCount * estimatedBytesPerVector(input.dims)
  const atRestBytes = vectorBytes + input.metaDbBytes
  return {
    workspaceId: input.workspaceId,
    vectorBytes,
    metaDbBytes: input.metaDbBytes,
    atRestBytes,
    // Encrypted: enc/ + work/ coexist while open (vectors twice). Unencrypted:
    // one plaintext copy, so the open footprint equals the at-rest footprint.
    openBytes: encrypted ? atRestBytes + vectorBytes : atRestBytes,
    estDecryptOnOpenMs: encrypted ? (vectorBytes / DECRYPT_THROUGHPUT_BYTES_PER_SEC) * 1000 : 0,
    vectorCount: input.vectorCount,
    encrypted,
    measured,
  }
}

/** Suggests IVF-PQ parameters for a workspace of `rowCount` vectors. Centralised
 *  so the index builder and the manifest writer agree. Thresholds follow
 *  ADR-0005 §Indexparameter; conservative defaults, retune against bench. */
export function suggestIndexConfig(dims: number, rowCount: number): VectorIndexConfig {
  // Below ~50k vectors a flat (brute-force) scan beats index build/maintenance,
  // so emit a no-PQ config the builder reads as "flat".
  if (rowCount < 50_000) {
    return { metric: 'cosine', dims, numPartitions: 1, numSubVectors: 0 }
  }
  const numPartitions = Math.min(65_536, Math.max(256, Math.round(Math.sqrt(rowCount))))
  // PQ to 1 byte per ~8 dims keeps the resident codebook small while holding
  // recall with rescoring; clamp so it divides the dimensionality.
  const numSubVectors = Math.max(16, Math.min(dims, Math.floor(dims / 8)))
  return { metric: 'cosine', dims, numPartitions, numSubVectors }
}

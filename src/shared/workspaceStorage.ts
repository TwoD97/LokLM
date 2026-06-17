// Shared types for the per-workspace, disk-scaled, encrypted storage model
// (ADR-0005). Lives in shared/ because the manifest shape and the
// encryption-level enum are referenced by main (storage + auth), preload (IPC
// surface), and renderer (settings: default-workspace picker, per-workspace
// encryption badge).

/**
 * Per-workspace encryption level.
 *
 * The accepted decision in ADR-0005 is "full block-level crypto for every
 * workspace", so `'full'` is the only level the storage layer currently
 * provisions. The enum exists rather than a boolean so the field is already in
 * the manifest schema (forward-compatible) — a future `'none'` scratch level,
 * if ever justified, slots in without a manifest version bump.
 */
export type EncryptionLevel = 'full'

export const DEFAULT_ENCRYPTION_LEVEL: EncryptionLevel = 'full'

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

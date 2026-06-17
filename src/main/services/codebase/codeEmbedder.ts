import type { WorkspaceType } from '../../../shared/workspaceStorage'

// Per-workspace-type embedder selection (ADR-0006). A 'codebase' workspace embeds
// with the code-specialised model (jina-code); everything else uses the general
// BGE-M3. One model is resident at a time and a workspace's type is stable, so a
// workspace always embeds with a single, consistent model — vectors in its LanceDB
// table share one space/dimension (the table dim is inferred from the data, so
// there is no manifest-vs-model mismatch to corrupt).
//
// Fallback-safe: if the code model isn't on disk, codebase workspaces transparently
// use BGE-M3 (resolved at runtime by EmbeddingService). This module only declares
// the *intended* model per type; the actual on-disk resolution + load lives in
// EmbeddingService.

/** Manifest id of the code embedder (drives ModelDownloader.download). */
export const CODE_EMBEDDER_MODEL_ID = 'jina-code-embeddings-0.5b-Q4_K_M'

/** Filename of the bundled code embedder GGUF (matches the manifest entry). */
export const CODE_EMBEDDER_FILE = 'jina-code-embeddings-0.5b-Q4_K_M.gguf'

/** Identity written to chunks.embedder_identity for code-model vectors. The
 *  stem ('jina-code') drives the backfill's model-swap detection, exactly like
 *  'bundled:bge-m3'. */
export const CODE_EMBEDDER_IDENTITY = 'bundled:jina-code'

/** jina-code-embeddings-0.5b native output dimensionality. */
export const CODE_EMBEDDING_DIM = 896

/** Matches a code-embedder GGUF by filename (any quant). */
export function isCodeEmbedderFile(filename: string): boolean {
  return /jina[-_]?code/i.test(filename) && filename.toLowerCase().endsWith('.gguf')
}

/** True when the workspace type should prefer the code-specialised embedder. */
export function prefersCodeEmbedder(type: WorkspaceType): boolean {
  return type === 'codebase'
}

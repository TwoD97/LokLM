import type { WorkspaceType } from '../../../shared/workspaceStorage'

// Per-workspace-type embedder selection (ADR-0006). A 'codebase' workspace embeds
// with the code-specialised model (Qwen3-Embedding-0.6B); everything else uses the
// general BGE-M3. One model is resident at a time and a workspace's type is stable,
// so a workspace always embeds with a single, consistent model — vectors in its
// LanceDB table share one space/dimension (the table dim is inferred from the data,
// so there is no manifest-vs-model mismatch to corrupt).
//
// Why Qwen3-Embedding, not jina-code: jina-code (a Qwen2 *decoder* embedder)
// NATIVE-crashes the worker on the AMD iGPU Vulkan stack (0xC0000409) the moment a
// passage approaches the context window — a known, unfixed llama.cpp bug (#20098 /
// #20515) — which forced retrieval onto the slow CPU. Qwen3-Embedding-0.6B has
// equivalent code-retrieval quality AND embeds full-length passages on Vulkan with
// zero crashes (verified via tests/bench/vulkan-embed-batch.ts), so the embedder
// can finally run on the GPU. It is 1024-dim — the SAME as BGE-M3 — so the
// code/doc fallback no longer even changes dimensionality.
//
// Fallback-safe: if the code model isn't on disk, codebase workspaces transparently
// use BGE-M3 (resolved at runtime by EmbeddingService). This module only declares
// the *intended* model per type; the actual on-disk resolution + load lives in
// EmbeddingService.

/** Manifest id of the code embedder (drives ModelDownloader.download). */
export const CODE_EMBEDDER_MODEL_ID = 'Qwen3-Embedding-0.6B-Q8_0'

/** Filename of the bundled code embedder GGUF (matches the manifest entry). */
export const CODE_EMBEDDER_FILE = 'Qwen3-Embedding-0.6B-Q8_0.gguf'

/** Identity written to chunks.embedder_identity for code-model vectors. The
 *  stem ('qwen3-embedding') drives the backfill's model-swap detection, exactly
 *  like 'bundled:bge-m3' — so existing jina-code workspaces re-embed on next
 *  backfill. */
export const CODE_EMBEDDER_IDENTITY = 'bundled:qwen3-embedding'

/** Qwen3-Embedding-0.6B native output dimensionality (== BGE-M3's 1024). */
export const CODE_EMBEDDING_DIM = 1024

/**
 * Query-side instruction for the code embedder (ADR-0006, fix #1). Qwen3-Embedding
 * is instruction-tuned and expects the asymmetric `Instruct: <task>\nQuery: <q>`
 * template on the QUERY side only — documents/passages are embedded raw. Applying
 * it lifts natural-language → code alignment substantially (measured: codebase
 * eval recall@5 0.674 → 0.726, vague-query recall 0.171 → 0.286; tests/evals/code).
 *
 * The query text is appended verbatim by EmbeddingService.embedQueries. Passages
 * stay un-prefixed, so this is query-only and needs NO re-embedding of the corpus.
 * Only applied when the resident embedder IS the code model (codebase workspaces);
 * BGE-M3 / library workspaces get no instruction.
 */
export const CODE_QUERY_INSTRUCTION =
  'Instruct: Given a question about a codebase, retrieve the source code file that answers it.\nQuery: '

/** Matches a code-embedder GGUF by filename (any quant). */
export function isCodeEmbedderFile(filename: string): boolean {
  return /qwen3[-_]?embedding/i.test(filename) && filename.toLowerCase().endsWith('.gguf')
}

/** True when the workspace type should prefer the code-specialised embedder. */
export function prefersCodeEmbedder(type: WorkspaceType): boolean {
  return type === 'codebase'
}

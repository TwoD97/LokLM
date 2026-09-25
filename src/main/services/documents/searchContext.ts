/** Canonical passage input for both fresh indexing and deferred backfill.
 *
 * contextPrefix is stored separately from citable text and indexed by FTS.
 * Keep this byte-for-byte compatible with existing vectors: adding title or
 * section prefixes needs a versioned index rollout, not a backfill-only edit.
 */
export function documentEmbeddingInput(text: string, contextPrefix?: string | null): string {
  return contextPrefix ? `${contextPrefix}\n${text}` : text
}

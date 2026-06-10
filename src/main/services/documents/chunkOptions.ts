/**
 * Resolves the effective chunk options for an ingest run from the AP-9
 * indexing settings (`retrieval.chunkSize` / `retrieval.chunkOverlap`).
 *
 * Precedence: an explicit per-import value wins; otherwise the user's
 * configured defaults apply; if neither is present the value stays `undefined`
 * so the chunker falls back to its own DEFAULT (see chunker.ts).
 */
export function resolveChunkOptions(
  explicit: { chunkSize?: number; chunkOverlap?: number },
  defaults: { chunkSize: number; chunkOverlap: number } | undefined,
): { chunkSize?: number | undefined; chunkOverlap?: number | undefined } {
  return {
    chunkSize: explicit.chunkSize ?? defaults?.chunkSize,
    chunkOverlap: explicit.chunkOverlap ?? defaults?.chunkOverlap,
  }
}

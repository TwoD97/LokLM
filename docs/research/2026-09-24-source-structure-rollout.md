# Source structure changes and contextual indexing follow-up

Implemented in this pass:

- Markdown pipe tables that exceed a section's chunk budget split between complete rows and repeat the original header and delimiter. Table fragments retain the full existing heading breadcrumb. Adjacent prose and overlap are excluded from table fragments.
- Recognition is deliberately conservative: escaped pipes are cell content, fenced code is not a table, and column counts must agree. A header or individual row too large for the budget falls back to bounded plain-text splitting; it does not silently drop cells or fabricate a smaller table. This fallback does not guarantee table interpretation.
- Markdown heading prefixes and the separator introduced by overlap count toward the character limit. A heading that would consume more than half the budget remains in heading metadata instead of fragmenting the body into tiny chunks.
- `documentEmbeddingInput` is the canonical concatenation shared by fresh import and deferred backfill. It preserves existing inputs byte for byte. Original chunk text remains distinct from the persisted `context_prefix` indexed by FTS.

These chunker improvements apply to new imports and explicit document reindexing. No automatic rebuild, model change, new title/section prefix, or existing-vector purge is performed. The chunk size remains a character budget; no claim of token-aware chunking or improved answer accuracy is made before evaluation.

## Why contextual prefixes are not enabled yet

The existing SQLite schema has `chunks.text`, `context_prefix`, `heading_path`, `embedded`, and `embedder_identity`. FTS indexes `text` and `context_prefix`. Import persists the same prefix it used for embedding, and backfill reads that persisted prefix. That is the right basis for keeping citations unchanged.

There is no independent chunk-format or embedding-input version. `EmbeddingBackfillService` compares model stems, so appending a marker to the provider identity is not a safe replacement for a format migration. A new prefix applied only during backfill would also make fresh and deferred embeddings differ. Applying new prefixes only to newly imported documents would silently mix old and new preprocessing policies across the library.

## Required rollout design

1. Store an explicit embedding-input format/version, separate from model identity, and distinguish the desired version from the version actually represented by each embedded chunk. Preserve an unambiguous legacy version for existing rows.
2. Make reindexing an explicit user-visible operation with progress, cancellation, and a recoverable state. Keep original files/chunk text and existing usable search available until replacement is ready; do not delete the current index at startup just because the application version changed.
3. Define deterministic title/full-heading prefix formatting and bounds in one shared function. Store the exact generated prefix at ingestion time so a later rename or metadata edit cannot silently change deferred input. Use the same value for lexical indexing and dense embedding; keep it out of citable text. Define title-edit behavior explicitly.
4. Stage replacement chunk metadata, FTS entries, and vectors as an index generation. Switch search to the replacement generation only when it is complete. Alternatively, if partial migration is intentionally supported, surface that state and make retrieval's version policy explicit. SQLite and LanceDB do not share one transaction, so restart/crash and cancelled migration recovery need tests.
5. Decide how code's existing file/symbol prefix and document-summary embeddings are versioned. A prose preprocessing change must not accidentally invalidate unrelated summary vectors or erase code context.
6. Test fresh indexing, deferred backfill, model changes, failed writes, restart, cancellation, source disappearance, and metadata edits. Verify exact stored input parity and original-source citation text, then measure retrieval and answer quality against a fixed baseline.

PDF extraction remains page-based with existing outline metadata. This pass does not reconstruct PDF table cells, infer chart values, or invent section boundaries from ambiguous bookmarks.

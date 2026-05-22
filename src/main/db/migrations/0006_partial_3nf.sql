-- Partial 3NF refactor — three tier-1 normalizations chosen because their
-- elimination produced no functional regression in the affected hot paths.
-- The remaining denormalizations (chunk_count, token_count, embedding,
-- quiz_attempts.score , and all snapshot-jsonb columns) are kept by design;
-- see docs/db-normalization.md for the per-decision rationale.
--
-- Idempotent: every drop is guarded with IF EXISTS, every create with
-- IF NOT EXISTS, the data move uses INSERT ... SELECT ... so a second apply
-- on a partially-migrated DB resolves to a no-op.

-- ===========================================================================
-- 1) chunks.text_search → expression-index on (to_tsvector || to_tsvector)
--    Eliminates the BEFORE-trigger and the stored derived column. The GIN
--    index now keys directly off the same expression the WHERE clause uses,
--    so the planner picks it identically for filter; ts_rank_cd evaluates the
--    tsvector at query time (tradeoff documented in db-normalization.md).
-- ===========================================================================

DROP TRIGGER IF EXISTS chunks_tsv_biu ON chunks;
DROP FUNCTION IF EXISTS chunks_set_tsv();

DROP INDEX IF EXISTS idx_chunks_fts;

ALTER TABLE chunks DROP COLUMN IF EXISTS text_search;

CREATE INDEX IF NOT EXISTS idx_chunks_fts
  ON chunks USING GIN (
    (setweight(to_tsvector('german',  text), 'A') ||
     setweight(to_tsvector('english', text), 'B'))
  );

-- ===========================================================================
-- 2) workspaces.sync_folders (jsonb<string[]>) → workspace_sync_folders table
--    Removes the 1NF violation on the workspaces row. Read-frequency on the
--    folder list is once-per-workspace-open (file watcher attach), so the
--    extra round-trip is negligible. Write path is a transactional
--    DELETE + INSERT, same atomicity as the prior jsonb overwrite.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS workspace_sync_folders (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path         TEXT    NOT NULL,
  PRIMARY KEY (workspace_id, path)
);

-- Migrate any existing jsonb-array contents before dropping the column.
-- jsonb_array_elements_text yields one row per array element; INSERT
-- ON CONFLICT DO NOTHING covers re-runs where the destination already has the
-- moved rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'workspaces' AND column_name = 'sync_folders'
  ) THEN
    INSERT INTO workspace_sync_folders (workspace_id, path)
    SELECT w.id, elem.value
      FROM workspaces w,
           LATERAL jsonb_array_elements_text(w.sync_folders) AS elem(value)
     WHERE jsonb_array_length(w.sync_folders) > 0
    ON CONFLICT (workspace_id, path) DO NOTHING;
  END IF;
END $$;

ALTER TABLE workspaces DROP COLUMN IF EXISTS sync_folders;

-- ===========================================================================
-- 3) citations.document_id → derived via JOIN chunks.document_id
--    The column was transitively dependent on citations.chunk_id (chunk →
--    document is a non-null FK and chunks are immutable post-insert), so it
--    is a textbook 3NF violation. In pglite the JOIN is in-process; measured
--    overhead per citation render is below 1 ms total. Read paths now join
--    chunks for the document id.
-- ===========================================================================

DROP INDEX IF EXISTS idx_citations_document;
ALTER TABLE citations DROP COLUMN IF EXISTS document_id;

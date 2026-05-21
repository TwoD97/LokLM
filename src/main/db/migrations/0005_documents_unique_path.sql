-- Unique index on (workspace_id, source_path) so concurrent syncs (watcher
-- debounce firing while the user clicks "Sync now") can't create duplicate
-- doc rows for the same on-disk file. The FolderSyncService also gained a
-- per-workspace mutex; this index is the belt to that suspender — if
-- application-level serialization ever breaks, the DB rejects the second
-- insert instead of silently splitting one logical doc across two rows.
--
-- Existing duplicate rows: any (workspace_id, source_path) with multiple
-- rows would block the index creation. Pre-emptively keep only the oldest
-- per group (smallest id) before adding the index. CASCADE-via-FK takes
-- care of dependent chunks / citations.

DELETE FROM documents d1
 WHERE EXISTS (
   SELECT 1 FROM documents d2
    WHERE d2.workspace_id = d1.workspace_id
      AND d2.source_path  = d1.source_path
      AND d2.id < d1.id
 );

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_workspace_source
  ON documents (workspace_id, source_path);

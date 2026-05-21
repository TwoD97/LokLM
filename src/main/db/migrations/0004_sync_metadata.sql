-- Per-document content_hash + mtime so the sync/refresh path can tell when an
-- external edit happened without re-parsing the whole file, and per-workspace
-- sync_folders (jsonb string[]) so each workspace can watch one or more
-- folders for auto-import. missing_at / missing_dismissed_at drive the soft
-- "your file vanished" banner: sync marks missing instead of auto-deleting,
-- the renderer surfaces them, and the user decides Keep vs. Remove. All ADDs
-- are IF NOT EXISTS so vault round-trips and dev resets stay idempotent.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS source_mtime bigint,
  ADD COLUMN IF NOT EXISTS missing_at bigint,
  ADD COLUMN IF NOT EXISTS missing_dismissed_at bigint;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS sync_folders jsonb NOT NULL DEFAULT '[]'::jsonb;

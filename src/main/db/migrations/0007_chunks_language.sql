-- Per-chunk detected language (eld / Efficient Language Detector). Nullable
-- because legacy chunks were ingested before detection was wired ; new chunks
-- get a value during ingest, old chunks stay NULL until the next reindex.
--
-- Values written by the ingest pipeline: 'de' | 'en' | 'other'. Anything that
-- isn't one of LokLM's two response languages collapses to 'other' so the
-- prompt formatter can decide whether to emit a `, lang:xx` header tag —
-- mixed-language docs only matter when the chunk language differs from the
-- response language, and the partial index below keeps the column free for
-- workspaces that haven't reindexed yet (no NOT NULL constraint, no default).
--
-- Idempotent: IF NOT EXISTS on both the column and the index so vault
-- round-trips and dev resets stay safe.

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS language TEXT;

-- Partial index — only chunks with a detected language are interesting for
-- per-language analytics or language-aware retrieval boosts (deferred). Skips
-- NULL rows so the index stays small on workspaces that haven't reindexed
-- since 0007 landed.
CREATE INDEX IF NOT EXISTS idx_chunks_language
  ON chunks (language)
  WHERE language IS NOT NULL;

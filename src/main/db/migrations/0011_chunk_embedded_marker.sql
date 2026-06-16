-- ADR-0005: vectors move out of PGlite into the per-workspace encrypted LanceDB
-- store. The "is this chunk embedded?" bookkeeping can no longer key off the
-- pgvector `embedding` column (which is now NULL in the app — vectors live in
-- Lance), so introduce an explicit marker. countChunksMissingEmbedding /
-- listChunksMissingEmbedding / distinctEmbedderIdentities switch to it; the
-- model-swap purges reset it.
--
-- IF NOT EXISTS keeps this idempotent across the every-boot raw-migration replay
-- (same discipline as 0004/0008/0010).
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS embedded boolean NOT NULL DEFAULT false;

-- Backfill the marker from the legacy column for existing libraries: any chunk
-- that already had a vector is "embedded". Guarded by `embedded = false` so the
-- replay is a no-op after the first run (and never flips a marker-only row, set
-- by the app's sink-only path, back to a wrong value).
UPDATE chunks
   SET embedded = true
 WHERE embedding IS NOT NULL
   AND embedded = false;

-- A partial index for the hot "missing embedding" scan the backfill runs.
CREATE INDEX IF NOT EXISTS idx_chunks_unembedded
  ON chunks (document_id)
  WHERE embedded = false;

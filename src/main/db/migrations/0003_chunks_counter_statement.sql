-- Statement-level replacement for the chunks → documents counter trigger.
-- The row-level version (from 0001) fired once per inserted/deleted row and
-- did one UPDATE on the parent document per fire. A 500-chunk import was 500
-- UPDATEs on the same documents row; this collapses to one UPDATE per
-- statement per affected document via REFERENCING NEW/OLD TABLE.
--
-- Idempotent: DROP TRIGGER IF EXISTS handles both the old row-level name and
-- this file's statement-level names, and CREATE OR REPLACE FUNCTION updates
-- the body without dropping dependents.

CREATE OR REPLACE FUNCTION chunks_update_doc_counters_stmt() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE documents d
       SET chunk_count = d.chunk_count + agg.cnt,
           token_count = d.token_count + agg.toks
      FROM (
        SELECT document_id,
               COUNT(*)::int AS cnt,
               COALESCE(SUM(token_count), 0)::int AS toks
          FROM new_chunks
         GROUP BY document_id
      ) agg
     WHERE d.id = agg.document_id;
    RETURN NULL;
  ELSE  -- DELETE
    UPDATE documents d
       SET chunk_count = GREATEST(d.chunk_count - agg.cnt, 0),
           token_count = GREATEST(d.token_count - agg.toks, 0)
      FROM (
        SELECT document_id,
               COUNT(*)::int AS cnt,
               COALESCE(SUM(token_count), 0)::int AS toks
          FROM old_chunks
         GROUP BY document_id
      ) agg
     WHERE d.id = agg.document_id;
    RETURN NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Drop the row-level trigger from 0001 and any prior attempts at the
-- statement-level variant. Order doesn't matter — both DROPs are guarded.
DROP TRIGGER IF EXISTS chunks_count_aid       ON chunks;  -- row-level (0001)
DROP TRIGGER IF EXISTS chunks_count_aii_stmt  ON chunks;
DROP TRIGGER IF EXISTS chunks_count_aid_stmt  ON chunks;

CREATE TRIGGER chunks_count_aii_stmt
  AFTER INSERT ON chunks
  REFERENCING NEW TABLE AS new_chunks
  FOR EACH STATEMENT EXECUTE FUNCTION chunks_update_doc_counters_stmt();

CREATE TRIGGER chunks_count_aid_stmt
  AFTER DELETE ON chunks
  REFERENCING OLD TABLE AS old_chunks
  FOR EACH STATEMENT EXECUTE FUNCTION chunks_update_doc_counters_stmt();

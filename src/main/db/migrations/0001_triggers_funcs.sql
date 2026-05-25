-- triggers, function, procedure that drizzle cannot generate. idempotent so
-- it survives a vault round-trip (load snapshot -> migrate -> already there).

CREATE EXTENSION IF NOT EXISTS vector;

-- NOTE: the chunks.text_search tsvector column, its BEFORE-trigger
-- (chunks_set_tsv / chunks_tsv_biu) and the GIN index on it used to live here.
-- Mig 0006 (partial_3nf) eliminated the stored column in favour of an
-- expression index, so those statements were removed from this file: raw
-- migrations re-run unconditionally on every vault round-trip, and a
-- CREATE INDEX ... (text_search) after 0006 dropped the column threw
-- "column text_search does not exist" mid-login. 0006 now owns FTS setup.

-- TRIGGER 2: denormalized chunk_count + token_count on documents
CREATE OR REPLACE FUNCTION chunks_update_doc_counters() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE documents
       SET chunk_count = chunk_count + 1,
           token_count = token_count + COALESCE(NEW.token_count, 0)
     WHERE id = NEW.document_id;
    RETURN NEW;
  ELSE
    UPDATE documents
       SET chunk_count = GREATEST(chunk_count - 1, 0),
           token_count = GREATEST(token_count - COALESCE(OLD.token_count, 0), 0)
     WHERE id = OLD.document_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chunks_count_aid ON chunks;
CREATE TRIGGER chunks_count_aid
  AFTER INSERT OR DELETE ON chunks
  FOR EACH ROW EXECUTE FUNCTION chunks_update_doc_counters();

-- FUNCTION: context-window expansion for the citation source viewer
CREATE OR REPLACE FUNCTION get_chunk_with_context(
  p_chunk_id INT,
  p_before   INT DEFAULT 1,
  p_after    INT DEFAULT 1
)
RETURNS TABLE (
  id          INT,
  document_id INT,
  ordinal     INT,
  text        TEXT,
  token_count INT,
  page_from   INT,
  page_to     INT,
  is_target   BOOLEAN
)
LANGUAGE sql AS $$
  WITH target AS (
    SELECT document_id, ordinal FROM chunks WHERE chunks.id = p_chunk_id
  )
  SELECT c.id, c.document_id, c.ordinal, c.text, c.token_count,
         c.page_from, c.page_to, (c.id = p_chunk_id) AS is_target
    FROM chunks c
    JOIN target t ON c.document_id = t.document_id
   WHERE c.ordinal BETWEEN t.ordinal - p_before AND t.ordinal + p_after
   ORDER BY c.ordinal;
$$;

-- PROCEDURE: reindex a document end-to-end
CREATE OR REPLACE PROCEDURE reindex_document(p_doc_id INT)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = p_doc_id) THEN
    RAISE EXCEPTION 'Document % not found', p_doc_id;
  END IF;
  UPDATE documents SET status = 'indexing' WHERE id = p_doc_id;
  DELETE FROM chunks   WHERE document_id = p_doc_id;
  UPDATE documents
     SET chunk_count = 0,
         token_count = 0,
         status      = 'pending'
   WHERE id = p_doc_id;
END;
$$;

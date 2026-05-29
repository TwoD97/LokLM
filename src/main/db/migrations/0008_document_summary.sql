-- Per-document lazily-computed summary (Library "Summarize" action + future
-- context-anchor use). Null until first requested. ADD is IF NOT EXISTS so
-- vault round-trips and dev resets stay idempotent, matching 0004's style.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS summary text;

-- A reindex means the chunks (and therefore the summary's source material)
-- changed, so the cached summary is stale. Fold the invalidation into the
-- existing wipe procedure so every reindex path (reindex / replaceSource /
-- changed-on-refresh) clears it automatically — no caller can forget.
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
         status      = 'pending',
         summary     = NULL
   WHERE id = p_doc_id;
END;
$$;

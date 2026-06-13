-- Per-document summary embedding (DocumentSummaryIndex pattern, ADR-0003).
-- The embedding of documents.summary, used by the corpus route's theme matching
-- and the optional hierarchical doc-prefilter. Lazy like the summary itself:
-- NULL until the backfill (idle-time) embeds an existing summary. ADD is
-- IF NOT EXISTS so vault round-trips and dev resets stay idempotent (0004/0008
-- style). vector(1024) matches chunks.embedding (BGE-M3); the `vector`
-- extension is created at the top of runMigrations before any migration.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS summary_embedding vector(1024);

-- Which embedder produced summary_embedding, same discipline as
-- chunks.embedder_identity: a model swap (different embedderModelStem) makes
-- the stored vector incomparable, so the backfill purges + re-embeds. NULL
-- when no summary embedding exists yet.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS summary_embedder_identity text;

-- No HNSW index on documents.summary_embedding: the table is hundreds of rows,
-- a sequential cosine scan is cheaper than maintaining an ANN index. (chunks
-- has an HNSW index because it's orders of magnitude larger.)

-- A reindex changed the chunks, so the cached summary AND its embedding are
-- both stale. Fold the embedding invalidation into the same wipe procedure
-- (0008 already nulls `summary` here) so every reindex path clears it and no
-- caller can forget. CREATE OR REPLACE keeps it idempotent across re-runs.
CREATE OR REPLACE PROCEDURE reindex_document(p_doc_id INT)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = p_doc_id) THEN
    RAISE EXCEPTION 'Document % not found', p_doc_id;
  END IF;
  UPDATE documents SET status = 'indexing' WHERE id = p_doc_id;
  DELETE FROM chunks   WHERE document_id = p_doc_id;
  UPDATE documents
     SET chunk_count              = 0,
         token_count              = 0,
         status                   = 'pending',
         summary                  = NULL,
         summary_embedding        = NULL,
         summary_embedder_identity = NULL
   WHERE id = p_doc_id;
END;
$$;

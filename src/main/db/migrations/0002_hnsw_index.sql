-- HNSW index on chunks.embedding for cosine-distance retrieval. pgvector
-- supports HNSW on empty tables, so creating this up-front is safe — index
-- population happens lazily as vectors get written. m and ef_construction
-- defaults follow pgvector's recommended starting point for 1024-dim
-- embeddings on workspaces up to ~100k chunks.
CREATE INDEX IF NOT EXISTS idx_chunks_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

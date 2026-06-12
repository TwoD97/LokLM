-- Document "pinned" flag — the QA packer prepends top-of-document chunks from
-- every pinned doc before RAG hits, so a study session can guarantee a
-- textbook chapter or notes file is always in context. ADD is IF NOT EXISTS so
-- vault round-trips and dev resets stay idempotent, matching the 0004 style.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

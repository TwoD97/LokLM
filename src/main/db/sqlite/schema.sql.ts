// Per-workspace SQLite schema (ADR-0005, PGlite → encrypted SQLite migration).
//
// Each workspace is its OWN encrypted SQLite file, so the tables drop the
// `workspace_id` columns the PGlite schema carried — the file *is* the
// workspace. Vectors are gone from the relational layer entirely (they live in
// the workspace's LanceDB store); only the `embedded` marker remains. BM25 is
// SQLite FTS5 (external-content over chunks.text, trigger-synced) replacing the
// Postgres tsvector path.
//
// Applied idempotently on every open (CREATE … IF NOT EXISTS), mirroring how the
// raw PGlite migrations re-ran each boot. Summary embeddings are a small BLOB of
// float32 (hundreds of rows per workspace → brute-force cosine in JS, ADR-0003).

export const WORKSPACE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  title                     TEXT    NOT NULL,
  source_path               TEXT    NOT NULL,
  mime_type                 TEXT,
  byte_size                 INTEGER,
  status                    TEXT    NOT NULL DEFAULT 'pending',
  chunk_count               INTEGER NOT NULL DEFAULT 0,
  token_count               INTEGER NOT NULL DEFAULT 0,
  added_at                  INTEGER NOT NULL DEFAULT (unixepoch()),
  content_hash              TEXT,
  source_mtime              INTEGER,
  missing_at                INTEGER,
  missing_dismissed_at      INTEGER,
  summary                   TEXT,
  pinned                    INTEGER NOT NULL DEFAULT 0,
  summary_embedding         BLOB,
  summary_embedder_identity TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_source_path ON documents(source_path);

CREATE TABLE IF NOT EXISTS chunks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id       INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal           INTEGER NOT NULL,
  text              TEXT    NOT NULL,
  context_prefix    TEXT,
  token_count       INTEGER,
  page_from         INTEGER,
  page_to           INTEGER,
  heading_path      TEXT,
  embedder_identity TEXT    NOT NULL DEFAULT 'bundled:bge-m3',
  language          TEXT,
  embedded          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_doc_ordinal ON chunks(document_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_chunks_unembedded ON chunks(document_id) WHERE embedded = 0;

-- FTS5 over chunk text (external content), trigger-synced. BM25 ranking built in.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
  USING fts5(text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS conversations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  title               TEXT,
  active_document_ids TEXT    NOT NULL DEFAULT '[]',
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  ttft_ms         INTEGER,
  tokens_per_sec  REAL,
  token_count     INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS citations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  chunk_id   INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  score      REAL,
  span_start INTEGER,
  span_end   INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_citations_message ON citations(message_id);
CREATE INDEX IF NOT EXISTS idx_citations_chunk ON citations(chunk_id);

CREATE TABLE IF NOT EXISTS quiz_decks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  document_ids   TEXT    NOT NULL,
  question_count INTEGER NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'generating',
  error          TEXT,
  language       TEXT    NOT NULL,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id          INTEGER NOT NULL REFERENCES quiz_decks(id) ON DELETE CASCADE,
  ordinal          INTEGER NOT NULL,
  stem             TEXT    NOT NULL,
  options          TEXT    NOT NULL,
  correct_index    INTEGER NOT NULL,
  explanation      TEXT    NOT NULL,
  source_chunk_ids TEXT    NOT NULL,
  theme_title      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_deck ON quiz_questions(deck_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quiz_questions_deck_ordinal ON quiz_questions(deck_id, ordinal);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id     INTEGER NOT NULL REFERENCES quiz_decks(id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  score       INTEGER,
  answers     TEXT    NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_deck ON quiz_attempts(deck_id);

CREATE TABLE IF NOT EXISTS document_tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_document_tags_doc ON document_tags(document_id);
CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_document_tags_doc_tag ON document_tags(document_id, tag);

-- User-created organizational folders (virtual; independent of a document's
-- source_path on disk). A document belongs to at most ONE folder
-- (document_folders.document_id is the PK). parent_id nests folders; deleting a
-- folder cascades to its subfolders and, via document_folders' own cascade,
-- unfiles the affected documents — the documents themselves are never deleted.
CREATE TABLE IF NOT EXISTS folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

CREATE TABLE IF NOT EXISTS document_folders (
  document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  folder_id   INTEGER NOT NULL    REFERENCES folders(id)   ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_document_folders_folder ON document_folders(folder_id);

CREATE TABLE IF NOT EXISTS sync_folders (
  path TEXT PRIMARY KEY
);

-- ADR-0006: when a synced codebase folder has no .gitignore, the user picks which
-- top-level directories to index. The chosen dir names are stored here, scoped to
-- the folder. No rows for a folder ⇒ "index everything" (gitignore/defaults govern).
CREATE TABLE IF NOT EXISTS sync_folder_index_dirs (
  folder_path TEXT NOT NULL,
  dir         TEXT NOT NULL,
  PRIMARY KEY (folder_path, dir)
);
`

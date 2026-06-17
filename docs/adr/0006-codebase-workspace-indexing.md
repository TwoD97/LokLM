# ADR-0006: Codebase workspace type — code-aware indexing & analytics

Status: Accepted (staged implementation)
Date: 2026-06-16
Builds on: ADR-0005 (per-workspace encrypted SQLite + LanceDB stores)

## Context

Today every workspace is a "library" of documents (PDFs, notes). Users also want
to point LokLM at a **source-code project**: sync a project folder, have it
recognised as a codebase, and index **code** and **docs/info** on separate
tracks so chat/retrieval understands the code structure rather than treating
`.ts` files as prose.

We researched how the field does this (Cursor, Continue.dev, Tabby, Aider,
Sourcegraph/Cody) before designing. Findings (full reports in the PR thread):

- **Continue.dev is our stack.** Local-first, TypeScript, **SQLite + FTS5
  (`trigram` tokenizer) + LanceDB + tree-sitter AST chunking + hybrid retrieval**.
  Direct precedent — de-risks the whole feature.
- **Chunking:** AST/tree-sitter, function/class-level, merge small siblings, add a
  scope header (file/class path). Consensus across Cursor, Tabby, Aider, the cAST
  paper. Beats fixed line-windows for code.
- **Retrieval:** hybrid lexical + dense fused by **RRF** is standard (Tabby uses
  RRF k=60 — same constant as our `fuseRrf`). Pure-vector **fails on exact
  identifiers** (`ERR_SSL_…`); FTS/trigram is required, not optional.
- **Symbol graph (Aider):** tree-sitter `tags.scm` → def/ref tags → dependency
  graph + PageRank gives a cheap, exact "repo map" and powers analytics.
- **Incremental:** content-hash per file (Cursor Merkle tree / Continue SHA-256
  `cacheKey` / Tabby git-blob id) → re-embed only deltas; cache embeddings by
  chunk hash. No project uses anything heavier than per-file hashing in practice.
- **Code vs docs split:** Tabby keeps separate `code` and `structured_doc`
  corpora — exactly the separation requested here.
- **Embeddings:** code-specialized models beat general ones on code retrieval
  (CoIR). Open-weight + locally runnable sweet spot is **jina-code-embeddings-0.5b**
  (GGUF, 896-dim). BGE-M3 stays competitive for prose.
- **What NOT to copy:** Cursor's path-obfuscation/server tiering (only needed
  because they ship code off-device — we're local + encrypted); Sourcegraph
  deprecated embeddings purely for >100k-repo server scale, which doesn't apply
  to a single local project.

## Decision

Add a workspace **type**: `'library' | 'codebase'` (`WorkspaceManifestEntry.type`,
default `'library'`, back-compat via `workspaceTypeOf`).

### Classification

When a folder is synced, classify it (marker files like `package.json`,
`Cargo.toml`, `go.mod`, … + code-file ratio). If it looks like a codebase, set
the workspace type to `'codebase'`. User can override. (`services/codebase/classify.ts`)

### Two-track indexing (the "code and infos separately" requirement)

Each indexable file is routed (`services/codebase/ignore.ts → fileTrack`) to:

- **code track** — source files, AST-aware chunking (tree-sitter), embedded with
  the **code model (jina-code-0.5b, 896-dim)** → its own LanceDB table.
- **doc track** — README/markdown/prose, prose chunking, embedded with **BGE-M3
  (1024-dim)** → the existing-style doc table.
  Two tables, two dimensions; LanceDB tables are per-column so this is clean.

### Ignore rules

Always-on default deny-list (vendored/build dirs, lockfiles, env, binaries,
minified, oversized) — the highest-leverage quality lever. `.gitignore` /
`.lokignore` layering applied on top by the indexer.

### Retrieval

Hybrid per track: FTS5 (add a **trigram** tokenizer for identifier/substring
matches) ⊕ LanceDB cosine, fused with the existing `fuseRrf`, BM25 up-weighted
for short/identifier queries; reuse the existing reranker stage. A tree-sitter
**symbol/def-ref index** supplements search ("where defined / who calls").

### Incremental sync

Per-file content hash (SHA-256) persisted in the workspace SQLite store; re-chunk

- re-embed only changed files; cache embeddings by chunk-content hash so moved/
  unchanged chunks never re-embed; delete vectors for removed files.

### tree-sitter packaging

**web-tree-sitter (WASM, CJS build)** — architecture-independent, survives
Electron upgrades without native rebuilds. Parse off the main thread.

## Implementation stages

**PR 1 — indexing + retrieval** (this PR):

1. ✅ Workspace `type` model + classification + ignore/track rules (+ unit tests).
2. ✅ Classification wired into folder-sync; `type` persisted; `workspaces:setType`/
   `:classify` IPC + preload; sidebar codebase badge.
3. ✅ Structural code chunker (`codeChunker.ts`, line ranges + symbol breadcrumb);
   prose path reused for docs. **tree-sitter AST backend deferred** — the chunker
   is a dependency-free heuristic with the same `Chunk` output, so a WASM
   tree-sitter backend is a drop-in upgrade later.
4. ✅ Two-track ingest: code-track files chunked via `codeChunker`, doc-track via
   the prose path; both ride the existing embed→persist→vector-sink pipeline and
   the existing hash-aware incremental refresh.
5. ✅ Hybrid retrieval: code chunks land in the same chunks table + LanceDB, so
   the existing `RetrievalService` (BM25 + vector + RRF + rerank) searches them.

**Deferred to a fast-follow (additive, runtime-verification needed; the
`fileTrack` + per-workspace model seams make all three drop-in):**

4. jina-code-0.5b embedder + per-track dual-dim LanceDB tables (896 vs 1024). The
   working feature currently embeds code with BGE-M3 (1024-dim) — functional, and
   BGE-M3 is a competent code embedder; jina-code is a quality upgrade that needs
   a model download + dual-dimension store verified in-app.
   6b. Trigram FTS tokenizer for identifier _substring_ matches (whole-identifier
   search already works on the default tokenizer); best as a code-only FTS table
   so document-search ranking is unaffected.

**PR 2 — codebase analytics** (follow-up): language/LOC breakdown, symbol
inventory (tree-sitter), git hotspots (change-frequency × complexity), and the
dependency graph (imports/`package.json`), surfaced in a dashboard.

## Consequences

- Codebase workspaces download an extra ~0.3–0.5 GB code-embedding model on first
  use; gated to the codebase type so library users are unaffected.
- A codebase workspace holds two vector tables (code + doc) at different dims.
- Everything stays local + encrypted under the per-workspace WDEK (ADR-0005); no
  code or embeddings leave the device — strictly stronger than Cursor Privacy Mode.

## References

Cursor (secure-codebase-indexing, semsearch), Continue.dev (`core/indexing`),
Tabby (rank-fusion, tantivy index), Aider (repo map / tree-sitter `tags.scm` +
PageRank), Sourcegraph SCIP/Zoekt + Cody embeddings deprecation, cAST
(arXiv:2506.15655), CoIR (arXiv:2407.02883), jina-code-embeddings.

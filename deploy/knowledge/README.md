# LokLM file knowledge daemon (0.1.0 development)

This is a working Rust HTTP service and file index, with an upstream LiveSync
Node.js sidecar and CouchDB. It needs no Electron, Tauri, browser or desktop
session. It is a separate deployment from the desktop app and Macro/Zero.
**Do not attach this development release to an existing production vault or DB.**
The local tests exclusively use disposable databases and synthetic notes.

## What is implemented

* Portable Markdown/frontmatter UUIDs, original paths, heading locations and
  attachments. Explicit import never overwrites an existing file.
* Bounded filesystem watcher, debounce and full reconciliation; durable SQLite
  checkpoint/FTS5, hash-based embedding cache and embedded LanceDB acceleration.
* LokLM shared Rust chunker, model instruction/normalization/fingerprint code,
  reciprocal-rank fusion, source diversity and neighbour/short-document expansion.
* Optional dedicated Qwen3/BGE embedding and BGE reranking HTTP providers. No
  model discovery, unloading, automatic download or changes to active sessions.
* Bearer-protected API, per-instance vault boundary, request cancellation, lock,
  source inventory, index status and versioned source-backed search results.
* Actual encrypted upstream LiveSync file/attachment replication through CouchDB,
  tested between two CLI/daemon peers. No custom CouchDB document wire format.
* Source-only integrity-checked backup/restore and safe preparation of a new vault.

The optional `/v1/answer` adapter uses the desktop owner's exact bilingual core
prompts, passage budgets and citation identity validator. It returns buffered
answers only after validation. **It is experimental basic QA, not full LokLM
checked-answer/comparison/router parity or proof of factual entailment.** Its
transport/cancellation tests use a synthetic provider; actual model answer
validation remains a gate. See [VALIDATION.md](VALIDATION.md) for measured coverage.
Until literal ChatML escaping is validated end to end, the answer adapter rejects
questions/evidence containing `<|` control-marker syntax. Retrieval still exposes
the original document. This protects role boundaries; it does not claim to solve
semantic prompt injection or factual entailment.

## Canonical authority and file contract

The canonical knowledge is the readable Markdown and attachments, not a database
export or vector index. Each managed Markdown note requires exactly one UUID:

```yaml
---
loklm_id: 385d0777-e3be-441e-b79f-994dfc680e82
title: Solarstrom
source: https://example.org/original
---
```

The application preserves your prose/frontmatter/source references. It does not
rewrite notes on startup. `loklm_id` survives a rename. Chunk anchors identify
heading plus text plus occurrence; an edit that changes that passage changes its
anchor. The API returns the UUID, content anchor, current relative path, heading,
and an `obsidian://open?file=...` URI. The content hash is **not** an inserted
Obsidian block ID. Open URIs target the current Obsidian vault; with multiple
vaults use the returned path in the intended vault. Old anchors have no revision
archive in this service: source backups/LiveSync revisions provide history.
Search and answer citations include the indexed source hash. The HTTP layer
rechecks returned files against that hash before publishing (and after answer
generation); an edit/rename before reconciliation causes rejection rather than
presenting stale evidence as the current file. This is optimistic validation,
not a lock on external editors after the response is sent.

The daemon reads its vault mount read-only. Only upstream LiveSync mirrors
remote edits into that directory. Editors and LiveSync are the file writers;
there is no second Rust-to-CouchDB sync path and no index-to-file writeback loop.
Simultaneous remote edits follow upstream revision/conflict rules. The current
winning file may be indexed while a conflicting branch is retained remotely;
the Rust index does not itself expose every CouchDB conflict. Inspect upstream
`info PATH`, recover both versions using `pull-rev PATH DEST REV`, review, then
explicitly `resolve PATH REV` and sync. Never resolve blindly or change a vault's
encryption/sync settings on an established database.

Deletion from a peer propagates through upstream tombstones. The CLI filesystem
adapter does not promise an Obsidian recycle bin. A missing source is removed
from retrieval only after a complete valid scan. For reversible local removal,
stop sync/editors and move notes into a local hidden `.trash` excluded by your
LiveSync configuration, or take a source backup first. Deleted text/vectors can
remain in checkpoint caches, SQLite WAL, old Lance versions and backups; deletion
is **not secure erasure**. Rebuild into a new encrypted index directory for a
clean logical index, following your storage encryption/retention policy.

Invalid/duplicate IDs, symlinks, malformed UTF-8 and incomplete scans fail closed;
they do not cause a bulk deletion. Hidden paths are excluded from indexing.
Only Markdown is parsed in v1; attachments remain portable and synchronized but
are not OCR/PDF parsed. Limits: 4 MiB/note, 64 MiB Markdown/scan, 100,000 tree
entries, depth below 32, 8,192 chunks/note. The watcher has one queued event,
750 ms debounce, and a 30-second periodic reconciliation. A single operation
uses inference/indexing at a time; concurrent HTTP work gets 429.

## Windows development

Install Rust 1.95, the Windows MSVC C++ toolchain and Python 3.11 or newer. From
the repository root (the crate has its own workspace):

```powershell
cargo test --locked --manifest-path native/crates/knowledge/Cargo.toml -j 2
cargo build --locked --manifest-path native/crates/knowledge/Cargo.toml -j 2
python -m unittest discover -s deploy/knowledge -p 'test_backup.py'
python -m unittest discover -s deploy/knowledge -p 'test_prepare_vault.py'
```

The default native feature uses SQLite FTS with an exact dense reference search
if an embedder is configured. `--features lance` enables production LanceDB;
that much larger native dependency graph is validated in Linux containers.
For an existing vault, stop its editors/sync and prepare a **new sibling copy**:

```powershell
python deploy/knowledge/prepare_vault.py C:/Scratch/source-vault C:/Scratch/prepared-vault
```

This adds missing IDs, preserves existing IDs and attachment bytes, excludes
hidden app configuration, records original/prepared hashes in a hidden manifest,
and refuses existing destinations. Originals are untouched. On interruption,
inspect the incomplete destination and use a different new directory. For new
notes, run the executable with `--vault PATH --index SEPARATE_PATH import --path
Notes/Example.md --from INPUT.md` while sync/editors are stopped. In Obsidian,
retain the ID field in templates and generate a **new** UUID for every new note;
duplicating a note without changing its ID deliberately blocks reconciliation.

Before `serve`, put a random token of at least 32 characters in a private file
and set `LOKLM_TOKEN_FILE` to its path. Do not paste it into chat or shell history.
The default native bind is `127.0.0.1:8787`. Vault/index arguments are required by
the CLI even for fingerprint commands; those commands do not access the paths.

## Linux containers and fresh Unraid preparation

Unraid hardware and GPU operation have not been tested. The supplied template
is for the daemon; Compose configures the full stack. Keep appdata and index on
local SSD (for example the actual cache-pool path), with array migration disabled
for the active index. Never let daemon and desktop mutate one raw index over SMB.
Give each process its own derived index and exchange only canonical files.

From `deploy/knowledge`:

1. Copy `.env.example` to ignored `.env`. Set the three absolute paths and a
   dedicated UID/GID. Create the knowledge, index, `appdata/livesync` and
   `appdata/couchdb` directories. Grant only the chosen UID/GID access to knowledge,
   index and LiveSync state. CouchDB's image uses its own data-directory ownership.
2. Set a fresh `COUCHDB_USER` and `COUCHDB_PASSWORD` in `.env`. Create private
   `secrets/api_token` (at least 32 characters) and `secrets/vault_passphrase`
   (at least 24 random characters). Set file permissions for the container UID;
   keep `.env` and secrets out of logs, Git and chat. These are fresh-install
   secrets, never credentials taken from another application.
3. `docker compose build knowledge livesync couchdb`. The multi-stage Rust production
   image runs tests and uses locked dependencies. First Lance builds are large
   and slow; allow substantial build disk/RAM. Weights are never copied into it.
4. `docker compose up -d couchdb`, then
   `docker compose --profile setup run --rm setup`. Initialization refuses an
   existing settings file/database/user. On partial failure inspect the fresh
   disposable installation rather than deleting an existing user database.
5. `docker compose up -d knowledge livesync`. Base Compose intentionally exposes
   **no host ports**. Without model settings, `/v1/status` reports `dense:false`.
   For local administration only add `-f compose.yaml -f compose.local.yaml`
   consistently; this publishes localhost ports 8787 and 5984 only.
6. Connect Obsidian Self-hosted LiveSync using its supported configuration UI,
   the non-admin sync user from the local private `appdata/livesync/settings.json`,
   database `loklm-knowledge`, and the exact passphrase/options. For another device
   provide a separately configured authenticated TLS/VPN gateway to CouchDB;
   `http://couchdb:5984` is only the container-internal URI. The default stack is
   deliberately unreachable from external peers until that gateway is configured.
   Validate on a disposable Obsidian vault before any real migration.

`/_up` is the only anonymous CouchDB health route; all document routes require
authentication. `_security` restricts the knowledge DB to the dedicated sync user
and admin. The daemon's `/healthz` means process alive, **not** successful indexing
or remote synchronization. Authenticated `/v1/status` reports counts, generation,
last successful reconcile timestamp, latest embed/cache counts and a sanitized
reconcile error. Check upstream CLI sync/conflict status separately.
For a detailed local reconciliation error, stop only the knowledge service and
run `docker compose run --rm knowledge reconcile` with the same configuration,
then restart it. The exclusive index lock prevents two owners. Keep detailed
local errors private; the HTTP status deliberately omits file contents/paths.

## LokLM models

See [MODEL-AUDIT.md](MODEL-AUDIT.md). The profiles use the canonical repo's current
models, not EmbeddingGemma. Put already-verified files in a separate versioned
cache mounted read-only. Generate aliases using the built daemon:

```sh
docker run --rm loklm-knowledge:0.1.0 --model-runtime llama.cpp-b12359 fingerprint
docker run --rm loklm-knowledge:0.1.0 --model-runtime llama.cpp-b12359 reranker-fingerprint
```

Set `LOKLM_EMBED_ALIAS` and `LOKLM_RERANK_ALIAS` in `.env` to these nonsecret
fingerprints; set `MODEL_PATH`. For Lite, also set `LOKLM_PROFILE=lite` and generate
the embedding fingerprint with `--profile lite`. Build/start the optional CPU
services with `docker compose -f compose.yaml -f compose.models.yaml build` then
`... up -d`. Both have two CPU threads, CPU limits, verified file hashes and no
GPU use. Do not start these while a shared machine lacks memory headroom.

The experimental answer overlay additionally needs `LOKLM_ANSWER_ALIAS` from
`answer-fingerprint` and the locally pinned Qwen3.5-4B file. Add
`-f compose.answer.yaml` only when testing that adapter; allow another 5 GiB.
It is not enabled in the base stack. Generation/reranking failures return an error,
never an invented answer. The model identity includes weights/runtime; changing
the embedding fingerprint/chunker requires a **new index directory**, not silently
mixing vectors. A full rebuild rereads files and re-embeds; ordinary restart
reconstructs Lance from the checkpoint's cached vectors without model calls.

GPU preparation is optional and unverified: the tested model binary is CPU-only.
`Model.cuda.Dockerfile` and `compose.gpu.yaml` prepare a separate NVIDIA build at
the same exact source revision with explicit device reservations. Set
`LOKLM_GPU_DEVICE`, review CUDA architectures and add that overlay after
`compose.models.yaml`; build/test it on a dedicated free GPU before use. Give the
GPU runtime its own runtime revision and regenerate fingerprints/new index (GPU
numerical behaviour has not been measured). Merely
adding `gpus: all` to this CPU image does not enable GPU inference. Do not grant
host-root or Docker-socket access. No GPU claim is made for this release.

## API v1

All `/v1/*` endpoints require `Authorization: Bearer <token from private file>`.
The token owns one entire vault instance. `source_ids` is a retrieval filter,
**not a per-user ACL**. For separate trust domains deploy separate vault/index/
LiveSync DB/user/token instances. HTTP bodies are capped at 16 KiB.

* `GET /v1/status`, `GET /v1/sources` (UUID/path/hash, outgoing wiki-links,
  resolved incoming source IDs, unresolved/ambiguous links). Resolution uses exact
  relative paths or unique basenames; it does not claim complete Obsidian resolver
  equivalence. The link inventory is capped at 100,000 references.
* `POST /v1/search`: `{"query":"Solarstrom","limit":8,"source_ids":[]}`.
  Primary hits can be followed by bounded same-source neighbour hits, so the
  returned count can exceed `limit` (at most three times the limit).
* `POST /v1/answer`: same input plus `language:"de"` and `depth:"concise"`;
  opt-in experimental adapter, 503 when unconfigured. Citation identity checks
  do not verify semantic entailment; response flags make this explicit.
* Supply a UUID `request_id`, then `POST /v1/cancel/UUID` to cancel. Cancellation
  returns 408 to the original request, 204 to the cancellation request; a busy
  instance returns 429 rather than growing a queue.
* `POST /v1/reconcile` forces a scan; 409 means failed reconciliation.
* `POST /v1/lock` cancels work and irreversibly locks this process (423 thereafter).
  Restart only after the administrator has unlocked the intended source volumes.

## Confidentiality, backup, restore and upgrades

LiveSync E2EE protects remote document payloads. It does **not** encrypt local
Markdown, attachments, PouchDB state, settings/passphrase, SQLite text/vectors or
Lance files. Those are sensitive plaintext at rest. Use encrypted local volumes
and encrypted backups with restricted OS permissions; do not put the derived
index in the synchronized vault. The daemon's lock is an API/work cancellation
boundary, not memory zeroization or full-system vault encryption. To lock at rest,
stop knowledge, LiveSync and dedicated model containers, then unmount/lock their
encrypted volumes. Stopping only Rust leaves the sync sidecar able to read files.

Stop editors and sync before source backup; the tool detects changes but does not
claim a consistent snapshot during concurrent writes:

```sh
python3 backup.py backup /path/to/knowledge /other/encrypted/location/knowledge.tar.gz
python3 backup.py verify /other/encrypted/location/knowledge.tar.gz
python3 backup.py restore /other/encrypted/location/knowledge.tar.gz /new/empty-vault
```

Restore verifies all hashes/paths before creating a new destination, rejects
links/devices/path traversal and never overwrites. The archive is not encrypted
by the script: its destination must provide encryption. Preserve the separate
LiveSync settings/passphrase and CouchDB backup if revision history/conflicts
are needed. The source archive alone preserves readable knowledge independently
of derived indexes. Stop CouchDB before a filesystem backup of its data, or use
its documented replication backup procedures. Never copy a live SQLite/Lance
directory as the only backup of your knowledge.

For upgrade: stop writers, verify source backup, record image/source/lock/model
versions, retain old appdata, build/test the new image with disposable data, and
rebuild into a new index directory on format/model change. Switch paths only
after validation. Rollback uses the previous image and its retained index; do not
downgrade a mutated index in place. Restoring a source snapshot into an actively
replicating old remote can replay deletes/edits: restore into an isolated fresh
vault/DB, review, then explicitly choose the migration direction in LiveSync.

## Reproduce local tests

From repository root on Linux/WSL with Docker access:

```sh
docker build -f deploy/knowledge/LiveSync.Dockerfile -t loklm-test-livesync:1.0.51 deploy/knowledge
docker build -f deploy/knowledge/Model.Dockerfile -t loklm-test-model:b12359 deploy/knowledge
docker build -f deploy/knowledge/CouchDB.Dockerfile -t loklm-test-couchdb:3.5.0 deploy/knowledge
docker build --target test-runtime -f deploy/knowledge/Dockerfile -t loklm-test-knowledge:dev .
python3 deploy/knowledge/test_provision.py
LOKLM_TEST_MODELS=/absolute/read-only/model-cache python3 deploy/knowledge/test_livesync.py
```

Omit `LOKLM_TEST_MODELS` for explicitly lexical-only integration. Tests create
UUID-prefixed resources and delete only those resources. They never use production
settings or host ports. They cover encrypted notes/attachments, offline conflicts,
restart, rename/delete, real Rust indexing, scope isolation and unchanged-content
dedup. **They do not run the Obsidian UI.** Benchmark instructions/results and
remaining acceptance gates are in [VALIDATION.md](VALIDATION.md).

## Upstream and licenses

LokLM code is MIT; the shared core is coordinated with the desktop migration.
LiveSync's upstream license is included in the sidecar image; its Node/commonlib
implementation is intentional and disclosed, rather than a claim of all-Rust sync.
Model/runtime licenses and exact identities are recorded in MODEL-AUDIT.md.
LanceDB/Qdrant SDKs retain their upstream Apache-2.0 licenses via Cargo dependencies.
See the maintained [LiveSync CLI](https://github.com/vrtmrz/obsidian-livesync/blob/5b57324bc72a6c7a330c280b876ae9c6f8e83221/src/apps/cli/README.md),
[settings](https://github.com/vrtmrz/obsidian-livesync/blob/5b57324bc72a6c7a330c280b876ae9c6f8e83221/docs/settings.md),
[CouchDB setup](https://github.com/vrtmrz/obsidian-livesync/blob/5b57324bc72a6c7a330c280b876ae9c6f8e83221/docs/setup_own_server.md),
[utilities](https://github.com/vrtmrz/obsidian-livesync/blob/5b57324bc72a6c7a330c280b876ae9c6f8e83221/utils/readme.md),
[CouchDB authentication](https://docs.couchdb.org/en/stable/config/auth.html),
[LanceDB Rust SDK](https://docs.rs/lancedb/0.41.0/lancedb/) and
[Qdrant Rust SDK](https://docs.rs/qdrant-client/1.20.0/qdrant_client/).

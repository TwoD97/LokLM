# Rust / Tauri migration work log

Implementation base: `4651557` (v0.7.4), branch `TwoD97/loklm-tauri-rust`.
The registered handbook worktree is at `a38ea02`; its handbook-only CLAUDE.md
does not govern this isolated implementation worktree. No applicable local
AGENTS.md/CLAUDE.md was found here. The user's supplied instructions apply.

## Scope and safety boundaries

Replace Electron/Node application logic with a shared Rust core, Tauri desktop
and Rust/WASM UI, plus a headless Rust knowledge agent for a future fresh Unraid
installation. Keep the Electron application and real data untouched until parity
is demonstrated. Use synthetic fixtures only. No deployment, installer overwrite,
model training, GPU reservations, or direct Macro–LokLM connector.

The later scope correction adds CouchDB/Obsidian interoperability through the
maintained LiveSync protocol implementation, not arbitrary CouchDB JSON. Canonical
notes/attachments and revisions remain separate from a rebuildable vector index.
Do not require the desktop app for agent operation. Unraid is currently offline.

## Stages and release gates

1. Audit current source and dependency docs; reproducible baseline and capability matrix.
2. Versioned vault compatibility, scoped/revocable sessions, encrypted relational
   store, real document import/search/source navigation in Tauri with Rust UI.
3. Native embedding/generation/reranking, streaming/cancellation and model lifecycle;
   dense+lexical retrieval and exact citations; complete document formats and OCR.
4. Copy-only transactional migration, restart/rollback, all settings and productivity
   features; prove compatibility against original implementation fixtures.
5. Headless ingestion/reconciliation, maintained LiveSync sidecar, Docker/Compose,
   actual synthetic roundtrips, conflicts, attachment/delete/rename tests.
6. Compare LanceDB/Qdrant on identical CPU fixtures with explicit embedding identity;
   report retrieval independently from embedding/reranker/LLM latency.
7. Native Windows executable/UI workflows, measured baseline comparison, packaging,
   notices, manual guide, reviewable PR. Other platforms require their own validation.

## Actual source inventory / parity matrix

“Pending” means not ported and must not be presented as complete.

| Capability | Current implementation / semantics | Rust status |
|---|---|---|
| Shell/IPC | `src/main/index.ts`, `src/preload/index.ts`, React renderer; lifecycle admission/quit drain | Tauri + Leptos/WASM Windows executable exercised, including graceful close/reopen |
| Vault | `auth/AuthService.ts`: LOKLM06 AES-GCM envelope, Argon2id 64 MiB/t=3/p=4, recovery, atomic persistence | Native create/unlock/recovery/lock/reopen pass original synthetic fixtures and Windows UI |
| Legacy vaults | v4 tar; v5 framed manifest+tar; current JS discards legacy tar; Rust must refuse destructive conversion | Pending |
| Workspace keys | `auth/workspaceKeys.ts`, manifest v1, individually wrapped WDEKs | Original format retained; Rust create/select scoped encrypted stores |
| Relational/FTS | `db/sqlite/WorkspaceDb.ts`, SQLCipher via sqlite3mc; FTS5, content/source/metadata/citations/quiz | Exact sqlite3mc 2.3.4 C engine via rusqlite; populated original DB fixture readable; FTS import/search/reopen pass |
| Vectors | LanceDB 0.30.0; 1024-d BGE-M3; index config in manifest; encrypted `enc/`, plaintext transient `work/`; opt-in unencrypted index | Pending |
| Import | `documents/parser.ts`, chunker, markdown, PDF/pdfjs, DOCX/mammoth, HTML, codebase track; OCR/tesseract | UTF-8 text/Markdown, isolated simple text-layer PDF and DOCX text/headings/tables implemented; Windows PDF/DOCX workflows pass; rich formats/HTML/code/OCR pending |
| Sync | `FolderSyncService.ts`, ignore policies, changed/missing/replaced source handling | Pending |
| Embedding | `EmbeddingService.ts`, backfill/identity, batched validation and resource planner | Native CPU BGE-M3 tested in Windows UI; hash/runtime identity and resumable encrypted checkpoints; complete resource planner pending |
| Retrieval | `RetrievalService.ts`, FTS+dense, RRF k=60, routing, filters, evidence thresholds, query cache, reranking | RRF and bounded encrypted exact dense scan; actual-Qwen DE/EN source correctness and BGE reranker UI pass; combined model residency passes; full routing/calibration pending |
| Answers | QA checked/comparison/corpus/summary routes, citation aliases and quote resolution, streaming | Prompts/budgets and pure quote provenance pass original TS fixtures; actual Windows CPU DE/EN answers and cited-source opening pass; runtime quote/advanced-route integration pending |
| Session/cancel | `lifecycle/`, model/document worker protocols and GPU coordinator; lock must revoke late work | Atomic revocation, authentication cancellation, real streamed-answer cancel/lock, isolated parser cancel/lock tested; complete resource planner pending |
| Models | llama.cpp via node-llama-cpp; manifests/checksums/downloads; bounded residency; optional explicitly authorized Ollama | Explicit checksum-verified CPU loading/unload and RAM guard; original installer/download/resource planner parity pending |
| Voice | Whisper native addon, sherpa-onnx diarization, workers, audio staging/alignment | Pending |
| Productivity | Translation, summarization, quiz, writing, organizer | Pending |
| Settings | encrypted global KV, avatars, model tiers, workspace type/default, storage estimates | Pending |
| Source viewer | scoped chunk/source read; PDF page/code-line navigation, generated text, missing originals | Indexed plain text viewer exercised, malicious HTML inert; full original/PDF viewer pending |
| Packaging | Electron payload; existing Tauri installer; CUDA split archives; signing status in release docs | Pending |
| Headless agent | New target, canonical Markdown+attachments, derived index, no desktop dependency | Separate independent `loklm-unraid-knowledge` owner; consumes committed core |
| Obsidian sync | New target; maintained LiveSync CLI/Commonlib; never guessed DB format | Separate peer owns validation and report; not a desktop completion claim |

## Dependencies and primary references consulted

- [Tauri Leptos guide](https://v2.tauri.app/start/frontend/leptos/) supports a Rust
  WASM SPA. Leptos chosen over retaining React/Node; generated wasm-bindgen glue and
  platform WebView still contain JavaScript/native platform code.
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/): only main local
  window; explicit app commands; no remote URL or filesystem/shell plugin exposure.
- [RustCrypto Argon2](https://docs.rs/argon2/) and [AES-GCM](https://docs.rs/aes-gcm/):
  match existing wire/KDF parameters, test both implementations, zeroize keys.
- [rusqlite](https://github.com/rusqlite/rusqlite): links the pinned sqlite3mc
  2.3.4 amalgamation from the original app's locked npm package. Stock SQLCipher
  failed the original DB fixture because its framing differs. The current build
  uses sqlite3mc's cryptography, with no OpenSSL/Node runtime dependency.
- [llama-cpp-rs](https://github.com/utilityai/llama-cpp-rs): pinned
  `llama-cpp-2 = 0.1.161`, CPU-only, two threads. Rust application logic calls the
  tested C/C++ inference library. No external inference listener or GPU feature.
- [LiveSync CLI](https://github.com/vrtmrz/obsidian-livesync/blob/main/src/apps/cli/README.md)
  shares the Obsidian plugin core and requires Node 22.22+. A narrowly scoped pinned
  sync sidecar is preferable to an unverified Rust reimplementation of its format.
- [LanceDB Rust](https://docs.rs/lancedb/latest/lancedb/) and
  [Qdrant](https://qdrant.tech/documentation/) are comparison candidates, not yet a
  measured default choice. Current desktop data remains preserved independently.

## Performance evidence

The first limited locked-shell comparison is in [PERFORMANCE.md](PERFORMANCE.md).
Full replacement performance acceptance still requires this checkout's release
build on this machine, isolated empty/synthetic data, same window size and model
state. Capture process-tree RSS/private bytes, idle CPU, first-render/ready timing,
warm launches (cold cache not implied by first launch), import throughput and p50/p95
retrieval. Separate model weights/VRAM and embedding/reranking/generation time.
Include WebView processes and shared runtime prerequisite in footprint disclosures.

## Current validation boundary

This is an incomplete migration, not a release candidate. The first actual
Windows UI run passed encrypted registration, synthetic Markdown import, DE/EN
lexical search, indexed source opening, inert malicious text, no-results,
locked IPC denial, wrong password, recovery and restart. It used a compile-time
`ui-test` file picker adapter and explicit lock before process termination.
The normal OS file picker was not automated (native automation helper unavailable).
The revised test subsequently passed native window close/reopen, Tauri stream
channel argument handling, no-evidence refusal and missing-model errors. Actual
generation/streaming was initially RAM-gated; later native Qwen4B execution passed
the synthetic canonical cited-answer fixture. All 16 core and 3 inference
unit/integration tests passed, including encrypted derived-index isolation and
restart checkpoints. One additional actual-vector test then passed all 16 DE/EN
queries against the 32-row Qwen fixture, including exact source text after reopen.
The latest Windows UI run also passed real BGE-M3 loading/indexing, skipping
completed chunks, hybrid retrieval preparation, wrong-workspace source denial
and cancellation during authentication. Strict Clippy passed across core,
inference and desktop targets. The automated outputs remain under ignored
`native/artifacts`.

Native BGE-reranker CPU execution passed a three-passage EN/DE synthetic smoke:
the two relevant passages scored above the unrelated passage. The desktop now
offers this model, keeps the original 2800 UTF-16-unit passage cap, and applies
the original 0.2 relevance floor. Unlike the full original QA pipeline, this
preview refuses an entirely weak slate and propagates reranker failures. It
does not implement the original structured factual-verification routes. The
first combined UI inference test reached embedding/checkpoints but could not load the
reranker on this shared low-memory host; a second run captured the explicit RAM
admission error. After RAM headroom became available, sequential embedding/index
and reranker UI tests passed, including an unrelated-question refusal. Concurrent
embedding+reranker+generation residency subsequently passed the actual Windows
workflow: all three models remained loaded for bilingual cited answers, source
opening, stream cancellation and a second streamed answer interrupted by lock.
No late text appeared; source IPC was denied and unlock preserved documents.
See `evidence/native-combined-model-workflow.json` and
`native-combined-answers.json`. This is functional coverage, not an active-memory
benchmark or proof of complete resource-planner parity.

The actual Windows UI subsequently passed real Qwen4B English and German cited
answers and opened the correct source, then cancelled a streamed answer without
late republishing. A separate test locked during real generation on a copy of the
synthetic vault: source IPC was revoked, no answer/source text reappeared, and
unlock preserved the document. Only the preview's own model was unloaded. Exact
synthetic results are committed in `evidence/native-ui-answers.json`,
`native-ui-model-workflow.json` and `native-stream-lock.json`. This is basic QA
and identity validation, not factual entailment or complete original QA parity.

Vault persistence now prepares the encrypted backup before replacing the
primary. A fault test confirms an unwritable backup leaves both the previous
primary and saved backup byte-identical. A primary replacement failure can leave
the old primary and new backup; neither is deleted to conceal partial failure.

All 26 Rust unit/integration tests and strict Clippy passed after adding isolated
PDF text extraction. The actual Windows PDF UI workflow passed two-page import,
DE/EN retrieval, page-number source opening, inert script-like source text,
malformed/blank/image PDF rejection without partial rows, duplicate import,
lock/authentication cancellation/recovery and close/reopen. The original engine
then opened a **copy** of that native PDF vault. The original TypeScript PDF
parser and native parser agree on normalized text and exact page numbers for the
same synthetic fixture. This does not establish broad PDF equivalence. See
[PDF import limits and tests](PDF_IMPORT.md). A synthetic compressed 512 MiB
expansion stream was rejected by the isolated worker; concurrent cancel and
session lock tests stopped and reaped workers. Comprehensive parser fuzzing is
still pending. The current UI-test executable
at that revision was 13,897,216 bytes, excluding model weights and shared WebView2; this is not an
installer or a matched Electron footprint comparison.

The subsequent DOCX slice preserves paragraphs, inherited Word headings and
ordinary table cells, without extracting ZIP entries to disk. Unsupported rich
content, DTDs and external header references fail before document publication.
Its Windows UI workflow passed import/search/source opening, atomic rejection,
duplicate handling, recovery and close/reopen; the original engine opened a copy
of that native vault. The original Mammoth parser agrees on normalized fixture
words and the common heading, not formatting or all DOCX content. See
[DOCX import limits](DOCX_IMPORT.md) and `evidence/native-docx-workflow.json`.

All 34 Rust unit/integration tests passed across core, documents and inference;
strict Clippy passes for those crates and the desktop. The pure shared quote
module also matches 24 original anchor cases and 11 source catalogs, including
UTF-16 offsets, whitespace and ambiguous quotations. These helpers are not yet
wired into desktop checked QA and establish source membership, not entailment.
See [source quote boundary](SOURCE_QUOTES.md). Repository ESLint passes locally.
The pure original quantity annotation and numeric-interpreter helpers also match
307 and 364 complete original output fixtures respectively. Their limits and
pending runtime integration are recorded in [SOURCE_QUANTITIES.md](SOURCE_QUANTITIES.md)
and [SOURCE_CALCULATIONS.md](SOURCE_CALCULATIONS.md). The latter enabled precise
JSON floating-point roundtrips after an edge fixture exposed default-decoder loss.

A normal Windows release executable at `3758800` (before the arithmetic-interpreter
commit) was built separately from ui-test, and passed five actual PDF/DOCX worker
checks. It is 14,175,232 bytes; exact SHA-256 and scope are in
`evidence/windows-normal-executable.json`. This is an executable artifact, not an
installer comparison or a completed/signed replacement.

The original TypeScript AuthService/sqlite3mc also opened a **copy** of the
native-created vault after native password recovery and read its document. The
original fixture generator and `read-native-with-original.ts` provide both
compatibility directions without opening personal data.

BGE-M3 Windows native CPU inference produced real 1024-dimensional normalized
DE/EN embeddings. The first Qwen3.5-4B generation smoke was terminated by its
own host-memory watchdog below 768 MiB available, before an answer. A later
CPU-only run with sufficient available RAM returned the correct synthetic code
and canonical citation in 20 stream fragments; its fixture is committed under
`evidence/native-qwen-answer.json`. The native loader requires GGUF size plus 2 GiB of
available memory for generation (1 GiB for embedding), and generation checks a
768 MiB floor between evaluation batches. These are conservative admission
guards, not a replacement for the original complete resource planner.

A real pinned-GGUF metadata/vocabulary-only test confirmed Qwen4B ChatML and
the no-thinking template suffix. The generation path tokenizes untrusted content
without special-token parsing, separately from structural role delimiters;
literal control tokens in malicious source text did not create extra roles.
This is a framing check, not semantic prompt-injection immunity.

The first shell executable was 8,315,904 bytes, before native inference was linked.
This is not an installer size and excludes shared WebView2. A single automated
startup observed 427 ms, but it ran during builds and is not a comparative result.
Electron's five preliminary launches also ran under contention; invalid CPU
samples and unmatched conditions prohibit a speed/memory claim. A quiet paired
startup benchmark, package inventory and cold-cache protocol remain release gates.
The later corrected process-tree memory/CPU samples are reported separately in
PERFORMANCE.md, with the initial PID-reuse-contaminated pass discarded.

The default model remains the current installer's Qwen3.5-4B Q4_K_M. Its manifest
contains an Xet hash rather than a SHA-256. The canonical local 2,740,937,888-byte
file was read-only hashed on 2026-11-19 as
`00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`.
This is a local compatibility pin, not an upstream authenticity attestation.
The legacy 2B entry is not the new default.

Native derived vectors currently use a versioned table inside the encrypted
sqlite3mc database, checkpointed per chunk and strict model/runtime fingerprint.
This bounded exact-scan preview preserves original Lance files. It is not a
performance recommendation or a completed Lance migration. Peer Lance/Qdrant
measurements will inform the long-term index adapter.

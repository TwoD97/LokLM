# Application review — 18 October 2026

This review starts from `4651557` (v0.7.4 main) on the local
`codex/hermes-reliability` branch. It covers the major application workflows,
runtime services, persistence, installation, and website. Changes address
reproduced failures and missing lifecycle guards. Source review and automated
tests do not establish complete accessibility, native performance, or answer
quality.

## Hermes lessons applied

Hermes' [auxiliary client](https://github.com/NousResearch/hermes-agent/blob/main/agent/auxiliary_client.py)
distinguishes request deadlines, stream inactivity, task-specific budgets, and
explicit cancellation. Those principles inform LokLM's local provider changes;
the implementations remain specific to Electron, Ollama, and LokLM's existing
worker queues. No Hermes code or remote agent execution is added.

The preceding commit, `c9cebbc`, bounds Ollama requests through body consumption,
cleans up cancelled streams, prevents provider fallback from mixing a second
answer into already displayed text, distinguishes reasoning-only replies, and
uses a short, non-thinking budget for conversation titles. Its focused regression
run passed 349 tests across 21 files; four real HTTP redirect tests could not run
because this sandbox cannot bind sockets.

## Coverage and changes

| Area                                   | Review and resulting behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup, authentication, recovery      | Reviewed authentication epochs, pending form actions, session closure, and recovery display. An explicit lock now removes recovery words from the screen; successful registration still displays them.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Shell, navigation, window controls     | Reviewed workspace activation, serialized mutations, persistent tabs, lazy loading, error boundaries, and background effects. Delayed maximize snapshots cannot overwrite newer events. Lock/quit overlays capture focus and suppress underlying quiz shortcuts.                                                                                                                                                                                                                                                                                                                                                                                           |
| Chat and source readers                | Reviewed send, stop, regenerate, conversation navigation, citations, markdown rendering, source readers, IME handling, memoization, and scrolling. Conversation list/deletion replies cannot update a retired workspace. Source menu entries have explicit accessible names.                                                                                                                                                                                                                                                                                                                                                                               |
| Library, folders, summaries            | Reviewed search request ownership/debounce, pagination, missing/failed documents, import/status flows, previews, and folder mutations. Documents/folders are keyboard reachable; folder context menus support keyboard opening/navigation. Summary dialogs contain focus, announce failure, and offer retry.                                                                                                                                                                                                                                                                                                                                               |
| Shared controls, styling, localization | Reviewed themes, system theme subscription cleanup, focus outlines, reduced motion, skip links, and translation dictionaries. Select menus preserve Tab order, stop Escape propagation, scroll the active option, handle shrinking/empty lists, and close on outside focus.                                                                                                                                                                                                                                                                                                                                                                                |
| Settings and providers                 | Reviewed settings hydration, queued saves, Ollama endpoint/model selection, preference errors, model downloads, and module controls. Failed initial settings reads expose retry. Delayed saves preserve newer endpoint/token drafts. Model chips support arrow navigation.                                                                                                                                                                                                                                                                                                                                                                                 |
| Quizzes                                | Reviewed creation, merge, regeneration, attempts, answer permutations, scoring, results, and source viewing. Failed scoring offers retry on the same attempt, reconciling a possibly committed result first. Stale reads cannot start new work after navigation. Global shortcuts ignore other controls/dialogs.                                                                                                                                                                                                                                                                                                                                           |
| Organizer                              | Reviewed optimistic revision checks, durable KV writes, corruption handling, date/time validation, and renderer mutation/error flows. Note and calendar labels separate their fields for assistive technology.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Writing and translation                | Reviewed input/context budgets, completion checks, segmented translation, cancellation, status updates, saving/copying, and view teardown. Rewrites reject incomplete model output. Late UI replies are ignored, clipboard timers are disposed, tabs support keyboard navigation, and generation activity lasts until work settles.                                                                                                                                                                                                                                                                                                                        |
| Audio/transcription                    | Reviewed microphone permission, recording, decode/staging, batches, progress, export, native worker ownership, and cancellation. Permission results arriving after navigation stop their tracks. Retired recorder callbacks cannot touch a newer recording. Cancelling preparation prevents dispatch, discards abandoned staging files, and cancels remaining batch items. Active native reads retain ownership of their PCM until cleanup.                                                                                                                                                                                                                |
| IPC and session boundaries             | Reviewed private admission, sender/session ownership, shutdown drains, preload exposure, navigation restrictions, and external URL handling. Audio staging is now bound to its renderer owner, with a private discard operation; temporary PCM files use restrictive permissions.                                                                                                                                                                                                                                                                                                                                                                          |
| Retrieval and model runtime            | Reviewed retrieval fanout, fusion, caches, reranker fallback, context budgeting, prepared contexts, load coalescing, provider session guards, worker priority/serialization, GPU leases, and residency. Corpus and summary embedding work now receives cancellation. Queued audio cancellation returns promptly without releasing an occupied native slot; workers that finish spawning after reset are terminated.                                                                                                                                                                                                                                        |
| Documents and code ingestion           | Reviewed parser/chunker boundaries, indexing queue/lifecycle, folder synchronization and path ownership, gitignore layering, generated documents, indexed PDF identity checks, and atomic exports. Existing workspace-pinned background operations and revision checks are retained.                                                                                                                                                                                                                                                                                                                                                                       |
| Workspace metadata and encrypted files | Metadata mutations use isolated candidates and serialize publication after successful encrypted vault persistence. Failed changes cannot leak into later settings/KV snapshots. Close rejects unstarted work and waits for started writes. Deletion preserves files when manifest persistence fails. New directories have UUID suffixes so reused numeric IDs cannot adopt orphaned bytes. Index builds retain vector ownership. Encrypted file I/O handles short reads/writes, validates framing before allocation, and rejects files truncated during encryption. Positional block rewrites replace bytes in place and correctly shrink the final block. |
| Model provisioning                     | Pinned runtime downloads hash and reuse saved prefixes, validate HTTP ranges and declared completion, reject prefix replacement during the header wait, release rejected response bodies, and preserve original model files until replacement succeeds. Existing install manifests, availability checks, invalid-file markers, and provisioning scripts were reviewed.                                                                                                                                                                                                                                                                                     |
| Installer and release tooling          | Reviewed wizard startup/progress, hardware selection, destination validation, download/archive paths, payload transactions, release manifests, checksums, and CI gates. Startup failures now expose retry instead of leaving the splash stuck; delayed hardware recommendations preserve manual tier choices. Rust follow-ups requiring native validation are listed below.                                                                                                                                                                                                                                                                                |
| Website                                | Reviewed download/platform information, mobile navigation, progressive HTML, localization, metadata, release data, and build-time GitHub requests. Independent GitHub reads run concurrently with bounded body consumption. Cache entries validate their repository, timestamp, and shape; absolute cache paths create the correct directory.                                                                                                                                                                                                                                                                                                              |

## Validation environment and results

Node 24.22.0 is available. The checkout's dependency directory points to an older
Windows dependency cache. A separate cached Linux Vitest 5.0.3 runner is available;
the repository pins Vitest 4.1.11. Ignored helper configurations preserve the
repository's project boundaries and aliases while making offline checks possible.
The renderer helper bridges the cached jest-dom/Vitest matcher incompatibility.
Neither dependency versions nor repository test requirements were weakened.

Current results:

- Renderer workflow group: **101 passed across 18 files**, covering settings,
  organizer, quiz dialogs, writing, translation, and transcript display. Final
  core UI runs passed **43 tests across ten files**; source-menu checks passed
  **18 tests**. The recorder/transcription hooks passed **12 tests** and the
  scoring runner **13 tests**, including per-deck retry isolation. Localization
  parity, encoding, and settings dictionary checks passed **eight tests**.
- A broad all-renderer attempt was interrupted after prolonged cached-dependency
  loading; it is not a completed full-suite result. Focused final runs above
  replace that attempt for the changed workflows. Two new test expectations were
  corrected (the actual Unlock label and the results screen's separate history
  request); production behavior was not weakened to satisfy tests.
- Backend audit: **711 passed, two skipped across 60 files**. The two unchanged
  first-token wrapper tests require node-llama-cpp 3.21 features absent from the
  cached 3.18 SDK. Strict targeted TypeScript, formatting, and ESLint pass.
- Storage, model resume, and audio staging regression group: **43 passed across
  five files**, including actual filesystem short-I/O and encrypted corruption
  recovery checks.
- Additional unit sweep: **2,899 passed**, four PDF assertions failed because the
  cached PDF runtime lacks `DOMMatrix`, and two authentication files could not
  load the Windows Argon2 binary on Linux. These failures do not establish a
  regression in the changed code.
- Shared/main/preload and existing installer frontend group: **162 passed across
  14 files** before the new installer regressions. The expanded installer group
  separately passed **18 tests**.
- Website: **182 passed**; 45 generated-output tests skipped without an Astro
  build. Three suites could not load missing Astro/RSS/Markdown dependencies.
  The changed GitHub fetch/cache suite passed **19 tests** and strict TypeScript.
- The broad infrastructure run is **not green**: 395 passed, 125 failed, two
  skipped, and three collection failures. Installed dependency/security patch
  tests encounter stale cached packages, restricted child processes, unavailable
  Linux native compression/Whisper bindings, and a missing module. The pinned
  dependency installation and ordinary CI remain necessary.

Counts above belong to separate runs, overlap, and must not be added as a single
full-suite result. Detailed local selections/results live under ignored
`node_modules/.cache/loklm-offline/`.

The full node typecheck still reports the existing older-SDK field/type mismatch
and unavailable axe Playwright declarations. The test-inclusive renderer check
encounters cached matcher declaration incompatibilities; production renderer
TypeScript is checked separately. Scoped ESLint uses the repository's rules with
only TypeScript project-service discovery disabled, paired with strict compiler
checks. Final scoped lint reports zero errors; two ChatView cleanup-counter
warnings remain because cleanup intentionally increments the latest request
generation. Formatting passes for the complete renderer directory and changed
installer/website files. Exact pinned dependency CI is not certified by this
environment.

## Remaining validation and follow-ups

- Run the repository's normal install, typecheck, lint, application/integration/TX
  tests, website build/browser checks, and native installer CI on supported
  dependencies. Linux socket binding, native SQLite/Lance/Argon2, Electron,
  Whisper, Rust, and GPU execution are unavailable here. No fresh application
  screenshots, screen-reader certification, or VRAM/latency benchmark is claimed.
- Rust `download.rs` accepts HTTP 206 without validating `Content-Range` and
  rejects HTTP 416 repeatedly. Some installer models lack pinned hashes, making
  exact range validation significant. Platform failure paths also discard
  resumable partials after transient retries. These need Rust download tests and
  platform validation before changing the installer transport.
- Tier marker writes are outside parts of the payload transaction, particularly
  on macOS. Atomic marker publication/rollback should be tested with interrupted
  install and commit failures. Archive traversal checks and journal ownership,
  exclusive locking, rollback, and recovery remain intact.
- A filesystem failure after durable workspace removal can leave an orphaned
  encrypted directory. New unique directory names prevent reuse, but automatic
  orphan cleanup is not introduced.
- Large document trees render incrementally rather than using full
  virtualization; complete tree-style Up/Down focus navigation remains future
  UX work. Native performance evidence should guide further rendering changes.
- Existing native RAG semantic failures documented in the
  [earlier audit](2026-10-05-bug-audit.md) remain unresolved. Lifecycle tests and
  valid citations cannot prove an answer is supported or complete. No model,
  retrieval ranking, decoding default, or sealed evaluation is changed here.

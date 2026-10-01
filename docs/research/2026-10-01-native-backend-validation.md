# Native backend validation — 2026-10-01

The initial backend queue passed on one compiled snapshot: matched 4K allocation
reuse control/candidate, real Ollama HTTP 503 fallback, held file dialogs across
session/workspace changes, and offline OCR in the actual documents utility
process. Runs used disposable vaults/profiles and synthetic sources. No production
code or compiled files changed during this queue.

That snapshot preceded the final asynchronous lock-drain and vector-membership
fixes. The later candidate recheck is reported separately below; the earlier
matched control/candidate timings remain evidence from their original build.

## Allocation reuse across lock/unlock

Control ran 17:10:02–17:11:57 UTC; candidate ran 17:12:22–17:13:37 UTC.
Both explicitly requested 4,096 tokens, used default inference thread/reserve
settings, and disabled experimental citation aliases/source marker footers.
`LOKLM_REUSE_GPU_LAYER_PLAN` was the only intended control/candidate configuration
change: `0` versus `1`.

| Phase                                      |  Control | Candidate |              Difference |
| ------------------------------------------ | -------: | --------: | ----------------------: |
| Cold registration and warmup               | 37.733 s |  37.694 s |                 0.039 s |
| Sequential lock, login and warmup          | 38.477 s |  18.236 s | 20.241 s faster (52.6%) |
| Concurrent lock/login admission and warmup | 37.408 s |  18.221 s | 19.187 s faster (51.3%) |

Every phase used Qwen3.5-4B-Q4_K_M, Vulkan on the GTX 1050 Ti, 4,096-token
context, q4_0 KV, and 15 GPU layers out of 33. Each phase started exactly one
fresh models worker. Both candidate unlocks restored one qualified allocation
hint, recorded one cache hit with current memory revalidation, and recorded zero
cache fallbacks. Control recorded no seeds or hits. Lock completion preceded
login completion, and private settings IPC remained usable after each unlock.

This measures complete authentication/model restoration, not isolated inference
latency. It is one matched pair with two unlock phases, not a broad hardware
benchmark. Capacity and placement stayed constant; no answer-quality claim comes
from these restoration-only tests. Native private model/session state was still
destroyed at lock; only bounded numeric allocation metadata survived.

Evidence:

- `out/optimization-20261001/native-final-backend-restore-control-r2/restore.json`
- `out/optimization-20261001/native-final-backend-restore-candidate/restore.json`
- Adjacent `app.log` files and sibling `*-console.log` files.

## External failure with local GPU fallback

The loopback-only failure test passed at 17:14:17–17:15:17 UTC. It configured only
an Ollama chat model; remote embedding/reranking model names were null. Its local
HTTP stub received exactly one unauthenticated `/api/chat` request requesting
8,192 context tokens and 2,048 output tokens, then returned HTTP 503.

The real bundled path answered in 50.823 seconds including retrieval and loading:
“The Riverside Library opens at 09:00 on Monday. [doc:1, chunk:1]”. The answer,
exact source citation, terminal event and persisted message agreed. Native chat
used 4,096 context tokens, 15 GPU layers and a 1,024-token output cap. No context
shift or changed-capacity refusal appeared. The final status retained the selected
Ollama source plus `fallback.active=true`, reason `HTTP 503`, and the real local
model's ready/resident state.

This proves the cold external-to-local path. The rarer parked-context shrink
boundary is covered separately by deterministic native-budget unit tests; this
run does not claim to force a late 8K-to-4K restoration race.

Evidence: `out/optimization-20261001/native-final-backend-fallback/fallback.json`
and its adjacent `app.log`.

## File dialog session and workspace boundaries

`session-dialogs.spec.ts` passed in approximately one minute on its third harness
attempt. A folder picker opened before lock was resolved after login; its old
request rejected and created neither folders nor documents. For source
replacement, two libraries deliberately contained colliding document and
conversation IDs. The test selected libraries through the actual sidebar and
waited for LibraryView, which renders after backend activation completes.

Immediately before resolving A's picker, and again after A finished reindexing,
an ID-based conversation read identified B as the active backend workspace and
an ID-based generated-source read returned B's original source. A's path/title
and chunk content changed as intended; B's metadata, hash and source did not.

Evidence: `out/optimization-20261001/native-final-backend-session-dialogs-r3-console.log`
and the passing native spec assertions. The body-only Playwright attachment is
not a separately retained JSON file under the list reporter.

## Offline OCR in the actual utility process

The OCR test kept the app locked and loaded no GPU models. It sent two concurrent
parse/chunk requests with the same document ID but different request IDs to the
compiled documents utility process. Each real mixed PDF had a selectable first
page and a raster-only second page. Both replies preserved two ordered chunks
and page ranges; OCR recovered the scan marker, `09:45`, participant count `27`
and room `B-14`. Progress arrived for request 2 and then request 1, correctly
identified as one OCR page each. Shutdown acknowledgement and process exit code
0 were observed. Worker elapsed time was 5.568 seconds; the test passed in 6.4
seconds (8.9 seconds including runner startup).

This covers Electron utility-process PDF rendering, offline Tesseract wiring,
concurrent progress routing and clean shutdown. It does not establish general
OCR accuracy for rotated pages, tables, photographs or handwriting.

Evidence:
`out/optimization-20261001/native-final-backend-documents-ocr-playwright/documents-worker-ocr-docum-7c6d0-concurrent-request-identity/documents-worker-ocr/ocr.json`.

## Snapshot and retained failed harness attempts

All eight compiled Main/worker/shared-chunk/Preload hashes matched before and
after each fingerprinted run and between control, candidate, fallback and OCR.
Entry hashes:

| File                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `out/main/index.js`           | `e5863577c39f4854ae7c5d11fb460cba1d08ad6c5dff2288c7993eee9afa4fae` |
| `out/main/modelsWorker.js`    | `9b82003d8cf014673ed145ce4a9af062d5bc5394879cf74566ef0ec834050cd0` |
| `out/main/documentsWorker.js` | `bb30f2ab76db66c9c307d7b4487397ddb20f9fc47a125633c992ba03d8000b40` |

Earlier attempts were retained, not overwritten:

- `native-final-backend-restore-control`: all functional assertions completed,
  but cleanup queried Playwright's process handle after closing Electron. The
  harness now retains the handle before close; control-r2 passed completely.
- `native-final-backend-session-dialogs`: the last active-ID source read returned
  null. Setup mixed direct IPC workspace changes with a shell still completing
  post-login default activation, so this did not isolate background indexing as
  the cause. The final test uses real UI selection and explicit backend identity
  checks on both sides of indexing; it passed without a production change.
- `native-final-backend-session-dialogs-r2`: a test locator required an exact
  workspace button name, omitting its accessible encryption-icon label. The
  name selector was corrected; exact heading/activation checks remained.

The preceding focused validation passed 62 tests across provider/session,
context-budget, cancellation, model residency and QA live-context suites, plus
full Node TypeScript and scoped ESLint. The native queue introduced only the
described test harness corrections. Packaging/installer validation is separate.

After those harness corrections, the complete `pnpm typecheck` (`tsc -b` across
all project references) and forced scoped ESLint for the restore, fallback,
session-dialog and documents-worker OCR specs also passed.

## Post-drain candidate recheck on the later build

A later build adds two related lifecycle fixes. Vector writes check live
`(chunkId, documentId)` ownership while holding the vector-operation lease.
Deletion/reindex retires SQLite rows before queuing the old vectors' removal,
so a late embedding cannot reinsert a deleted source. Cleanup for already-retired
rows continues after session invalidation. The authentication pre-lock hook now
closes admission synchronously and awaits admitted cleanup before closing stores
and wiping keys. Main waits for every private drain even if another drain fails.

This preserves a limitation: SQLite and LanceDB are separate stores. A failed
native purge is logged and remains best effort; a storage error or process crash
can leave derived vectors without source rows. Live-source hydration prevents
those rows from becoming returned source text. This is not a cross-store atomic
transaction claim.

The final native recheck used the later compiled build without rebuilding or
changing production code between tests. It ran approximately 17:45–17:49 UTC:

| Check                        | Result                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Cold registration/warmup     | 37.695 s                                                                                                              |
| Sequential lock/login/warmup | 18.221 s                                                                                                              |
| Concurrent lock/login/warmup | 18.182 s; lock completed before login                                                                                 |
| Generated source lifecycle   | Passed in 50.8 s: cancel, reindex, export, lock/restart, encrypted-at-rest scan                                       |
| Native PDF workflow          | Passed: 40 chunks and 40 vectors in 27.401 s, 16 progress events, painted PDF reopen, cancel and explicit chat warmup |

Every restore phase retained 4,096-token context, q4_0 KV and 15 GPU layers.
Both unlocks launched one fresh worker, restored one qualified hint, recorded
one cache hit and no cache fallback. This confirms preserved behavior on the
newer build; the control was not rerun, so these timings are not a new matched
performance comparison. Native apps and temporary vaults were cleaned up after
each test before releasing the GPU slot to the renderer checks.

All eight compiled Main/worker/shared-chunk/Preload hashes stayed unchanged
through this queue. The later Main entry is
`2598502236d6e4bfee8744e6e5f20ec611eb939d5fb61706b2f146120e0973a8`;
modelsWorker and documentsWorker hashes are unchanged from the earlier table.

Evidence:

- `out/optimization-20261001/native-post-drain-restore/restore.json` and `app.log`
- `out/optimization-20261001/native-post-drain-generated-console.log`
- `out/optimization-20261001/native-post-drain-indexing-console.log`
- `out/optimization-20261001/native-post-drain-indexing-playwright/` contains the synthetic PDF workflow screenshots
- `out/optimization-20261001/native-post-drain-snapshot.json` records the final eight-file hash comparison

Before this build, 33 tests across five auth suites passed, including real
SQLite cleanup through a held asynchronous pre-lock hook, concurrent login
ordering, synchronous/asynchronous hook failures, and keyless drain rejection
handling. Scoped ESLint and Node TypeScript also passed.

The full validation immediately before the later build passed 2,312 unit tests
and 251 database/transaction tests, with eight intentionally gated tests skipped.
Full project typecheck, full ESLint (zero errors and zero warnings), and the
production build passed. Final packaged executable evidence is recorded
separately after packaging this later build.

## Packaged Windows executable

Electron Builder 26.15.3 packaged the later build with Electron 42.11.10 into
`release/optimization-final/win-unpacked/`. The package contains only the
configured application output, production dependencies and package metadata;
no calibration runs, test profiles or downloaded models were included. All 112
files under Main, Preload and Renderer matched the SHA-256 manifest recorded
before the final native UI suite, including its eight backend JavaScript files.
The unpacked resource directory contains both application icons and the English
and German offline OCR data.

Reading the shipped executable's fuse wire confirmed RunAsNode, Node options
and Node CLI inspection disabled, with cookie encryption and ASAR-only loading
enabled. The smoke test launched that executable with a disposable profile and
vault and attached only to Chromium; it did not weaken these fuses. Encrypted
notes, tasks and generated document text survived a complete app restart, the
Notes screen rendered, and the final vault lock succeeded. The test passed in
3.9 seconds (4.6 seconds including the runner), with no renderer errors. Cleanup
left no Electron or LokLM processes.

This was a model-free packaged persistence check. Native inference and rendering
are covered by the separate tests above and the renderer review. The executable
is unsigned (`Get-AuthenticodeSignature`: `NotSigned`); this pass did not execute
the installer or update flow, sign a release, or validate macOS/Linux packages.
Nothing was published or deployed.

Evidence: `out/optimization-20261001/package-release-final.log`,
`build-artifact-manifest.json`, `package-inspection.json`, and
`packaged-release-final.log`. The root and website dependency audits also reported
zero known advisories for their installed lockfiles (`audit-root-final.json` and
`audit-website-final2.json`); that is an advisory snapshot, not a security
certification.

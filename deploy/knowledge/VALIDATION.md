# Validation and release gates

Environment: Windows MSVC Rust 1.95.0; Linux Docker through WSL Ubuntu;
Docker 29.9.3 / Compose 5.7.1. All knowledge content used in tests is synthetic.
No production server/vault was contacted. No GPU, LoRA, training, shared model unloading
or changes to the separate Macro/Zero tree. Unraid is unavailable and untested.

## Executed checks

| Check | Observed result |
|---|---|
| Windows knowledge crate | 15 tests pass: 2 file + 5 integration + 1 answer + 1 reranker transport + 6 original shared compatibility fixtures under the daemon lock |
| Basic QA adapter | 1 synthetic HTTP integration test passes: original core prompt use, actual-tokenizer request, citation-to-UUID mapping, unknown citations refused, no-evidence refusal, busy429, cancellation408 |
| Shared pure core | 12 tests pass: 6 unit + 2 original cipher/chunker compatibility + 2 original QA + 2 source-quote fixture tests; storage feature disabled |
| Linux container with Lance | Optimized production build passes; 16 tests pass (Windows cases plus Unix symlink rejection), including shared reranker preparation, HTTP score normalization and source-quote fixtures |
| Python source backup | 2 tests pass: Unicode/binary roundtrip, no overwrite, hostile archive traversal refused |
| Python prepare-new-vault | 2 tests pass: original bytes preserved, CRLF/frontmatter and attachments, persistent IDs on repeat copy, duplicate ID rejection |
| Fresh provisioning | Actual packaged CouchDB configuration + upstream CLI setup passes; settings mode0600, E2EE, nonadmin sync user, repeated initialization refused |
| Compose | Base + models + experimental answer + GPU-preparation + local-access overlays validate with synthetic environment values; no deployment performed |
| LiveSync end-to-end | 25 checks pass with actual Qwen3-Embedding GGUF and Rust/Lance debug process; another 25 pass with the release service, production CouchDB config and sidecar entrypoint in lexical mode; see separate evidence JSON |
| Actual CPU model integration | 20 checks pass on release source `5e99843`: Qwen3 embedding, BGE reranking with original sigmoid scores, Qwen3.5-4B DE/EN answers and source identity, scope/refusal, literal role-marker rejection, bounded pipeline cancellation and unchanged dedup |

Shared source-quote integration at `de07612` adds the desktop owner's pure
`c418292` module and two tests covering 24 original anchor/context cases and
11 catalogs, plus cache mutation and forged offsets. The generator passes a
targeted ESLint check with an explicit Node console import. These helpers are
available for future checked-QA integration; current generated answers still
validate citation identity only. This integration loads no models and does not
change the previously tested answer transport or model fingerprints. Its rebuilt
image and the earlier actual-model image are recorded separately in the evidence.

The actual model smoke uses pinned llama.cpp b12359, two CPU threads per
dedicated provider, no GPU, a 10 GiB physical-memory admission check and a 2 GiB
watchdog. The window was coordinated with the desktop owner after available RAM
recovered; no shared model or global WSL/cache setting was changed. All own test
containers were removed afterward. `evidence/models-cpu.json` records the actual
synthetic answers, source hashes, model fingerprints and image identities.

Both answers correctly report 42 solar panels and cite the supplied Unicode
Markdown source. The pinned template's disabled-thinking suffix was verified
through `/apply-template`. The actual rerank response exposed raw logits, so the
HTTP adapter now applies the original `node-llama-cpp` sigmoid exactly once and
versions that contract in its fingerprint. The tests check individual examples,
not broad model quality, semantic entailment or full checked-answer/router parity.
Cancellation was tested at the active model-pipeline boundary, not as a claim of
desktop streaming UI parity. Recorded request elapsed times are descriptive,
not controlled performance distributions.

The LiveSync test uses pinned upstream commit
`5b57324bc72a6c7a330c280b876ae9c6f8e83221` (1.0.51), its locked commonlib 0.6.0,
and CouchDB 3.5.0. It transfers encrypted Markdown with DE/EN Unicode names and
a 256 KiB binary attachment between two real peers, edits both directions,
retains/retrieves both concurrent offline revisions before explicit resolution,
starts both daemon mirrors, watches edits/rename/delete, restarts Rust against
the replicated vault, verifies source IDs/opening paths, source filtering and
unchanged-content dedup, then checks hostile path, bad auth and CouchDB outage.
The binary attachment SHA-256 is
`2312394bd99545d9de131c24efb781e765ac1aec243f2ed9347597a793a415e9`.
**No Obsidian UI was exercised. CLI/protocol compatibility is not UI parity.**

## Same-vector store benchmark

The synthetic corpus contains 32 actual Qwen3-Embedding-0.6B Q8_0 passage vectors,
16 German/English query vectors and eight expected source IDs. Models use the
audited LokLM instructions and normalization. The fixture contains no private
text; it is generated outside Git by `make_benchmark_corpus.py`. Fixture SHA:
`d1b1a60687c17003af977d7e18316766e22f8e87a441058f430cb51d725c01bb`.

Both official Rust SDKs receive exactly these vectors and source filters. Ingest,
delete/reinsert, 160 warm searches, filtered search and 100 searches during ten
writes are timed independently of model inference. Recall@5 uses exact cosine
over the supplied vectors, not an LLM judge. Source accuracy@1 uses the fixture's
expected source. Small collections use default exact search; this is **not** an
ANN scalability/production capacity result.

Initial **debug-build smoke** measurements (milliseconds, contention possible):

| Store | First query | Warm p50 / p95 | Filter p50 / p95 | Recall@5 / source@1 |
|---|---:|---:|---:|---:|
| LanceDB 0.41.0 | 12.08 | 8.40 / 9.29 | 13.01 / 14.02 | 1.00 / 1.00 |
| Qdrant client/server 1.20.0 | 2.90 | 0.96 / 1.14 | 1.04 / 1.24 | 1.00 / 1.00 |

Debug client peak RSS: Lance ~156 MiB; Qdrant ~51 MiB plus separate server. Initial
server RSS was sampled **after collection deletion** and is not a valid total
working-set comparison; the runner now retains its disposable collection until
measurement/restart recovery is complete. Lance's initial on-disk bytes were
336,301 including mutation versions. The test-runtime image was ~1.18 GB and
the upstream Node sidecar image ~716 MB; debug image size is not release binary
size.

Optimized measurements in the agreed CPU window, with both agents' model loads
idle (two-CPU container limits, inference excluded):

| Store | First query ms | Warm p50 / p95 ms | Filter p50 / p95 ms | Search under writes p50 / p95 ms |
|---|---:|---:|---:|---:|
| LanceDB 0.41.0 | 7.59 | 1.59 / 1.69 | 2.02 / 2.17 | 4.09 / 4.75 |
| Qdrant 1.20.0 | 2.07 | 0.45 / 0.54 | 0.51 / 0.61 | 0.48 / 0.58 |

Both again reach recall@5 = 1.0 and expected-source@1 = 1.0. Ingest: Lance
6,009 rows/s, Qdrant 8,005 rows/s; these rates divide **only 32 rows** by a few
milliseconds and must not be extrapolated to sustained ingest. Delete/reinsert
one source: Lance 3.12/2.74 ms, Qdrant 0.87/0.97 ms. Client peak RSS: 92.7 MiB
versus 6.6 MiB; Qdrant also used 27.45 MiB server memory at the post-write sample.
Lance apparent index bytes: 336,302. Qdrant apparent storage directory bytes:
205,588,910, including WAL/segment reservations; this is not pure vector payload
or allocated-block measurement. Qdrant retained its collection for this sample,
then restarted and answered from persisted storage in ~818 ms including Docker
restart/readiness overhead. Lance new-handle/open/search took 5.78 ms; that is
not an equivalent process restart test. Full reports are in `evidence/*-release.json`.

Release binary bytes: daemon with Lance 242,392,872; standalone Lance benchmark
234,582,600; Qdrant-only benchmark 6,051,016. The production Docker image was
475,912,689 bytes at measurement, including runtime and copied dependency notices;
benchmark image 805,666,687 bytes. The first optimized service build took
37m54s at `-j 2`; cached code-only rebuild took ~30s. Store benchmarks now compile
as separate binaries to avoid Cargo feature unification rebuilding the large
Lance dependency graph and to expose each client's actual binary/RSS cost.

No universal speed claim follows. In this tiny smoke test Qdrant was faster;
Lance remains the initial embedded candidate pending larger corpus/quality and
resource measurements. Its Arrow/DataFusion/native dependency cost is material.
The daemon currently implements Lance and the SQLite reference path; Qdrant is
a benchmark comparison, not an untested selectable production backend.

Cold hardware cache p50/p95 is **not measured**: this shared machine's global
caches were not flushed. First query, new client handle and restart metrics are
separately labelled and must not be presented as disk-cold latency. Embedding
timings in the vector fixture were collected during other compilation and are
not accepted model-performance numbers. Reranker and generator latency are not
included in storage timings.

Reproduce, after creating the fixture with a dedicated model server (see script
`--help`, never point it at an active voice session):

```sh
docker build --target benchmark -f deploy/knowledge/Dockerfile -t loklm-test-knowledge:release .
python3 deploy/knowledge/run_store_benchmark.py /absolute/synthetic-vectors.json --image loklm-test-knowledge:release
```

The runner creates a private network and disposable Qdrant storage, applies
two-CPU limits, writes reports under ignored `deploy/knowledge/reports`, and
cleans only its UUID-prefixed resources. Store-only timings are reproducible
without loading an embedder again. The service takes an exclusive owner lock;
never benchmark against a live appdata index.

## Remaining acceptance gates

* Real Obsidian UI configuration and two-device interoperability on the target
  environment, including conflict UI and actual supported settings combinations.
* Fresh Unraid installation, filesystem/UID/permission validation, backup restore
  drill on the target SSD, network gateway and optional GPU build/runtime.
* Broader answer quality and full shared checked-answer/router/entailment parity;
  the actual BGE/Qwen transport smoke is now passed, not a replacement for these.
* Larger representative synthetic corpus, controlled
  process/disk-cold distributions, sustained writes/compaction and crash injection
  during commits. Current restart recovery rebuilds all Lance rows from SQLite;
  it never re-embeds, but is not yet optimized for large vault startup.
* Managed-ID requirement and Markdown-only parser are deliberate v1 boundaries.
  Existing arbitrary Obsidian notes need new-vault preparation; no live mass
  frontmatter rewrite is performed. Upstream-sidecar filesystem atomicity is not
  claimed solely from the daemon's own atomic import implementation.

The draft PR adds model-free Linux/Windows knowledge checks. Existing website CI
initially failed before tests because locked Playwright 1.60.0 rejected the new
`ubuntu-latest` Ubuntu 26.04 image. Isolated fix `f76db5e` pins Ubuntu 24.04;
the website types/tests/build check then passed. The later Application check
found missing Node-global declarations in our provisioning script; `24304e4`
fixes those without disabling lint rules and passes a targeted ESLint run.
Knowledge Linux/Windows and website checks pass at source `5e99843`.
Remaining Application/final-head CI results are tracked
on draft [PR #50](https://github.com/TwoD97/LokLM/pull/50), not treated as already green.

## Manual testing

1. Build the images and run `test_provision.py`/`test_livesync.py` on disposable
   directories, optionally setting the dedicated test model mount. Expect all
   listed checks and no public test ports or retained test containers.
2. Prepare a new copy of a synthetic vault with `prepare_vault.py`; compare original
   hashes, Markdown IDs and attachment bytes. A second copy to an existing target
   must fail; duplicate IDs must block reconciliation without deleting old state.
3. Start the daemon with separate vault/index paths and a private token file. Query
   status and search with/without the bearer token; expect 200/401. Rename a note,
   wait for reconciliation, and verify the UUID persists and opening path changes.
4. Change one chunk, reconcile, and inspect embedded/reused counts. Reconcile again
   unchanged: embedded must be zero. Restart and repeat. Change the configured
   model runtime fingerprint against the same index: startup must refuse mixing.
5. Run source-scoped search, submit a UUID request ID, cancel an active model request,
   and lock the service. Expect no cross-source hits, cancellation/busy bounds and
   423 after lock. Use separate instances/tokens for trust domains.
6. Stop sync/editors; back up, verify, restore to a new directory and rebuild a new
   index. Notes and attachment hashes must match. Never test restore over a live
   vault or reconnect a restored snapshot to an existing remote without review.

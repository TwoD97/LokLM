# Validation and release gates

Environment: Windows MSVC Rust 1.95.0; Linux Docker through WSL Ubuntu;
Docker 29.9.3 / Compose 5.7.1. All knowledge content used in tests is synthetic.
No production server/vault was contacted. No GPU, LoRA, training, model unloading
or changes to the separate Macro/Zero tree. Unraid is unavailable and untested.

## Executed checks

| Check | Observed result |
|---|---|
| Windows knowledge crate | 2 file tests + 4 integration tests pass |
| Basic QA adapter | 1 synthetic HTTP integration test passes: original core prompt use, actual-tokenizer request, citation-to-UUID mapping, unknown citations refused, no-evidence refusal, busy429, cancellation408 |
| Shared pure core | 5 unit + 2 original cipher/chunker compatibility + 2 original QA fixture tests pass; storage feature disabled |
| Linux container with Lance | Build and 3 file + 4 integration tests pass before the final QA/status changes; final rebuild recorded below when complete |
| Python source backup | 2 tests pass: Unicode/binary roundtrip, no overwrite, hostile archive traversal refused |
| Python prepare-new-vault | 2 tests pass: original bytes preserved, CRLF/frontmatter and attachments, persistent IDs on repeat copy, duplicate ID rejection |
| Fresh provisioning | Actual packaged CouchDB configuration + upstream CLI setup passes; settings mode0600, E2EE, nonadmin sync user, repeated initialization refused |
| Compose | Base + models + experimental answer + GPU-preparation + local-access overlays validate with synthetic environment values; no deployment performed |
| LiveSync end-to-end | 25 checks pass with actual Qwen3-Embedding GGUF and Rust/Lance process; see evidence JSON |

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
size. A production/optimized benchmark build is in progress at this checkpoint.

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
* Actual BGE reranker and experimental Qwen generation transport/quality on this
  daemon; full shared checked-answer/router/entailment parity remains separate.
* Larger representative synthetic corpus, release measurements, controlled
  process/disk-cold distributions, sustained writes/compaction and crash injection
  during commits. Current restart recovery rebuilds all Lance rows from SQLite;
  it never re-embeds, but is not yet optimized for large vault startup.
* Managed-ID requirement and Markdown-only parser are deliberate v1 boundaries.
  Existing arbitrary Obsidian notes need new-vault preparation; no live mass
  frontmatter rewrite is performed. Upstream-sidecar filesystem atomicity is not
  claimed solely from the daemon's own atomic import implementation.

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

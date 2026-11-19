# Headless ownership and handoff

Canonical repository: TwoD97/LokLM, original audited base
`4651557a3567631d3a84a33c3e78e4f3032d718d`. Implementation branch:
`TwoD97/loklm-unraid-knowledge`; development [PR #50](https://github.com/TwoD97/LokLM/pull/50).
No merge or production deployment has been performed or requested.

The independently owned paths are `native/crates/knowledge` and
`deploy/knowledge`. The desktop owner retains core/inference/documents/UI/Tauri.
The shared core commits b59c1d4, 8b189ac, 4223a86, 00e6673, e40721e, c418292,
3758800, 0fef42f, baf9cfb and 4b143e9 are integrated
without enabling desktop storage. The daemon crate is a standalone workspace
with a relative dependency on `../core`, never a dependency on another worktree.
Both owners use the same chunking, instruction/normalization/fingerprint, RRF,
QA prompt/citation and UTF-16 reranker preparation helpers.
The source-quote provenance module and original TypeScript compatibility fixtures
are also available under the standalone daemon lock. It is not yet wired into
generated-answer validation; that endpoint still promises citation identity only.
The exact source-quantity annotation helper and its 307 original TS cases are
likewise integrated without enabling checked arithmetic in generated answers.
The daemon keeps its standalone lock; no desktop workspace/storage dependencies
were brought in with either helper.
The bounded calculation interpreter adds 364 original output/span cases. Its
JSON float-roundtrip feature changes the headless numeric transport contract:
regenerate embedding/reranker aliases and rebuild into a new index directory.
No generated-answer arithmetic or entailment guarantee is enabled by these helpers.
Immutable source units and exact display fragments now add 102 and 227 original
fixture cases. ICU4X 2.4.0 uses compiled data only, with no LSTM/auto feature;
only the direct core dependency edge was added to the existing Lance graph.
These remain pure building blocks, not an enabled structured-answer pipeline.

Implemented and tested: portable files/IDs/attachments, actual official encrypted
LiveSync exchange, checkpoint/cache/FTS/Lance indexing, guarded source citations,
auth/scope/cancel/lock APIs, backlinks, fresh setup, source backup/restore, containers,
development instructions and a measured same-vector storage comparison. Read
[VALIDATION.md](VALIDATION.md) for exact evidence and limitations; the core is not
advertised as full original desktop QA/parser parity.

At handoff, all own inference/test containers are stopped or removed. Existing
unrelated services, real vaults and canonical model files were not modified.
Local production/test images and build caches are retained for reproducibility.
The synthetic vector fixture is outside Git at
`native/artifacts/synthetic-vectors.json` (hash recorded in VALIDATION.md); the
generator script is tracked. Do not substitute private content in shared reports.

Next acceptance work, in order:

1. Observe the final draft PR's Linux/Windows knowledge checks and existing
   application checks. The isolated Ubuntu runner pin is coordinated with the
   desktop owner and already fixed the observed website Playwright failure.
2. Expand answer-quality coverage beyond the now-passed actual CPU smoke:
   20 checks cover Qwen embedding, BGE reranking, DE/EN Qwen3.5-4B answers and
   source identity, cancellation, scope and dedup. The latest numeric-contract
   run is `evidence/models-cpu-numeric.json`; release dense LiveSync validation is
   `evidence/livesync-release-dense.json`.
   The test ran after headroom recovered in a coordinated window. The answer
   adapter remains opt-in, buffered, checks tokenizer budgets/citation identity
   and rejects literal ChatML markers; it is not an entailment or checked-answer
   implementation. Do not unload shared models to make room for further tests.
3. Integrate further desktop-owned QA/parser helpers through versioned pure-core
   interfaces when ready. Do not duplicate them or add a Macro/Zero connector.
   Attachments are synchronized intact; v1 parses Markdown only.
4. Expand the store corpus and measure controlled cold-process/disk-cache
   distributions, sustained updates/compaction and injected crashes. Small exact
   search favoured Qdrant in latency/RSS/binary cost, with a separate server and
   higher apparent storage reservations. Current daemon production backend is
   Lance; there is no unmeasured universal engine recommendation.
5. On the later fresh Unraid installation, validate UID/permissions, encrypted
   SSD/appdata volumes, source restore, gateway and real Obsidian UI peers. GPU
   Docker assets are preparation only. Use a disposable vault first and never
   reset an existing CouchDB database or synchronize a raw binary index.

Only after these relevant acceptance gates and review, request merge through
Orca PR Hub with numbered Manual testing and the current final head. Never merge
directly. No production credentials are needed for the current disposable tests;
later secrets belong only in the documented local config/secret files.

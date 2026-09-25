# Native RAG calibration — 24 September 2026

This session measures the installed models through LokLM's real Electron, indexing, retrieval, prompt, and native inference pipeline. All runs use separate temporary vaults. Existing user documents and settings are not calibration fixtures.

**Selected resource changes:** retain GPU inference, exclusive chat/search residency on this card, the original memory reserve, bounded native math-core threads, a query-vector cache, and guarded reuse of successful GPU layer plans. Matching-plan reloads fell from roughly 35.6 to 10 seconds in the measured runs. A real twenty-page PDF indexed forty chunks in 27.4 seconds, and native handoff/cancellation workflows passed. Eighty model answers across eight diagnostic runs exposed remaining attribution and format weaknesses; these results do not establish reliable answer verification. The original held-out failure and the subsequent limited conflict-policy regression are preserved below.

## Hardware and measurement scope

- NVIDIA GTX 1050 Ti, 4,096 MiB physical VRAM; Vulkan backend.
- AMD Ryzen 5 3600: six physical cores, twelve logical processors; 31.9 GiB RAM.
- Qwen3.5 4B Q4_K_M for answers; Qwen3 Embedding 0.6B Q8_0 for search. Exact file hashes, built application hashes, fixture hashes, model placement, context, KV type, and event timings are recorded in each run's `raw.json`.
- Embeddings use the GPU. Chat uses partial GPU offload: the installed model and context did not fit entirely under the measured desktop usage and retained memory reserve. Reranking stays disabled.
- The original development and held-out splits each contain six invented documents and twelve questions. The development documents produce nine chunks, including a real text-based PDF table. A later conflict regression has four documents and four questions and is reported separately. These are small diagnostic suites, not estimates of accuracy on real libraries. They do not cover scanned PDFs, charts, large-library selectivity, structural code workspaces, or long conversations.
- The harness measures the lean document-search path: no generated query expansion, reranker, summary/inventory routing, or whole-document fallback. All quality counts require independent reading of the answer and its actual inline source markers. A matching number or a source chip alone is insufficient.
- GPU samples measure the entire card every approximately 1.5 seconds. Sampled peaks can miss brief allocations. Desktop allocations, free system RAM, KV choice, and model loading vary between runs; these are not randomized hardware benchmarks.

## Development baseline and rejected experiment

| Observation                                                              |  Baseline | First candidate |
| ------------------------------------------------------------------------ | --------: | --------------: |
| Distinct development questions                                           |        12 |              12 |
| Answerable results with correct answer and complete supporting citations |     7 / 9 |           6 / 9 |
| Safe missing-fact/conflict responses                                     |     3 / 3 |           3 / 3 |
| Actual context                                                           |     4,096 |           4,096 |
| Chat layers on GPU                                                       |   15 / 33 |         21 / 33 |
| Native VRAM reserve                                                      | 1,024 MiB |         768 MiB |
| Median first token event                                                 |  62.193 s |        65.007 s |
| Median recorded total                                                    |  89.162 s |        88.921 s |
| Sampled minimum physical GPU headroom                                    |   544 MiB |         418 MiB |

Medians use the mean of the two middle observations for even sample sizes. Baseline completion-event capture raced IPC on four questions, so those total timings have a measurement caveat. Later runs explicitly wait for a terminal event and separately measure first non-whitespace text. Neither first run observed an inference timeout or allocation failure.

The first candidate combined several changes. The code-result failure disappeared in this candidate, but wrong or incomplete citations remained and appeared on additional questions. It therefore failed the quality acceptance gate. The combined candidate with a lower memory reserve had more GPU layers and less physical headroom, without a meaningful improvement in aggregate fresh-query latency. This does not isolate padding's effect. The production reserve remains unchanged; these results do not justify model co-residency on this GPU.

The repeated-query cache had a narrower, directly observed benefit: repeated questions performed retrieval in 6–9 ms and triggered zero model transitions. End-to-end times fell from 71.582 to 35.023 seconds and from 77.878 to 51.919 seconds. The latter answer retained its wrong citation; faster execution is not a quality fix. These are two repeated exact queries, not a general cache-hit-rate claim.

Detailed evidence: [baseline review](../../tests/evals/native-calibration/reports/dev-4k-baseline/REVIEW.md), [first candidate review](../../tests/evals/native-calibration/reports/dev-4k-candidate/REVIEW.md), [memory comparison](2026-09-24-native-padding-results.md), [query-cache behavior](../../tests/evals/native-calibration/QUERY-CACHE.md).

## Follow-up changes

- Remove recognized answer-format tails from search queries while preserving the full user's question for generation. “Answer in one sentence” should not become a second retrieval topic or pollute the embedding.
- Stop penalizing short evidence and stop favoring the answer language in document search. Native rank replay found an exact approval statement pushed from fused rank two to final rank seven by those heuristics. Existing code-workspace defaults and explicit overrides remain available. See [rank replay and tradeoffs](2026-09-24-native-rank-replay.md).
- Require exact source-marker copying and citations for every calculation input; remove a numeric citation example that can be mistaken for a real source identifier.
- Keep embeddings resident after indexing on constrained GPUs. The next operation loads the model it needs instead of eagerly loading chat only to unload it again for query embedding.
- Use a bounded, model-revision-aware query-vector cache. It does not cache retrieved document results or answers, and cancellation or changed model identity cannot populate a stale entry.
- Show a neutral source count instead of labeling answers “Grounded.” Source navigation is useful, but marker presence is not semantic verification.
- Use the native library's math-core count, bounded by scheduling capacity, for the inference-thread default. This is still GPU inference; CPU threads execute the part of the chat model that cannot be offloaded. The paired control below supports this choice on the measured machine.

## Final validation

The targeted 8K follow-up ran six development questions plus two repeats. Four of five answerable first-pass cases had complete supporting citations; the remaining missing-fact case safely abstained. The approval-date and identifier regressions disappeared. The revenue comparison still cited the right document's wrong passage, despite a correct arithmetic result. Both repeats remained supported. [Targeted review](../../tests/evals/native-calibration/reports/dev-8k-balanced/REVIEW.md).

The thread control used the identical compiled application, model files, actual 8K context, q4 KV, and 14 GPU layers. Across two questions, each asked fresh and repeated, native generation took less time with six threads in all four observations (34.712–41.801 s versus 36.879–46.703 s). End-to-end timing favored six threads in three pairs; time to first visible text was mixed. Fresh-query model residency differed for the first control question, and system RAM pressure was not controlled. This supports the bounded math-core default on this machine, not a universal percentage improvement. [Control review](../../tests/evals/native-calibration/reports/dev-8k-threads11/REVIEW.md), [thread policy](2026-09-24-native-thread-policy.md).

Lazy release made the measured development import/indexing phase finish in 10.541 s with embeddings resident, versus 43.381–48.388 s in earlier runs that also eagerly restored chat. These endpoints intentionally differ: the new policy defers chat loading until a request needs it. It removes a redundant load rather than proving that document embedding itself became four times faster.

Progress timestamps locate most remaining chat-load delay in automatic GPU-layer fitting: approximately 29 seconds occurred in the native resolver's progress range before actual weight loading in one measured reload. Final context setup took about 2.6–3 seconds. Native VRAM snapshots returned to the same values across repeated handoffs; no retained-model leak was demonstrated. Available system RAM was sometimes near 1.2 GiB, with substantial unrelated process use. [Memory and loading analysis](2026-09-24-native-8k-memory-and-loading.md).

The full development experiment with layer-plan reuse completed twelve first-pass questions and two repeats without a timeout or allocation failure. All twelve reloads reused the successful 14-layer plan, with fresh native memory checks. Median preparation time was 10.317 s; the six matched questions previously took 35.553 s with automatic fitting on every reload. Initial startup still needs automatic fitting. The physical GPU peak was 3,177 MiB, leaving 919 MiB of sampled headroom. The production default now enables plan reuse; `LOKLM_REUSE_GPU_LAYER_PLAN=0` opts out. Cache entries are only allocation hints, are keyed to model/configuration identity, and are discarded on memory rejection before the ordinary allocator retries. [Plan reuse evidence](2026-09-24-native-plan-reuse-results.md).

Short citation labels were tested in the same development run but are **not enabled by default**. Seven of nine answerable cases were fully supported, and all three missing-fact/conflict cases responded safely. The comparison finally cited both exact input passages, but another answer cited a document introduction instead of its table and an identifier answer omitted its citation. This does not establish a citation-quality gain. The complete evidence, including format failures and both repeats, is retained in the [alias experiment review](../../tests/evals/native-calibration/reports/dev-8k-alias-plan/REVIEW.md).

The final candidate uses canonical source markers, generic brevity and citation instructions, the original memory reserve, hardware-aware threads, lazy model handoff, and guarded plan reuse. Citation formatting is not semantic verification; the source-count UI deliberately makes no such claim.

## Frozen candidate and held-out failures

The final development run completed all twelve questions, with **8/9 fully supported answerable responses and 3/3 safe missing-fact/conflict responses**. The remaining comparison error is attribution: the model computes EUR 5,520 correctly but cites the approval paragraph instead of the planned-revenue table, even though the right table was supplied. It is counted as a failure. The identifier and code-calculation answers have correct citations and now follow the requested one-sentence format. [Complete development review](../../tests/evals/native-calibration/reports/dev-8k-final/REVIEW.md).

| Final development observation          |           Result |
| -------------------------------------- | ---------------: |
| First-pass questions / terminal events |          12 / 12 |
| Median first visible text              |         37.885 s |
| Median completion                      |         56.447 s |
| Median matching-plan reload            |          9.843 s |
| Startup / import and indexing          | 43.831 / 9.065 s |
| Sampled minimum physical GPU headroom  |          861 MiB |
| Query contexts / GPU layers            | 8,192 / 14 of 33 |

All resource override variables were unset; only the 8K context was explicitly fixed for calibration. The logged defaults were six inference threads and 1,024 MiB reserve. Startup resolved to f16 KV; after indexing, the resource planner chose q4 KV, causing a new cache-key miss and automatic fit in that build. The next eleven requests reused the matching plan with fresh native checks. There were no inference timeouts, allocation rejections, or fallback attempts. A Chromium GPU-state warning appeared during application teardown after the final answer; it was not an inference failure. A [25 September audit](2026-09-25-optimization.md) subsequently found that native weight fitting still used F16 defaults in both cases, making this particular precision-based invalidation unnecessary; the recorded timing remains unchanged.

The compiled backend, seventeen recorded source/build hashes, model files, and settings were frozen for a single twelve-question held-out run. All recorded code/model identities matched the development run, and the held-out fixture lock passed. That untouched run produced **8/9 fully supported answerable responses and 2/3 safe uncertainty responses**. It failed the conflict-safety check: the model declared the unapproved second draft's date definitive, even citing its lack of approval as justification. The other failure was correct arithmetic with the wrong input passage. An additional German arithmetic answer conveyed the correct combined total but had awkward wording. These failures remain in the score. [Complete held-out review](../../tests/evals/native-calibration/reports/heldout-8k-final/REVIEW.md).

The held-out median first-visible time was 39.887 s and completion was 59.503 s. Ten matching-plan reloads had a 9.851 s median; two fresh fits were required as the adaptive KV choice changed from startup f16 to q8 for the first two requests, then q4. All requests retained 8K context and 14 GPU layers. Sampled GPU headroom was at least 825 MiB. No request timed out or encountered an allocation rejection/fallback. Frozen configuration does not imply identical adaptive allocations or runtime RAM conditions.

### Post-held-out correction: separate evidence

The generic ambiguity instruction to choose a likely interpretation was a plausible contributor to the failed conflict answer, because it provided guidance at odds with preserving unresolved source conflicts. The run does not establish that instruction as the cause. A subsequent narrow correction distinguishes unclear questions from disagreeing sources: preserve conflicting values with their citations unless the supplied evidence explicitly establishes approval or supersession; a newer date alone is insufficient. This change is informed by a held-out failure. **The earlier held-out result is not a validation of the corrected prompt.**

A separate four-question conflict regression covers two unapproved drafts and a different explicitly approved superseding revision, each queried in English and German. It tests both preserving uncertainty and answering when authority is supported. It is labelled post-held-out regression, not new held-out accuracy evidence. [Complete regression review](../../tests/evals/native-calibration/reports/conflict-regression-8k/REVIEW.md).

| Regression                 | Actual outcome                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unresolved drafts, English | Both dates and exact citations; explicitly no definitive deadline.                                                                                 |
| Unresolved drafts, German  | Safely avoids a definitive choice, but omits both dates and cites only one draft for a statement about both. Incomplete.                           |
| Approved revision, English | Correct approved date and authority source; an additional supersession clause has its marker on the old revision. Partial citation placement.      |
| Approved revision, German  | Correct approved date and supported supersession explanation, but uses a localized date instead of requested ISO and two sentences instead of one. |

All four authority decisions match the evidence, but **this is not a four-of-four strict compliance pass**. The prompt correction removes contradictory guidance and is retained; the tests do not establish reliable claim-level attribution. The existing comparison-passage attribution failure remains unresolved. No further prompt changes were made from these regression answers. The compiled models worker is identical to the original held-out build; the main bundle changed with the prompt, and the renderer changed with the indexing-copy correction.

## Workflow and implementation checks

The final prompt/copy change passed 140 focused checks across nine suites, full TypeScript checking, scoped lint, and the production build. Resource-policy acceptance passed 59 allocator/thread/padding checks, including stopping retries when native disposal fails. The new regression corpus, frozen original fixture lock, and grading tools passed 15 scoped checks. These groups overlap in purpose; they are not an accuracy score.

Both real GPU workflow tests passed on the corrected build:

- Chat loaded on demand after indexing, answered before and after reindexing, and indexing preempted an in-progress background title request (native cancellation logged after 1.036 s). This exercises the real Electron APIs and GPU state transitions.
- A generated twenty-page PDF produced **40 chunks and 40 durable vectors in 27.406 s**, with 16 progress events. The actual import/stop UI was used. The dialog showed live progress, closed after completion, and the header correctly showed chat available on demand. A second indexing run stopped after its current batch, released the activity gate, and an explicit warmup restored chat. Total duration of both tests was 4.2 minutes.

The PDF time includes the model handoff and import/indexing work; it is one synthetic text-layer document, not a scanned-PDF throughput guarantee. These tests used isolated temporary vaults. The indexing/preparation/completion screenshots were inspected, including the updated German wording and layout. Artifacts are under `out/native-calibration/workflows/`; the Playwright status records no failed tests. After cleanup, no Electron test process remained and whole-GPU usage returned to 1,482 MiB.

A final renderer-only singular/plural correction passed six existing library/encoding checks, scoped lint, full type checking, and a fresh production build. All seventeen recorded runtime-source/build hashes still match the post-held-out regression, including both compiled backend artifacts; no inference behavior changed after native validation.

Run the updated app with `pnpm.cmd dev`. Existing user documents and settings were not reindexed or rewritten by calibration. Source-attribution and format errors remain a measured limitation; the UI's neutral source count is navigation, not a verification badge.

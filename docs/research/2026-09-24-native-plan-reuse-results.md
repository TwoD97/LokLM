# Guarded GPU-layer plan reuse: native results

Hardware-only assessment of `tests/evals/native-calibration/reports/dev-8k-alias-plan/raw.json` and `app.log`, completed `2026-09-24T16:49:43.194Z`. The parent harness performed all inference; this review used saved telemetry and brief read-only process-memory sampling. This small synthetic DEV set is not a general performance benchmark or an answer-quality result.

## Allocation and thread policy

The frozen compiled run enabled plan reuse and citation aliases, retained the default 1024 MiB reserve, and requested 8K context. Every observation resolved to **8192 tokens, q4_0 KV, and 14/33 GPU layers**, with exclusive residency and reranking disabled. The startup log confirmed the unset thread override selected `maxThreads=6`, `cpuMathCores=6`, `logicalCores=12`, and `availableParallelism=12` on the Ryzen 3600.

Startup used automatic fitting once. All **12 cold-query reloads hit the remembered layer plan**; there were zero query-level cache misses, fallbacks, allocator rejections, reduced-offload retries, or timeouts. Both warm repeats performed zero model preparations. All 14 observations delivered terminal events. This validates the successful reuse path on this host; native recovery under deliberately induced memory pressure was not tested. Unit tests cover rejection, cleanup, and bounded fallback paths.

## Loading time

| Case  | Preparing chat to ready, ms | Cache-hit log to ready, ms |
| ----- | --------------------------: | -------------------------: |
| DEV06 |                      10,318 |                     10,102 |
| DEV03 |                      10,246 |                     10,034 |
| DEV07 |                      10,537 |                     10,296 |
| DEV11 |                      10,315 |                     10,104 |
| DEV01 |                      12,347 |                     12,114 |
| DEV02 |                      10,331 |                     10,098 |
| DEV04 |                      10,506 |                     10,285 |
| DEV05 |                      10,028 |                      9,780 |
| DEV08 |                      10,084 |                      9,876 |
| DEV09 |                      10,220 |                     10,021 |
| DEV10 |                      10,495 |                     10,254 |
| DEV12 |                      10,234 |                     10,028 |

The conventional 12-case median is **10,316.5 ms** from preparing chat to ready, and **10,100 ms** from the cache-hit log to ready. For the same six DEV IDs in `dev-8k-balanced`, the previous automatic-fit median was 35,553 ms versus 10,316.5 ms here: about 25.2 seconds less observed reload time. Both runs used 8K/q4_0/14 layers and six threads. The source audit identified repeated automatic layer probing as the dominant earlier stage; bounded reuse retains native checking of the remembered layer count and context rather than retaining weights. See [loading-stage analysis](2026-09-24-native-8k-memory-and-loading.md).

This was not randomized repetition. RAM availability and source/prompt changes also varied. In particular, citation aliases changed input lengths and output behavior; do not treat overall answer latency or correctness as a pure plan-reuse result. Alias promotion was rejected separately after answer review.

All 12 cold questions had median browser first-visible text of 37,739.5 ms and median total time of 52,564 ms. On the six matched IDs these were 38,724 ms and 51,133.5 ms. Warm DEV06 took 20,547 / 46,801 ms to first visible / complete; warm DEV03 took 18,648 / 31,093 ms. DEV11's 111,358 ms total was dominated by generating 131 tokens over 94,100 ms; its reload still took 10,315 ms. This illustrates why reload timings and output length must be reported separately.

## Memory

Whole-device GPU usage peaked at **3177 / 4096 MiB**, leaving **919 MiB minimum observed headroom**. The 560 samples were 1405–1592 ms apart, with a 1509 ms median; shorter transient peaks can be missed. Native Vulkan budget telemetry is a different measure from physical device free memory and must not replace this headroom figure.

Repeated before-weights and after-context native allocations stayed consistent with the prior 8K run. Post-load free system RAM varied roughly 3.1–4.4 GB instead of steadily declining across handoffs.

The supplementary `worker-memory-samples.jsonl` contains 55 one-second samples of only this run's models worker (PID 10308). During DEV07 reload, after previous allocations were released and before chat was resident, private bytes fell to **934,449,152** and working set to **899,928,064** at `16:38:33.2769021Z`. They subsequently reached about 3.146 billion private bytes / 3.840 billion working-set bytes during generation. This directly shows most preceding model RAM being released, arguing against whole models accumulating across these handoffs. It neither excludes smaller metadata retention nor replaces a controlled long-running leak test. No processes were stopped or changed.

## Default and validation

The source enables guarded plan reuse by default. Set **`LOKLM_REUSE_GPU_LAYER_PLAN=0`** to opt out for diagnostics. The completed canonical `dev-8k-final` verified behavior with the variable unset: one expected first-query miss when the post-index preferred KV changed from startup f16 to q4_0, followed by eleven successful hits, no fallback, and a 9843 ms hit-reload median. All query contexts were 8K/q4_0/14 layers. See [final resource acceptance](2026-09-24-native-final-dev-resources.md). The cache holds at most four positive scalar layer counts, keyed by model revision and allocation identity; every hit still checks current native memory with the original `fitContext` margin. Cleanup failures stop further allocation. Corrupt-model errors remain fail-fast.

After this opt-in native run ended, 57 focused tests passed. The subsequent acceptance review also made ordinary OOM retries stop on failed weight disposal, matching the already guarded cached-hint path. **59 tests then passed**: 13 plan-reuse/retry/policy, 24 thread-policy, 19 padding, and 3 allocator tests. Forced scoped ESLint, Prettier checks, and the complete Node-project no-emit TypeScript check passed before final DEV timing. This agent did not build or launch inference. Final answer-quality selection and the frozen heldout evaluation remain separate from this hardware result.

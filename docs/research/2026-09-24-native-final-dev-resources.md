# Final canonical DEV: resource acceptance

Source: `tests/evals/native-calibration/reports/dev-8k-final/raw.json` and `app.log`. The run started `2026-09-24T16:55:26.119Z` and completed `17:07:48.069Z`, with 12 first-pass DEV questions and no warm repeats. This note assesses resources and timings only; the independent answer/citation review remains authoritative for quality. No inference, build, tests, or production edits were performed by the monitoring agent during the run.

## Verified production defaults

The thread, padding, query-cache, plan-reuse, and citation-alias overrides were unset. Context was explicitly locked to 8192 for calibration; this was not an entirely unset configuration. The startup log confirms:

- `maxThreads=6`, `cpuMathCores=6`, `logicalCores=12`, `availableParallelism=12`: hardware-aware thread default.
- `VRAM padding: 1024.0 MiB (default)`.
- Canonical citations, query embedding cache enabled, guarded GPU layer-plan reuse enabled; reranking disabled and exclusive small-GPU residency retained.

Startup took 43,831 ms and indexing 9,065 ms. Startup resolved **8K / f16 KV / 14 GPU layers**, but the first post-index query resolved **8K / q4_0 / 14 GPU layers**. The cache key deliberately includes preferred KV configuration, so this precision change caused one additional automatic-fit miss. It was not an OOM fallback. Every later question hit the q4_0 plan; all 12 query contexts were **8192 / q4_0 / 14 of 33 layers**. Native fitting and context allocation continued to check current memory on every hit.

There were **11 query-level hits, one expected precision-key miss, zero cache fallbacks, zero allocator rejections/reduced-offload retries, and zero query timeouts**. Startup added its own initial miss. All 12 queries delivered terminal events. No later precision/key changes occurred. This verifies the previously pending unset-variable reuse default.

## Timings

| Case  | Plan                 | Preparing chat to ready, ms | Browser first visible text, ms | Total, ms |
| ----- | -------------------- | --------------------------: | -----------------------------: | --------: |
| DEV01 | miss after KV change |                      33,853 |                         53,620 |    68,693 |
| DEV06 | hit                  |                       9,945 |                         38,068 |    62,003 |
| DEV07 | hit                  |                       9,902 |                         43,992 |    56,552 |
| DEV11 | hit                  |                       9,781 |                         44,084 |    56,342 |
| DEV02 | hit                  |                       9,714 |                         37,945 |    51,636 |
| DEV03 | hit                  |                       9,796 |                         35,636 |    50,414 |
| DEV04 | hit                  |                       9,843 |                         37,824 |    48,376 |
| DEV05 | hit                  |                       9,847 |                         37,086 |    63,399 |
| DEV08 | hit                  |                       9,772 |                         35,950 |    47,314 |
| DEV09 | hit                  |                       9,867 |                         37,121 |    43,008 |
| DEV10 | hit                  |                       9,763 |                         36,402 |    77,378 |
| DEV12 | hit                  |                       9,943 |                         38,034 |    62,578 |

The **11-hit reload median is 9843 ms** (9714–9945 ms); from cache-hit log to ready it is 9600 ms. Including the one miss, the 12-case reload median is 9845 ms. The first question needed only chat preparation because indexing had left the embedder resident; subsequent cold queries each needed embedder then chat preparation.

The conventional 12-case median browser first-visible-text time is **37,884.5 ms**, and total time is **56,447 ms**. Worker-generation medians are 19,822 ms to first visible text and 37,532 ms total. Worker first-visible time includes prefill and any earlier hidden output, not pure prefill alone. Initial stage events arrived in 19–32 ms; those are not answer tokens. DEV05/08/10 first token events preceded actual nonempty browser text by about 0.44–0.46 seconds, so the table uses the explicit `firstVisibleTokenMs` field.

Answer lengths ranged from 18 to 95 native output tokens. Do not attribute total-answer changes solely to plan reuse: prompts, canonical versus alias citations, source selection, RAM conditions, and startup KV precision differ across earlier runs. This run validates the combined selected profile on this small corpus.

## Memory and error scope

The physical GPU peak was **3235 / 4096 MiB**, leaving **861 MiB minimum observed headroom**. It occurred at `16:56:09.997Z`, during the startup f16 allocation, before indexing and the query-level q4_0 plan. There were 491 samples, 1478–1541 ms apart, with a 1508.5 ms median interval. Sampling can miss briefer peaks. Native Vulkan free-budget figures are not equivalent to this whole-device headroom.

Post-query-load free RAM stayed approximately 4.6–4.9 GB; there was no successive decline across the 12 handoffs. This does not replace a long-running memory-leak test. The previous opt-in run directly sampled most model RAM being released during a handoff; see [plan-reuse results](2026-09-24-native-plan-reuse-results.md).

A Chromium GPU-state warning was reported at 19:07:48.346 local time, after the final answer completed at 19:07:47.960 and during application cleanup. It is recorded separately from inference/allocation failures. This report does not claim that every application log was warning-free, and no production change was made in response to that teardown warning.

## Acceptance boundary

Before this final build, the acceptance review found and fixed one inherited retry hazard: ordinary allocation retries had swallowed weight-disposal failures before attempting another allocation. Both cached and ordinary retry paths now stop when the relevant cleanup fails. **59 focused tests** passed (13 reuse/retry, 24 threads, 19 padding, 3 allocator), together with scoped ESLint/Prettier and full Node-project no-emit TypeScript. No checks were rerun during native timing.

The key uses file revision metadata rather than hashing all weight contents; native validation remains authoritative. A remembered conservative layer count does not opportunistically increase when external memory becomes available. Worker restart, a changed allocation identity, or explicit `LOKLM_REUSE_GPU_LAYER_PLAN=0` returns to ordinary fitting. Neither limitation bypasses native safety checks. The subsequent [original frozen held-out run](2026-09-24-native-heldout-resources.md) verified the same recorded build/configuration and preserved its result separately from later conflict-policy regression work.

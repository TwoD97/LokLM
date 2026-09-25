# Original frozen held-out run: resource acceptance

This is the resource-only assessment of `tests/evals/native-calibration/reports/heldout-8k-final/raw.json` and `app.log`, started `2026-09-24T17:08:12.615Z` and completed `17:21:21.178Z`. It covers the original 12 held-out questions, once each, in order. It does not grade answers or replace the independent semantic/citation review. The answer review identified a conflict-handling failure; later fixes and regression runs must remain separate from this original frozen result.

The monitoring agent performed no inference, builds, tests, production edits, or answer inspection during this run. `resource-summary.json` contains the derived timings and memory measurements; `resource-integrity.json` records the identity checks.

## Frozen identity and effective configuration

All **17 recorded runtime-source/build hashes match final DEV**, including the two compiled artifacts actually executed:

| Artifact                   | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `out/main/index.js`        | `76b966ff165c76b9c3b190f678610a1a7efa13989ca94952506f2953905b397c` |
| `out/main/modelsWorker.js` | `97fae97ea3554b541be52a4f0c37d301a03c0c20ba4db57dc13f376f8e7d7582` |

The held-out manifest and its six source files pass **all 7 frozen checksum comparisons**. The run's manifest hash is `3e6ed6bfa07894504f41b5c4dea15bb07223658c27e01b1e61a6d395c533bbb1`. The two recorded model hashes and byte sizes also match DEV; the observer did not rehash the multi-gigabyte weights during inference. The source documents are disjoint from DEV.

Resource configuration matches final DEV. Context was explicitly locked to **8192** for calibration; thread, padding, query-cache, plan-reuse, and citation-alias environment overrides were unset. Startup logs confirm **6 hardware-aware threads** (`cpuMathCores=6`, logical/available capacity 12) and **1024.0 MiB default VRAM padding**. Query embedding caching and guarded GPU layer-plan reuse were enabled. Citations used canonical markers. Reranking, multi-query, routing, and whole-document fallback were disabled for this profile. Exclusive residency remained active: the fully GPU-offloaded embedder and partially offloaded chat model took turns. No CPU-only inference path was used.

## Allocation and loading

Startup took **43,532 ms**, indexing **9,047 ms**. Chat startup resolved **8K / f16 KV / 14 of 33 GPU layers**. Queries 01-02 resolved **8K / q8_0 / 14 layers**; queries 03-12 resolved **8K / q4_0 / 14 layers**. This differs from final DEV, whose query contexts were all q4_0. The configuration was frozen, but the native resource planner remained adaptive.

The two precision changes correctly required new cache keys: query 01 missed after startup f16, and query 03 missed after q8_0. They were ordinary automatic fits, **not OOM fallbacks**. There were **10 query cache hits, two query misses, no cache fallback, no allocator rejection/reduced-offload retry, and no query timeout**. Startup had its own initial miss. All 12 queries delivered terminal events. Every cache hit continued to validate current memory through native fitting and context allocation.

| Case | KV   | Plan               | Preparing chat to ready, ms | Browser first visible text, ms | Total, ms |
| ---- | ---- | ------------------ | --------------------------: | -----------------------------: | --------: |
| 01   | q8_0 | precision-key miss |                      33,591 |                         55,293 |    72,012 |
| 02   | q8_0 | hit                |                       9,844 |                         36,689 |    49,148 |
| 03   | q4_0 | precision-key miss |                      32,898 |                         60,372 |    75,447 |
| 04   | q4_0 | hit                |                       9,825 |                         37,636 |    56,675 |
| 05   | q4_0 | hit                |                       9,839 |                         41,711 |    64,596 |
| 06   | q4_0 | hit                |                       9,857 |                         40,516 |    68,592 |
| 07   | q4_0 | hit                |                      10,102 |                         43,153 |    53,282 |
| 08   | q4_0 | hit                |                       9,898 |                         39,538 |    52,409 |
| 09   | q4_0 | hit                |                       9,832 |                         36,884 |    44,697 |
| 10   | q4_0 | hit                |                       9,879 |                         40,236 |    78,731 |
| 11   | q4_0 | hit                |                      10,156 |                         38,057 |    57,000 |
| 12   | q4_0 | hit                |                       9,785 |                         38,904 |    62,006 |

The **10-hit reload median is 9850.5 ms** (9785-10156 ms), and cache-hit log to ready has a **9649.5 ms** median. Including the two misses, the 12-case reload median is 9868 ms. These conventional even-count medians average the middle pair. They are not rounded-down order statistics.

The median browser first-visible-text time is **39,887 ms**, and median total time **59,503 ms**. Worker-generation medians are **21,128 ms** to first visible text and **39,043 ms** total. Worker first-visible time includes prefill and any earlier hidden output; it is not a pure prefill measurement. Initial stage events arrived in 20-31 ms and were not answer tokens. For query 11, the first token event was at 37,629 ms but nonempty visible text appeared at 38,057 ms; the table consistently uses the latter field.

Output length ranged from 20 to 87 native tokens. Query 10's 78.731 s total included 62.072 s of worker generation, while its reload stayed at 9.879 s. Do not attribute its duration to a loading regression or infer answer quality from these timings. These are different questions from DEV, with partly different KV precision and desktop RAM conditions; the run is not a controlled performance comparison against DEV.

## Memory and acceptance limits

Whole-device GPU usage peaked at **3271 / 4096 MiB**, leaving **825 MiB minimum observed headroom**. The peak sample was at `17:08:56.447Z`, around startup f16 residency and before indexing. The 522 samples were 1436-1575 ms apart, with a 1509 ms median interval. Shorter peaks may be missed. Native Vulkan free-budget readings are per-process budget telemetry and do not substitute for this physical-device headroom.

Post-query-load free RAM was approximately **4.6-4.9 GB**. Later q4_0 native allocations stabilized: queries 06-12 reported the same 661,449,113 bytes before chat weights and 2,507,336,089 bytes after the chat context. This argues against whole GPU model allocations accumulating during these handoffs, but it is not a long-running leak test.

The inference logs show no cache fallbacks, memory-fit rejections, or reduced-offload retries. This is a scoped statement about allocation/inference behavior, not a claim that every application/driver/cleanup message is warning-free. Final DEV's separately reported Chromium GPU-state cleanup warning remains documented in [its resource report](2026-09-24-native-final-dev-resources.md).

The measured resource profile preserves the default reserve, positive GPU offload, exclusive model ownership, fresh native memory checks, and bounded retry cleanup. It does not establish global RAG quality or justify co-residency, a smaller VRAM reserve, or further held-out tuning. Subsequent conflict-policy work must identify its changed build and use separately labeled regression evidence; the original held-out files and result remain intact.

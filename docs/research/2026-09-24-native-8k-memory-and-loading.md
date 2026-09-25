# Native 8K candidate: memory, latency, and reload audit

This is a small local calibration on the Ryzen 3600 / GTX 1050 Ti, not a general benchmark. No inference was launched by this analysis. The source is `tests/evals/native-calibration/reports/dev-8k-balanced/raw.json`, completed at `2026-09-24T16:17:45.698Z`; its eight observations comprise six first-pass DEV questions and two warm repeats. Answer correctness is reviewed separately in the calibration report.

## Observed configuration and latency

All eight observations resolved to 8192 tokens, q4_0 KV, 14/33 GPU layers, 1024 MiB padding, six inference threads, exclusive GPU residency, and reranking disabled. Startup took 47,509 ms; indexing took 10,541 ms. Query-embedding caching and lazy release after indexing were enabled.

| Case  | Repeat | First visible browser text, ms | Total, ms | Worker first visible text, ms | Worker elapsed, ms | Input/output tokens |
| ----- | -----: | -----------------------------: | --------: | ----------------------------: | -----------------: | ------------------: |
| DEV02 |      0 |                         59,136 |    73,847 |                        22,674 |             38,336 |           1915 / 34 |
| DEV03 |      0 |                         62,391 |    78,000 |                        18,963 |             35,528 |           1684 / 37 |
| DEV06 |      0 |                         67,947 |   103,088 |                        22,765 |             60,002 |           1827 / 56 |
| DEV07 |      0 |                         83,033 |    99,069 |                        24,491 |             41,125 |           1948 / 33 |
| DEV11 |      0 |                         66,133 |    78,815 |                        21,567 |             34,712 |           1952 / 29 |
| DEV12 |      0 |                         65,163 |    86,403 |                        21,628 |             43,931 |           1930 / 40 |
| DEV03 |      1 |                         21,927 |    41,813 |                        20,892 |             41,801 |           1684 / 37 |
| DEV11 |      1 |                         22,218 |    35,597 |                        21,693 |             35,584 |           1949 / 29 |

First stage events arrived in 17–29 ms on cold cases; these are not first answer tokens. DEV12's generic `ttftMs` was 64,646 ms, but actual nonempty browser text appeared at 65,163 ms. The table uses `firstVisibleTokenMs`. Worker timing starts after preparation and ends before IPC/UI completion; its first-visible-text measure includes prefill and any earlier hidden output and is not a pure prefill timer.

For the **same six first-pass IDs**, conventional medians (mean of the middle pair) were:

| Run                       | First visible browser text, ms | Total, ms | Worker first visible, ms | Worker elapsed, ms |
| ------------------------- | -----------------------------: | --------: | -----------------------: | -----------------: |
| 4K baseline               |                     61,934.5\* |  81,756.5 |              unavailable |        unavailable |
| 4K / 768 MiB candidate    |                       66,674\* |    88,192 |                 19,807.5 |           42,110.5 |
| 8K / 1024 MiB / 6 threads |                         65,648 |    82,609 |                   22,151 |           39,730.5 |

\* Earlier runs recorded the original token-event-based TTFT rather than the later explicit nonempty-text field, so these timings are approximate cross-run comparisons. The candidate also changes context, KV quantization, offload, retrieval text/heuristics, prompt behavior, and indexing residency. These medians cannot isolate the CPU-thread or padding effect. Warm repeats avoid model transitions; their worker generation did not consistently become faster. A separately compiled-output-identical 11-thread control is needed for a better thread comparison.

## Memory observations and limits

The 434 whole-device GPU samples peaked at **3173 / 4096 MiB**, leaving **923 MiB observed headroom**. The peak occurred at `16:07:38.552Z` during indexing. Sampling can miss shorter peaks. All eight queries delivered terminal events without timeout; this run is evidence of this configuration completing, not a proof of universal memory safety.

Native Vulkan budget snapshots must not be confused with whole-device physical free memory. After the first reload, each of the next five cold reloads reported exactly 660,269,465 bytes used before chat weights and 2,506,156,441 bytes after chat context creation. The first was only about 2.25 MiB lower. There is no monotonic native VRAM growth in these snapshots.

Short OS samples showed substantial system RAM pressure:

| Local time (UTC+2)           | Available RAM, MiB | Committed / limit, GiB | Pages input/s | Page reads/s |
| ---------------------------- | -----------------: | ---------------------: | ------------: | -----------: |
| 18:10:28.718                 |               4534 |          55.56 / 60.57 |         52.84 |         5.98 |
| 18:11:43.844                 |               1233 |          57.55 / 60.57 |        182.39 |        14.87 |
| 18:11:44.863                 |               1224 |          57.55 / 60.57 |        128.71 |        10.81 |
| 18:18:10.050, after app exit |               5912 |          53.04 / 60.57 |         44.49 |         6.92 |

Page output was zero in these brief samples. Page-ins can include mapped-file reads; these samples do not establish sustained pagefile thrashing. The app's own post-load free-RAM reports ranged from 2.8 to 1.4 to 2.6 GiB across the six cases. This is a material uncontrolled latency confound.

Read-only process IDs established one Electron root (5504), models worker (8640), and four other children. At `16:13:12Z`, the worker had 3,880,783,872 bytes working set and 3,223,855,104 bytes private memory. A later sample reached 4,013,318,144 / 3,360,829,440 bytes, then fell to 3,960,721,408 / 3,307,790,336 bytes at `16:17:22Z`. Six one-second samples in the warm phase stayed essentially flat. Other Electron children stayed below 177 MB working set. The largest unrelated resident process was `vmmemWSL` (about 10.66 GiB working set / 15.56 GiB private at the first sample). No command lines or private process content were collected and no processes were stopped.

These samples missed the brief unloaded handoff phase and are **not sufficient to establish or exclude a RAM leak**. Working set/private memory are also different measurements from native allocated GPU memory. A future controlled lifecycle test should record worker RSS/private bytes, JS heap/external memory, and native RAM/VRAM at the same unloaded, loaded, and post-generation phases for each cycle; do not compare arbitrary phases as retained growth.

## Disposal audit

`modelsWorker.ts:688` awaits disposal of utility session/context, chat session/context, and model weights independently, then clears all five references. The 4 GB path does not create the utility context. Embedder disposal independently releases each context and then its model. Config and load-result maps retain scalar configuration/results, not model handles. A shared backend persists intentionally across handoffs.

In installed node-llama-cpp 3.21.1, `LlamaModel.js:118` awaits native model disposal and releases allocation markings; `LlamaContext.js:140` does the same for contexts. Native `AddonModel.cpp:484` calls `llama_model_free`, and `AddonContext.cpp:474` calls `llama_free`. Backend dispose listeners hold weak references and are removed through disposal aggregators. No concrete successful-path retained-weight reference was found.

Two diagnostic limitations remain: app disposal exceptions are swallowed, so failures would be hard to identify; and the library's default `GgufInsights` simulation-session metadata is not explicitly disposed by `LlamaModel.dispose`, relying on object collection/finalizers after references vanish. Those simulation models use `noAlloc` / `LLAMA_LOAD_MODE_NONE`, so this is not evidence that full weights remain resident. No dependency patch or forced GC is justified by the current samples.

## Where repeated chat loading spends time

The six cold reloads take roughly 35–48 seconds. Progress callbacks show most time in **automatic GPU-layer fitting**, before final weight-copy progress:

| Case  | Loading start to 100% model progress, ms | Preparing chat to ready, ms |
| ----- | ---------------------------------------: | --------------------------: |
| DEV02 |                                   32,493 |                      35,165 |
| DEV03 |                                   32,056 |                      34,908 |
| DEV06 |                                   33,129 |                      35,906 |
| DEV07 |                                   45,236 |                      48,226 |
| DEV11 |                                   33,824 |                      36,403 |
| DEV12 |                                   32,806 |                      35,200 |

For DEV02, progress was 0.0104 at 3.050 seconds, 0.0208 at 9.038 seconds, and 0.0832 at 29.383 seconds. It then jumped to 0.2302 at 31.951 seconds and reached 1.0 at 32.844 seconds. `LlamaModel.js:22,514–562` explicitly assigns these small increments to GPU-layer resolution, with a maximum 16% share, and then maps native model-load progress into the remainder. This supports repeated resource simulation/search as the dominant stage, rather than final chat-context allocation. The latter and remaining bookkeeping fit in the roughly 2.6–3.0-second tail; finer instrumentation would separate file parsing, fitting, actual weight allocation, and context creation.

The addon calls `llama_init_from_model`; it does not execute a separate generation warmup. The pinned context implementation initially disables the warmup flag and reserves prompt-processing/token-generation graphs and compute buffers. These safety allocations should remain. [Pinned context implementation](https://raw.githubusercontent.com/ggml-org/llama.cpp/v0.4.0/src/llama-context.cpp).

## Guarded plan reuse follow-up

Avoid caching native model/context objects merely to accelerate reload: keeping their GPU allocations conflicts with measured 4 GB headroom. The backend is already shared. Instead, a calibration-only experiment could remember the last successful GPU layer count for an unchanged model/backend/context/batch/padding configuration and try **`{ min: N, max: N, fitContext: { contextSize: target } }`** before ordinary automatic fitting.

The installed `resolveModelGpuLayersOption.js:91–182` still probes fresh memory, subtracts the extra half-padding for `fitContext`, and simulates requirements for that bounded choice. Plain numeric `N` also checks memory but omits the target-fit/extra-padding semantics, so it is a less faithful experiment. Real context creation must still perform its existing checks. Do not set `ignoreMemorySafetyChecks`, allow zero GPU layers, cache stale free memory, or bypass allocator cleanup.

Cache only a successful fully created context's layer count, scoped to the worker and model identity plus allocation inputs. Invalidate on configuration/backend changes and on failed fitting/allocation; dispose any partial model, retry ordinary auto once, then retain the existing bounded failure behavior. This may reduce the search to one candidate (with both mmap choices), but its latency benefit and changed-memory-pressure recovery still require native measurement and focused unit tests before adoption.

The initial native experiment used exact opt-in `LOKLM_REUSE_GPU_LAYER_PLAN=1`. After successful cold-query hits in `dev-8k-alias-plan`, the source default was enabled with exact `LOKLM_REUSE_GPU_LAYER_PLAN=0` as a diagnostic opt-out. The completed canonical `dev-8k-final` then verified that unset-variable default: the startup f16-to-post-index-q4_0 precision change caused one expected key miss, followed by eleven hits without allocation fallback. See [final resource acceptance](2026-09-24-native-final-dev-resources.md). Alias answer-quality results are a separate decision; citation aliases remain disabled by default.

The worker keeps at most four scalar layer hints, keyed by real path and file revision (device/inode/size/mtime/ctime), actual backend/device configuration, context/KV candidates, batch, flash attention, native padding, and threads. It does not hash/read all weight contents on every handoff. A changed revision misses naturally. Hits, misses, and fallback are logged; native fitting always probes current memory. A failed cleanup stops before further allocation. Unrelated corrupt-model errors remain fail-fast. All eleven focused tests, including the default/opt-out policy, passed after the run finished. The completed native run had 12 successful cold-query hits, no allocation fallback, and 919 MiB minimum sampled GPU headroom; see the [full hardware result](2026-09-24-native-plan-reuse-results.md).

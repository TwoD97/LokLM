# Native inference thread policy: source audit

The original logical-CPU-minus-one default supplied a **preferred evaluation count**, not only an emergency ceiling. On the Ryzen 3600, it selected 11 CPU threads for chat although the processor has six physical cores. After the bounded native comparison below, the app now prefers the backend's validated math-core count, capped by available scheduling capacity. This is a hardware-aware default, not a promise that six threads are fastest on every machine. Inference was run by the parent calibration harness, not by this source review.

## Installed library behavior

Evidence is from installed node-llama-cpp 3.21.1 and the llama.cpp v0.4.0 tag declared by its local `llama/llama.cpp.info.json`.

- Before this change, `modelsWorker.ts:createBackend` passed `max(1, cpus().length - 1)` to `getLlama`. It now initializes with an available-capacity bound, then sets the public `llama.maxThreads` after native math-core metadata becomes available and before any contexts are created.
- `dist/evaluator/LlamaContext/LlamaContext.js:94` makes an unspecified context thread count equal to backend `maxThreads` when that limit is nonzero. Only an unlimited backend (`maxThreads=0`) falls back to `llama.cpuMathCores` as its ideal. LokLM's chat allocator does not explicitly supply context threads.
- `dist/bindings/Llama.js:115` normally defaults GPU backends to unlimited aggregate threads, while contexts still default their preferred count to math cores. Thus the app's explicit 11-thread limit overrides the library's math-core default for a single context.
- `llama/addon/AddonContext.cpp:415` sets both native `n_threads` and `n_threads_batch` to the selected number; `:848` updates them together during evaluation. This API path does not expose a separate prefill-thread calibration from decode threads.
- `dist/evaluator/LlamaEmbeddingContext.js` and `LlamaRankingContext.js` specify `threads=6` when creating their contexts. On Vulkan's one-context pool, changing backend maximum from 11 to 6 leaves that preferred embedding count unchanged. Chat and utility contexts inherit the new maximum. On CUDA/Metal, the embedding pool can evaluate several contexts under the shared splitter, so a lower global cap can change its aggregate throughput too.
- The thread splitter divides the cap between active evaluations. LokLM's serializer already prevents independent native tasks from running simultaneously, so chat normally receives its requested ideal count. Neither a cap nor the worker process reserves a particular physical core for the renderer.

The native `cpuMathCores` calls `common_cpu_get_num_math()`. On Windows, the pinned implementation counts physical processor cores via `GetLogicalProcessorInformationEx`; its fallback uses a hardware-thread heuristic. On Linux it can distinguish efficiency cores on supported hybrid processors, and on macOS it prefers the performance-core count. Do not assume Windows hybrid CPUs receive the same performance-core filtering. [Pinned CPU implementation](https://raw.githubusercontent.com/ggml-org/llama.cpp/v0.4.0/common/common.cpp).

## Implemented bounded policy

After backend creation, before any context is constructed:

1. Use `availableParallelism()` for the process's available scheduling capacity, retaining `cpus()` only as diagnostic metadata. Node explicitly advises against using `cpus().length` to determine application parallelism. [Node OS documentation](https://nodejs.org/api/os.html#osavailableparallelism).
2. Set `capacity = max(1, availableParallelism - 1)`. Read and validate the backend's positive finite integer `cpuMathCores`.
3. A validated explicit calibration override wins, bounded to `1..capacity`, so a deliberate 11-thread SMT comparison remains possible. Otherwise use `max(1, min(cpuMathCores, capacity))`. If math-core metadata is unusable, retain the available-capacity bound; do not invent a detected physical-core count.
4. Set the public mutable `llama.maxThreads` before loading models or constructing contexts. Read the resulting value into telemetry. This avoids estimating physical cores by blindly dividing logical cores by two and uses the backend already initialized for the selected GPU.

This yields six threads for six physical/twelve available logical cores, four for four physical/eight logical, and three for four physical/four logical. It does **not** promise that one physical CPU core stays idle, pin worker affinity, change GPU placement, permit CPU-only inference, or vary batch sizes. Avoid an arbitrary blanket six-thread limit on all machines; the Ryzen result is not a benchmark for larger CPUs, integrated GPUs, or fully offloaded models.

The default policy is deliberately simpler than per-token adaptation. Do not change thread counts mid-generation from noisy utilization samples. If measurements justify separate chat and embedding limits later, explicit context ideals can be considered while preserving one shared aggregate cap; that is outside this pass.

## Interpretation of the combined 8K candidate

`dev-8k-balanced` combines 8192 context, default 1024 MiB reserve, six threads, cleaned retrieval text, and neutral document heuristics. It can establish the observed behavior of that combined candidate, not isolate the effect of threads. Compare only its six matched DEV IDs (02,03,06,07,11,12) against earlier runs; do not compare their median against an unmatched 12-case median.

Report first-event timing, first nonempty visible token timing, and worker first-visible-text timing as distinct measurements. For an even number of observations, use the arithmetic mean of the two middle sorted values. Separate first-pass cache misses from warm repeats. Preserve resolved context, actual GPU layers, KV type, native thread limit/math cores, whole-device minimum headroom, allocation retry/errors, and claim-level answer review. The heldout set remains closed until settings are selected.

## Small controlled follow-up

`dev-8k-threads11` reused the exact compiled main/worker artifacts from `dev-8k-balanced`, with 11 rather than 6 threads. Mutable source-file hashes alone are not sufficient evidence of compiled equality. Both resolved to 8K / q4_0 / 14 GPU layers / default padding; this control ran two cold questions and their warm repeats.

| Case  | Repeat | Worker first visible, 6 / 11 threads, ms | Worker total, 6 / 11 threads, ms | Input/output tokens, both runs |
| ----- | -----: | ---------------------------------------: | -------------------------------: | -----------------------------: |
| DEV03 |      0 |                          18,963 / 23,125 |                  35,528 / 46,703 |                      1684 / 37 |
| DEV11 |      0 |                          21,567 / 21,672 |                  34,712 / 36,879 |                      1952 / 29 |
| DEV03 |      1 |                          20,892 / 19,583 |                  41,801 / 45,473 |                      1684 / 37 |
| DEV11 |      1 |                          21,693 / 22,678 |                  35,584 / 42,085 |                      1949 / 29 |

All four worker elapsed times favor six threads, while warm DEV03 first-visible timing favors eleven. Conventional median worker elapsed is 35,556 ms for six threads versus 43,779 ms for eleven across these matched four observations; first-visible medians are 21,229.5 versus 22,175 ms. These are a small ordered sample, not repeated randomized trials. System free RAM differed (roughly 2.5–2.7 GiB in relevant six-thread snapshots versus 3.0–3.1 GiB in the control), and DEV03 was the first question after indexing in the control but not in the six-thread run. End-to-end timings therefore have additional residency/order confounds. The evidence supports the bounded hardware-aware default on this host without claiming a universal percentage speedup or a quality gain.

Validation: 24 focused thread-policy tests cover native math cores, available-capacity bounds, explicit overrides, and unusable metadata. Both `dev-8k-alias-plan` and the completed canonical `dev-8k-final` left `LOKLM_INFERENCE_THREADS` unset and logged `maxThreads=6`, `cpuMathCores=6`, `logicalCores=12`, `availableParallelism=12`. Final DEV startup used f16 KV, then the first post-index query selected q4_0 and correctly missed the KV-specific layer-plan cache; the next eleven questions reused that plan. All twelve query contexts remained 8K/q4_0/14 layers. See [final resource acceptance](2026-09-24-native-final-dev-resources.md) for actual timings and reserve/headroom verification.

# Native padding comparison: completed DEV evidence

The baseline completed 12 DEV questions; the 768 MiB candidate completed the same 12 first-pass questions and two warm repeats. **Keep the default reserve unchanged.** The candidate narrows physical headroom without improving median first-pass total latency materially; its median first-token latency is worse. Its query cache clearly avoids repeat-query reloads. The candidate also changes the style suffix used for retrieval and the calculation prompt, so this is **not a controlled padding-only speed comparison**.

Sources: `tests/evals/native-calibration/reports/dev-4k-baseline/raw.json` and `reports/dev-4k-candidate/raw.json` beneath the same directory. The baseline uses 1024 MiB padding; candidate worker memory snapshots confirm 805306368 bytes (768 MiB). Both resolve to 4096 context tokens on the same GTX 1050 Ti/Vulkan backend; reranking remains off and model residency exclusive.

| Observed metric                           |                            Baseline |                                                Candidate |
| ----------------------------------------- | ----------------------------------: | -------------------------------------------------------: |
| Chat GPU layers                           |                            15 of 33 |                                                 21 of 33 |
| KV cache                                  | f16, with q8_0/q4_0 on some reloads | f16 for 01–10, q8_0 for 11, q4_0 for 12 and warm repeats |
| Sampled whole-card peak                   |                            3552 MiB |                                                 3678 MiB |
| Minimum sampled physical headroom         |                             544 MiB |                                                  418 MiB |
| Completed first-pass questions            |                                  12 |                                                       12 |
| First-pass median time to first text      |                            62.193 s |                                                 65.007 s |
| First-pass median total time              |                            89.162 s |                                                 88.921 s |
| Median chat reload duration               |                            30.325 s |                                                 39.312 s |
| Median pre-generation transition duration |                            37.690 s |                                                 46.184 s |
| Median generation-call duration           |                            49.116 s |                                                 42.110 s |
| Startup / indexing time                   |                   40.638 / 43.381 s |                                        47.969 / 48.388 s |

The candidate's 3678 MiB peak is from startup at 15:40:10.242Z. Its maximum after the first question begins is 3664 MiB during the DEV-03 warm repeat at 16:00:00.381Z, leaving 432 MiB. All 14 queries completed with terminal events and no recorded timeout, rejected allocation, or native error in the saved application log. The candidate contains 838 whole-device samples at a median interval of 1507 ms (range 1284–1826 ms). These are observed peaks, not upper bounds, and this small run does not establish a robust desktop margin.

## Memory accounting and physical headroom

Candidate DEV-01's native `after-chat-context` snapshot at 15:41:42.775Z reports 4218 MiB total, 3020 MiB used, and 1198 MiB free. The whole-card sample 933 milliseconds later reports 3650 MiB used of 4096, leaving 446 MiB. The probes differ in both scope and timing; these values must not be substituted for each other.

The pinned Vulkan implementation derives free from per-process `heapBudget - heapUsage`, while total comes from heap sizes. Khronos defines budget and usage as estimates for the process, which can change. Thus native free is remaining allocation budget, not necessarily global physical headroom. [Pinned llama.cpp v0.4.0 source](https://raw.githubusercontent.com/ggml-org/llama.cpp/v0.4.0/ggml/src/ggml-vulkan/ggml-vulkan.cpp), [Khronos definitions](https://docs.vulkan.org/refpages/latest/refpages/source/VkPhysicalDeviceMemoryBudgetPropertiesEXT.html).

Using each question's model-loading gap only as an approximate background reference, candidate generation adds 2180–2203 MiB for DEV-01 through DEV-04, compared with baseline 1750–1804 MiB. Candidate gaps are lower, roughly 1446–1464 MiB versus 1568–1603 MiB. This suggests the increased model allocation contributes to the narrower margin; it is not simply a higher desktop baseline in those intervals. These are whole-device differences, not measured process allocations.

## First-pass latency comparison

Seconds, matched question IDs; all are first-pass queries.

| Case   | Baseline TTFT | Candidate TTFT | Baseline total | Candidate total |
| ------ | ------------: | -------------: | -------------: | --------------: |
| DEV-01 |        70.457 |         61.513 |         92.790 |          71.582 |
| DEV-02 |        59.930 |         68.896 |         75.599 |          88.962 |
| DEV-03 |        64.021 |         62.512 |         84.255 |          77.878 |
| DEV-04 |        60.321 |         67.270 |         92.386 |         102.575 |
| DEV-05 |        65.866 |         71.256 |         99.316 |          88.879 |
| DEV-06 |        64.335 |         63.222 |        102.870 |          87.422 |
| DEV-07 |        63.939 |         64.452 |        132.883 |          70.687 |
| DEV-08 |        69.159 |         64.722 |         85.938 |          91.283 |
| DEV-09 |        55.490 |         63.835 |         63.621 |          69.833 |
| DEV-10 |        60.447 |         65.292 |        112.835 |         135.821 |
| DEV-11 |        55.963 |         78.337 |         79.258 |         100.874 |
| DEV-12 |        56.316 |         75.377 |         66.542 |          94.140 |

For DEV-01 through DEV-03, candidate chat reload takes 38.1–39.9 seconds versus baseline 30.1–33.1 seconds. Its prompts are about 15% shorter, and DEV-01 changes KV type from q8_0 to f16. More offloaded layers can help generation while extending reload time, but this sample does not establish that padding caused every change. Some baseline rows lack the terminal IPC event despite a native completion log; their total times are harness invoke-completion observations, not verified final-event timestamps. See the baseline manual review. The candidate captures all terminal events.

## Warm query-cache repeats

| Case   | Candidate first-pass TTFT / total | Warm TTFT / total | Warm retrieval |
| ------ | --------------------------------: | ----------------: | -------------: |
| DEV-01 |                 61.513 / 71.582 s | 19.357 / 35.023 s |           6 ms |
| DEV-03 |                 62.512 / 77.878 s | 33.482 / 51.919 s |           9 ms |

The saved retrieval trace shows 12 initial cache misses followed by two hits. Both warm queries have zero model-transition events and no `Preparing embedder`/`Preparing llm` log. The cache holds 12 vectors, 49152 reported payload bytes. It is the query embedding that is reused; answers still run through chat generation.

These repeats are deliberately reported separately. They reuse the resident 21-layer chat model with q4_0 KV, whereas their first pass used f16; background conditions and generated citations also vary. The direct, defensible result is that the repeat paths avoid roughly 45 seconds of embedding/chat reloads. The two-query speedups cannot be extrapolated to previously unseen questions, and latency does not establish citation correctness.

## Decision

Keep the default reserve unchanged and retain exclusive residency. The 768 MiB override remains a calibration option: it ran this corpus without recorded allocation failures, but leaves only 418 MiB minimum sampled physical headroom and produced no meaningful first-pass median total improvement. Do not reduce to 512 MiB or add co-residency on the strength of Vulkan's larger process-budget reading. Favor eliminating avoidable reloads and fixing retrieval/grounding defects; those are distinct from reducing memory reserve.

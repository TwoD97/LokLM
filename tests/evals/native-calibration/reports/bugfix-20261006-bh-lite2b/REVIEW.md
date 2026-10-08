# BH Lite2B characterization — parser nonpass

The pinned Qwen3.5-2B Q4_K_M model placed all **25/25 layers on GPU** and completed the original AB01 diagnostic in **14.885 seconds including parsing**. This is a useful resource result, but the unchanged parser admitted **no final answer**: fixed diagnostics were `answer` / `summary_display`. Strict and product acceptance are nonpasses. Semantic, citation, language and sentence-format grades remain null; no rejected text was retained or inspected.

One original AB01 attempt ran with zero retries. The original key and eight complete passages/order were unchanged, as were the frozen BF prompt/system/schema, greedy temperature 0, no repeat penalty, 128 thought tokens and 2,176 total tokens. The current citation-fixed parser was bound to the final build. The original production worker ran without a sampler facade. The other 12 original cases and the fresh validation set remained unattempted/unopened; no default model changed.

| Measurement                  | Observed |
| ---------------------------- | -------: |
| Model load                   | 15.161 s |
| Native generation            | 14.699 s |
| Direct call                  | 14.883 s |
| Call + parser                | 14.885 s |
| Cold arm, including teardown | 30.492 s |
| Cold group                   | 30.706 s |
| Through durable closure      | 36.651 s |

The separate 180-second direct diagnostic target passed; collection remained capped at 300 seconds. Full application latency was not measured. Actual allocation was Vulkan, 8,192-token context, f16 KV, six threads and 1 GiB reserve. Fixed allocator metadata recorded a cache miss followed by readiness, with no recorded context rejection. Generation ended normally after the 128-token thought cap, two forced closing tokens and 140 visible envelope tokens (270 combined); the private thought and envelope were not retained.

`summary_display` combines several unchanged display predicates. The retained category does not identify the exact rejected punctuation, length or other condition. It cannot support a semantic diagnosis. The smaller model and its full GPU allocation differ from the 4B runs, so this is candidate characterization, not a matched causal comparison or proof of better answer quality. Exact BF/BH request identity is proven; original historical BD outbound bytes were not retained, and that earlier request was reconstructed from recorded passages and metadata.

Complete closure preceded grading: **601 pins matched**, Node/postverifier/worker exits were **0/0/0**, pending requests and forced stops were zero, no owned/native processes remained, profiles were removed and capture was disabled. Independent grading confirms the parser nonpass and null unassessable answer grades. No further case, retry or default adoption follows from this result.

See [manual.json](manual.json) for grading and [observations.json](observations.json) for model/build hashes, fixed metadata and immutable evidence pins.

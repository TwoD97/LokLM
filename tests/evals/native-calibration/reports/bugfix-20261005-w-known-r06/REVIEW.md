# W: correct comparison with unrelated extra passages

**The one requested known-case gate answers the question correctly, with a relevance/display partial.** It chooses `comparison/compatible` and displays the complete morning and evening Ostel passages: **12 sensors at 08:00 UTC** and **17 at 18:00 UTC** on **2031-10-06**, before and after deliveries/withdrawals. Both requested facts have their exact **11:11 / 12:12** citations. The earlier invented location distinction is absent.

It also selects **17:18** and **16:17**, unrelated Rilven inspection reports containing 34/31 passed devices and serial ranges. These are genuine source quotations with correct source links, but do not support the requested Ostel comparison. They double the displayed evidence blocks and introduce irrelevant facts. This is distinct from an invented fact, wrong citation, false refusal or incomplete requested comparison; it prevents an unqualified clean result under a relevance-aware assessment.

W changes only general routing/scope instructions: complete direct comparisons can use original passages even when the question also requests their source facts, while current governing rules and additional synthesis retain ordinary answers. V's lexical retrieval correction remains. The v8 schemas for 1/2/10/32 catalogs are byte-identical to the previously compiled public S grammar. Parser, renderer, sampler, context and output limits are unchanged. No source selection oracle or extra model pass is used.

All **18 documents** remain eligible. The actual packed context contains 11 passages, in the same order as V: 11:11, 12:12, 17:18, 16:17, 7:7, 8:8, 13:15, 6:6, 5:5, 2:2, 13:14. W therefore selects the first four supplied sources, including two unrelated ones. This observation does not establish a general position bias or reliable automatic relevance selection.

| Measurement                               |               Observation |
| ----------------------------------------- | ------------------------: |
| Total / first visible answer              | 111.255 / 111.254 seconds |
| Actual restored context / KV / GPU layers |          8192 / q4_0 / 14 |
| Native execution                          |                 100813 ms |
| Grammar / prompt-fit check                |                 4 / 29 ms |
| First / last internal text callback       |          24745 / 99555 ms |
| Input / output tokens                     |                2647 / 153 |
| Response characters / callbacks           |                 339 / 152 |
| Completion reason                         |     stopGenerationTrigger |

The call uses temperature 0, repeatPenalty:false and the unchanged 2176-token output limit. Internal callbacks are not visible streaming or exact prefill boundaries. Startup was 42.410 seconds, indexing 10.542 seconds and sampled peak GPU use 3442 MiB. Actual query KV was q4_0, matching V/T06; startup f16 is not the query allocation. One known-case observation does not establish a causal latency or general quality gain.

The test-only observer recorded bounded structural types/counts, with 0 ms observer time, 3 ms settlement and zero errors/drops/pending requests. No private check, raw envelope or hidden segments were inspected or retained. There was one clean terminal, no timeout, retry, repair or grammar fallback. The owned process exited 0 and GPU was released before reporting. The subsequent [ordinary-answer controls](../bugfix-20261005-w-synthesis-controls/REVIEW.md) were explicitly launched as a separate regression collection despite this relevance partial, producing two passes and a current-rule completeness partial. Other known, transfer and fresh groups remain unlaunched.

Freeze: local generated `out/optimization-20261005/w-production-freeze.json`, **2026-10-05T20:06:06.221Z**. Production source freeze: **20:04:59.947Z**. Build manifest SHA-256: `d21745fd131f70ce628b7e79ac6ecfcf1a1a9250e483688b0a76b798d2e770c6`; worker SHA-256: `1afc9f5617eda7029a56602786205c66d2eb5de79755d9b214e054c01d21e376`. Compiled bytes were unchanged and source correspondence matched after exit.

[manual.json](manual.json) records the dimensional verdict. `raw.json`, `review.json`, `app.log` and `retrieval.log` are local generated artifacts. Raw SHA-256: `8aa7ef154ca2e62fa3fb6150d20f02fe225599ddb263a841518006feab317c2d`. [V's partial](../bugfix-20261005-v-known-r06/REVIEW.md), [T's false refusal](../bugfix-20261005-t-known-r06/REVIEW.md) and the [U6 diagnostic](../bugfix-20261005-u6-relationship-diagnostic/REVIEW.md) remain unchanged. The executing agent has not opened the newly sealed three-case source/question/reference contents.

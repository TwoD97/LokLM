# X: both targeted known-case checks pass

**Two requested cases completed once; both pass independent factual, completeness and citation review.** These are selected known development cases, not a fresh accuracy estimate.

| Case                                | Result and actual evidence                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 02: current partial amendment       | Explicitly answers **4 drills / 5 saws** on 2031-06-01. The explanation correctly identifies the original 3-drill limit, approval on 2031-05-02, effect from 2031-05-15 and unchanged saw limit. All clauses are supported by actual supplied **3:3 / 4:4**, attached to one coherent ordinary answer record.         |
| 06: observations at different times | Correct `comparison/compatible` decision. Only **11:11 / 12:12** are displayed, fully preserving **12 at 08:00 UTC before** deliveries/withdrawals and **17 at 18:00 UTC afterward**, on the same date. No unrelated Rilven reports, invented location difference or false insufficiency remains in this observation. |

X combines task-first routing instructions with **sources-before-outcome native comparison grammar** (`typed-comparison-v9`). The ordinary schema subtree and parser are unchanged from W, as are V's lexical retrieval correction, sampler, output/context budgets and rendering. Semantically equivalent comparison JSON property orders remain accepted by the parser. This grouped treatment does not isolate whether instructions, output order or their interaction produced the observed change. Valid source IDs still do not mechanically prove claim support or the relationship judgment.

All **18 documents** remained eligible with default expansion and no reference-source filtering. Both required passages for each case were actually supplied. There was one generation per question, no timeout, cancellation, retry, repair or grammar fallback.

| Measurement                         |                    02 |                    06 |
| ----------------------------------- | --------------------: | --------------------: |
| Total / first visible answer        |             142.701 s |             108.598 s |
| Actual context / KV / GPU layers    |      8192 / q8_0 / 14 |      8192 / q8_0 / 14 |
| Native execution                    |             132264 ms |              91418 ms |
| Input / output tokens               |            2685 / 223 |            2701 / 135 |
| First / last internal text callback |     24894 / 129841 ms |      25038 / 90235 ms |
| Grammar / prompt-fit check          |             3 / 32 ms |             2 / 30 ms |
| Completion reason                   | stopGenerationTrigger | stopGenerationTrigger |

The automatic startup profile was full, with actual 8K context; startup KV was f16, while both query restorations used q8_0. Earlier W runs used different automatic allocations. No isolated latency or broad quality improvement is claimed. Temperature was 0, repeatPenalty:false and the output limit remained 2176 tokens. Internal text callbacks are not visible streaming or exact prefill boundaries.

Startup took 42.430 seconds, indexing 11.219 seconds and sampled peak GPU use was 3440 MiB. The synthetic observer had zero errors/drops/pending requests, 0 ms observer processing and 3 ms settlement per case. Only fixed structural types/counts were retained; no private check, raw envelope or hidden segments were read or persisted.

The owned process 1275 exited 0, with compiled bytes unchanged and current source correspondence verified after exit. The GPU was released; the separately declared [remaining ten known cases](../bugfix-20261005-x-known-reasoning-remaining/REVIEW.md) then began under a new grant. No completed question is repeated there. Transfer and fresh groups remain unlaunched at this gate's completion. The executing agent has not opened the sealed three-case source/question/reference contents.

Freeze: local generated `out/optimization-20261005/x-production-freeze.json`, **2026-10-05T20:26:14.595Z**. Public Vulkan grammar compilation passed 1/2/10/32 source catalogs without loading a model/context, followed by a successful no-model Electron observer probe. Manifest SHA-256: `282142934df7e53fdae60e193e841ff09e8f930d76b9a80f7057e5294480b716`; worker SHA-256: `1afc9f5617eda7029a56602786205c66d2eb5de79755d9b214e054c01d21e376`; comparison helper SHA-256: `c8c138728aed94291b57794372afe41145a4a67f106c55b0d5af8076e4becce1`.

[manual.json](manual.json) records both independent judgments. `raw.json`, `review.json`, `app.log` and `retrieval.log` are local generated artifacts. Raw SHA-256: `e9cd2058a6f373665d85cae38f748550ede40a09bb155b7befb562aa2ed063cd`. Earlier [W06 relevance](../bugfix-20261005-w-known-r06/REVIEW.md) and [W02 completeness](../bugfix-20261005-w-synthesis-controls/REVIEW.md) partials remain preserved.

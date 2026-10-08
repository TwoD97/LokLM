# W: ordinary-answer controls expose a routing regression

**Three requested cases were attempted once and completed: two strict passes and one completeness partial.** This was an explicitly authorized known-case regression collection **despite W06's relevance partial**, not a claim that the preceding acceptance gate passed. No fresh validation was performed.

| Case                                | Strict result | Actual answer against supplied evidence                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 02: applicable partial amendment    | Partial       | Exact base 3:3 and amendment 4:4 are displayed, including every necessary date and unchanged-saw clause, but the model selects comparison/compatible. It never explicitly answers the requested current 4-drill / 5-saw limits on 2031-06-01. No invented authority or wrong source; current-rule synthesis is omitted. |
| 09: sum across disjoint populations | Pass          | West 31 for serials 700–739 plus East 34 for 740–779 gives 65. The answer explicitly justifies addition using the non-overlapping populations; exact 16:17 / 17:18 references attach the same coherent record.                                                                                                          |
| 11: source-backed rate              | Pass          | 18 litres over 3 minutes gives 6 litres/minute, with both input values and the calculation attached to exact table 13:15.                                                                                                                                                                                               |

All 18 documents remained eligible, default whole-document expansion was enabled, and no reference-source filtering was used. Both required sources for 02/09 and the required table for 11 were actually supplied. The 02 failure is therefore answer-mode/completeness, not retrieval loss. True quotations do not automatically fulfill a request to compose a current rule. The two successful arithmetic cases show that ordinary synthesis remains possible; they do not cancel the current-rule regression.

| Case | Total seconds | Actual KV | Native ms | Input / output tokens | Mode       |
| ---- | ------------: | --------- | --------: | --------------------: | ---------- |
| 02   |        99.001 | q4_0      |     88402 |            2631 / 126 | comparison |
| 09   |        148.22 | q4_0      |    130853 |            2659 / 212 | answered   |
| 11   |       106.009 | f16       |     88843 |            2685 / 142 | answered   |

All queries used actual 8192-token contexts and 14 GPU layers, temperature 0, repeatPenalty:false and unchanged 2176-token output limits. KV allocation varied as recorded; startup f16 must not substitute for query allocation. All calls completed with stopGenerationTrigger, no timeout, cancellation, repair, retry or grammar fallback. Native callback timings are internal response events, not user-visible streaming or exact prefill measurements. Content-free per-case measurements and actual supplied IDs are preserved in local [metrics.json](metrics.json).

Startup was 41.426 seconds, indexing 11.248 seconds and sampled peak GPU use 3460 MiB. The test-only observer retained fixed structural types/counts only; no check text, raw envelope or hidden segments were inspected or retained. Observer status had no errors/drops/pending work. The owned process 46542 exited 0 and the GPU was released immediately after the final result.

The candidate is unchanged from [W06](../bugfix-20261005-w-known-r06/REVIEW.md). Its correct comparison with two irrelevant extra paragraphs remains a separate relevance partial. Remaining known reasoning, transfer and fresh groups were not launched. This small selected regression is known development evidence, not a general reliability claim.

Declaration: local generated `out/optimization-20261005/w-synthesis-controls-declaration.json`, **2026-10-05T20:13:03.040Z**. Production freeze: `w-production-freeze.json`, 20:06:06.221Z. Manifest SHA-256: `d21745fd131f70ce628b7e79ac6ecfcf1a1a9250e483688b0a76b798d2e770c6`; worker SHA-256: `1afc9f5617eda7029a56602786205c66d2eb5de79755d9b214e054c01d21e376`. Compiled bytes remained unchanged and source correspondence matched after exit.

[manual.json](manual.json) holds the dimensional grades. `raw.json`, `review.json`, `app.log`, `retrieval.log` and metrics JSON are local generated artifacts. Raw SHA-256: `a9d389733a2fc4153db15d375e138f6205e5273865e9a0321c1e48e9227e8826`. No fresh source/question/reference contents were opened by this executing agent.

# V: lexical ranking improves; the answer still adds a false scope claim

**One requested/observed known-case gate completed, with a strict partial/nonpass.** V now correctly says that the stock observations do not contradict one another and gives **12 at 08:00 UTC** and **17 at 18:00 UTC** on **2031-10-06**, with the correct local **11:11 / 12:12** citations. Its opening nevertheless says the records concern **different places**. Both supplied passages describe the sealed cabinet at the same Ostel repair centre; only the observation times and before/after stock-movement scopes differ. That invented location distinction is a substantive unsupported rationale, not merely a grammar defect.

The actual application trace confirms the intended retrieval correction:

| Measurement                                    | T baseline                              | V                                     |
| ---------------------------------------------- | --------------------------------------- | ------------------------------------- |
| First lexical arm                              | 10 hits, including 8 irrelevant matches | Only 11:11 and 12:12                  |
| Second lexical arm                             | 8 irrelevant matches                    | No lexical matches                    |
| Required passages' fused ranks                 | 9 / 10                                  | 1 / 2                                 |
| Required passages' retrieval-final positions   | 9 / 10                                  | 1 / 2                                 |
| Required passages' actual prompt-fed positions | 8 / 9                                   | 1 / 2                                 |
| Dense arm IDs, ranks and scores                | Baseline                                | Byte-identical serialized values      |
| Main relationship decision                     | False insufficient refusal              | Correct no-conflict answer            |
| All-claims grounding                           | Partial                                 | Partial: invented different locations |

The required sources' RRF and adjusted scores are unchanged; unrelated lexical votes are removed. All 18 documents remain eligible. The 11 supplied passages change in order and membership; no source-oracle filtering, top-K tuning or dense pruning is used. Retrieval-final order differs from actual packed prompt order: packing moves header 13:14 to the end in both runs. The prompt-fed positions above come from the raw citation events. The trace records original query variants and resulting arms, not an explicit filtered document lexical string. [retrieval-comparison.json](retrieval-comparison.json) preserves both orders and the exact arm/rank comparison as a local generated artifact. Serialized dense equality: **true**.

The production change is limited to document BM25 queries: shared English/German function words are filtered while Unicode tokens remain. Code workspaces retain their existing expansion, explicit literals bypass filtering, and stopword-only queries preserve their fallback. Dense inputs/cache keys, T generation instructions, v8 schema, sampler, context/output budgets and answer rendering are unchanged. The service tests cover these boundaries. This corrects the demonstrated lexical-ranking defect; it does not establish reliable model reasoning or a general quality gain.

The actual query allocation was **8192 tokens, q4_0 KV, 14 GPU layers**, as in T06. Startup f16 was not the generation allocation. V took **166.479 seconds** versus T's 88.990, producing a longer ordinary answer instead of a compact comparison selection. This single known-case observation does not isolate a general latency effect.

| Content-free measurement          |             V observation |
| --------------------------------- | ------------------------: |
| Total / first visible answer      | 166.479 / 166.478 seconds |
| Native execution                  |                 156024 ms |
| Grammar / prompt-fit check        |                 5 / 32 ms |
| First / last native text callback |         24049 / 154170 ms |
| Input / output tokens             |                2586 / 265 |
| Response characters / callbacks   |                 700 / 263 |
| Stop reason                       |     stopGenerationTrigger |

Callbacks are internal response events, not user-visible streaming or exact prefill boundaries. There was one complete parsed answered-mode generation, no timeout, cancellation, retry or grammar fallback. Startup was 42.543 s, indexing 10.560 s and sampled peak GPU use 3438 MiB. The synthetic observer recorded only bounded fixed structural types/counts; it took 0 ms, settlement 3 ms, with no errors/drops/pending requests. No check, raw envelope or hidden segments were inspected or retained.

The owned process exited 0 and GPU was released before reporting. Remaining 11 known reasoning, 4 transfer and 3 fresh scripts are **prepared but unlaunched**. The fresh three-case source/question/reference contents remain unopened by this executing agent. The [T failure](../bugfix-20261005-t-known-r06/REVIEW.md) and [U6 diagnostic](../bugfix-20261005-u6-relationship-diagnostic/REVIEW.md) remain unchanged. An independent reviewer confirmed the V partial verdict.

Freeze: local generated `out/optimization-20261005/v-production-freeze.json`, 2026-10-05T19:55:34.022Z. Manifest SHA-256: `ac1a3e18715332bade72afd49292ba60b9e1d3089f53fca29c8fef3a4b665464`; worker SHA-256: `1afc9f5617eda7029a56602786205c66d2eb5de79755d9b214e054c01d21e376`. Build bytes remained unchanged and source correspondence matched after exit. [manual.json](manual.json) records the partial. `raw.json`, `review.json`, `app.log`, `retrieval.log` and comparison JSON are local generated artifacts. Raw SHA-256: `af178f7776e32479119cb60d06d47fbcb31f85576ba143f5bd44c835269ca9c9`.

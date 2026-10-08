# AQ AB replay: three strict passes

**All three original AB questions pass the unchanged strict criteria in this known DEV replay.** Every attempt completed once within the 180-second app deadline, with the required facts, authority distinction, format and local citations. This passes the three-case group; it does not establish full thirteen-case acceptance or fresh-case reliability.

[Safe observations](observations.json) preserve exact final answers, actual supplied source order and fixed runtime counters. [Manual judgments](manual.json) record independent claim-level grading. Prior AC failures, AP's non-answer/format partial and all other historical results remain unchanged.

| Case        | Strict result                                                       | App seconds | Native seconds |
| ----------- | ------------------------------------------------------------------- | ----------: | -------------: |
| ab-fresh-01 | Pass: both intervals, scoped uncertainty, concise format, both refs |     128.960 |        118.214 |
| ab-fresh-02 | Pass: current 5/7, explicit nonapproval/no-change, all three refs   |     169.308 |        151.487 |
| ab-fresh-03 | Pass: actual/planned 2375 CHF difference, one sentence, both refs   |     141.847 |        124.876 |

Requested/attempted/completed/strict passes: **3/3/3/3**. Partials, substantive failures, parser rejections, timeouts and unobserved cases within this group: **zero**. Remaining AQ groups have separate declarations and grading gates. No fresh facts were authored for this replay.

## Original-criteria review

**AB01 passes.** Actual supplied South 2:2 gives 19 days and North 1:1 gives 14 days for the same NP-6 campaign S8. The final selects only those two exact value-bearing units, each with its own canonical reference. Its compact framed sentence limits uncertainty to what the supplied excerpts establish. It invents no winner, chronology, supersession, external nonapproval or global absence of a binding interval. The previous AP issue-date/header additions are absent. The original short-format requirement is satisfied consistently with earlier accepted compact framed comparisons; retaining one English source quotation is the documented presentation tradeoff, not a factual or format failure. Escaped Markdown punctuation does not alter rendered source values.

**AB02 passes.** Actual supplied 3:3 establishes the retained 7-tablet limit; approved amendment 4:4 sets 5 projectors effective before the asked 2038-04-08. Proposal 5:5 supports its additional circulation date 2038-04-02, explicit facilities-council nonapproval and absence of authority to change the limits. The answer states current 5/7, rejects the later paper and explicitly gives the nonapproval reason demanded by the unchanged original key. All three references attach to the coherent answer paragraph and cover every visible clause. It does not invent a base value or conflate approval and effective dates. The question permits two sentences.

**AB03 passes.** Actual supplied 7:7 gives planned 2037 main-campus receipts of 29835 CHF; 6:6 gives recorded 2036 receipts of 27460 CHF. Their difference is 2375 CHF. The one short sentence preserves planned/recorded status and years, cites both inputs locally and excludes the separate reserve and Annex. It does not assert the target was achieved. Repeating the input numbers is not an additional requirement of the question.

All eight original documents were eligible for actual app retrieval. Actual supplied counts were 8, 8 and 7, with every required passage present. No gold-source filter, output repair, question mutation or retry was used. Original fixtures and criteria, including the AB02 nonapproval explanation that was missing in AM, remain unchanged.

## Runtime and scope

AQ restores a check-then-result envelope under `typed-comparison-v18`, retaining bounded128 and compact JSON. This is a distinct declared candidate, not assumed quality-neutral behavior. Separate-run differences do not isolate a causal explanation for the observed improvement over AP or earlier experiments.

All calls observed active bounded128 on the main route, q8_0 KV, 8192 context, 14 GPU layers, temperature 0, repeat penalty disabled and maxTokens 2176. AB01 used a concise 31-unit comparison plan with `unresolved`; AB02/03 used full plans with `answered`. Every call stopped normally with `stopGenerationTrigger` and a settled completed terminal. There was no unsupported-wrapper, setup-failed or grammar-fallback status.

The bounded observer recorded check/result root keys, check type string with length 120 codepoints, and zero external JSON line breaks for all three parsed envelopes. Only structure/counts were inspected; no private check content or hidden thought text was retained or read.

| Case | Prompt tokens | Prefill tokens / batches | Thought | Forced closing | Constrained response | Combined |
| ---- | ------------: | -----------------------: | ------: | -------------: | -------------------: | -------: |
| 01   |          1647 |                 1646 / 7 |     128 |              2 |                  100 |      230 |
| 02   |          1482 |                 1481 / 6 |     128 |              2 |                  181 |      311 |
| 03   |          1323 |                 1322 / 6 |     128 |              2 |                  130 |      260 |

Constrained-response counts include the private check and JSON syntax, not only displayed prose. Native generation time is a subset of the app deadline, which also includes retrieval/preparation. Case 02 finished with **10.692 seconds** of margin; successful completion here is not a general latency guarantee.

The exact evaluation overrides were `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, with app 180s, one attempt and zero retries. This is not “all production defaults.” Trace, screenshot and video were off.

## Closure and provenance

Declaration frozen **2026-10-06T04:14:58.470Z**; collection **04:15:26.530Z–04:23:40.236Z**; postverification **04:24:11.409Z**. All **421 source / 112 compiled** pins plus model, fixture and harness hashes matched, with no changed paths. Observer disposal recorded zero errors/drops/pending replies; no owned native or Playwright process or browser capture remained. The runner exited 0 and operational `safeToContinue=true`; semantic group acceptance comes from the independent review above.

- Build manifest: `4ffd56cb9b2717bd3c576a7520e36c8ee9e40b2d5990289bdb92096a6b43f63b`.
- Compiled worker: `2b5751b66659b31cc6307e52bd3764d92d681e44b6f8154956b0c4890ea0eb35`.
- Declaration: `out/optimization-20261005/aq-ab-replay-execution-declaration.json`, SHA-256 `70252ad6684e26000aeb572ed97e50463a99b6d382312377495eb55512e5874b`.
- Postverification: `out/optimization-20261005/aq-ab-replay-postverify.json`, SHA-256 `822a4d8af15803491fa1c641dece421def4685d8a3ed2a42fc9cb6e107aaf2a5`.
- Local [raw observations](raw.json), SHA-256 `9dd3c8d5099f3cf5175a0cb53f9a52f4f2c7d4fdf7cd8b382b2d9306ff57e4ae`.
- Original rubric: `tests/evals/native-calibration/ab-fresh-validation-20261006.grading.json`, SHA-256 `1f58336d4e09cd0c17d05419bfed55fe96271d69cbc4f4814da5ba3b903f4079`.

Raw/log/declaration/postverification files are generated local artifacts; tracked review, manual judgments and allowlisted observations preserve this evidence. Report preparation changed no production/harness/fixture/criterion and launched no model. The original corpus is now known DEV. Later known controls and any future authored validation must satisfy their own explicit gates; this report supplies no fresh authorship authorization.

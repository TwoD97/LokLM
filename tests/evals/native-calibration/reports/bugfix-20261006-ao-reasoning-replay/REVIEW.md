# AO reasoning replay: three strict passes, one timeout, two unobserved

**The three completed answers pass the unchanged criteria. Case 09 timed out, so this six-case group did not complete.** Requested: 6; attempted: 4; completed finals: 3; strict passes: 3; operational timeouts: 1; unobserved: 2. The timeout also held the two queued transfer cases, leaving four of AO's ten requested cases unobserved overall.

[Safe observations](observations.json) preserve exact completed answers, the fixed interruption notice, actual supplied source order and allowlisted counters. [Manual judgments](manual.json) record independent review against original questions and actual source passages. These are known DEV observations, not fresh validation.

| Case                  | Strict result                            | App seconds | Native seconds | App deadline margin |
| --------------------- | ---------------------------------------- | ----------: | -------------: | ------------------: |
| reasoning-reserved-02 | Pass                                     |     179.767 |        169.229 |             0.233 s |
| reasoning-reserved-05 | Pass                                     |     153.077 |        135.947 |            26.923 s |
| reasoning-reserved-06 | Pass                                     |     174.563 |        157.191 |             5.437 s |
| reasoning-reserved-09 | Operational timeout; no semantic verdict |     180.234 |        162.169 |                   — |
| reasoning-reserved-11 | Unobserved                               |           — |              — |                   — |
| reasoning-reserved-12 | Unobserved                               |           — |              — |                   — |

## Original-criteria review

**02 passes.** Supplied 3:3 establishes the baseline 3 drills and 5 saws effective 2031-01-10. Approved amendment 4:4 changes only drills to 4 from 2031-05-15, retaining the saw limit. The answer correctly composes current 4/5 for the asked 2031-06-01, distinguishes historical and current limits, and preserves both effective dates. Both canonical references locally support the coherent paragraph; no unsupported authority detail is added. There was no one-sentence requirement.

**05 passes.** Supplied 9:9 supports current 72 EUR and effective 2031-03-01. Supplied 10:10 explicitly states proposed 81 EUR, no assembly vote yet, and no revocation of the governing rule. The answer preserves those distinctions and attaches both references to its coherent paragraph. Nonapproval is not inferred from documentary silence.

**06 passes.** Supplied 11:11 and 12:12 establish 12 sensors at 08:00 UTC and 17 at 18:00 UTC on 2031-10-06 in the same cabinet, before and after the day's activity. The final correctly finds no contradiction and supplies both requested counts and times, with both local references. It does not invent different locations, an authority issue, or an unrelated scope explanation.

**09 has no completed answer to grade.** Both required passages 16:17 and 17:18 were actually supplied, so the timeout is not evidence of retrieval omission. The sole cancelled terminal contains only the fixed interruption notice. No sum, disjoint-scope decision, selected sources or hidden reasoning can be inferred from progress counters. Cases 11/12 were not attempted; their earlier results do not supply missing AO observations.

## Runtime and timeout evidence

All four calls observed v16, full comparison plans, active bounded128 on the main route, q8_0 KV, 8192 context, 14 GPU layers, temperature 0, repeat penalty disabled and maxTokens 2176. Worker start markers reported compact JSON. The three completed envelopes each had zero external line breaks; case 09 had a worker-error observation with no retained envelope, so no whitespace or parse-quality claim is made for it. There was no unsupported-wrapper, setup-failed or grammar-fallback status.

| Case | Prompt tokens | Prefill tokens / batches | Thought | Forced closing | Constrained response | Combined |
| ---- | ------------: | -----------------------: | ------: | -------------: | -------------------: | -------: |
| 02   |          1954 |                 1953 / 8 |     128 |              2 |                  205 |      335 |
| 05   |          1588 |                 1587 / 7 |     128 |              2 |                  147 |      277 |
| 06   |          1970 |                 1969 / 8 |     128 |              2 |                  172 |      302 |
| 09   |          1982 |                 1981 / 8 |     128 |              2 |                  191 |      321 |

For cancelled case 09, nested bounded counters report first/last constrained-response token at 75.848 / 161.723 seconds from native invocation. The top-level response has zero retained characters, null completion reason and `cancelled=true`; native elapsed time was 162.169 seconds within the 180.234-second app attempt. Thus generation progressed before cancellation, but no validated answer was published. These content-free counters do not identify the incomplete output or establish why it missed the deadline. “Constrained response” includes private check and JSON syntax, not only user-visible prose. The three completions stopped normally with `stopGenerationTrigger`.

The full 18-document corpus was available; actual supplied counts were 11, 9, 11 and 11 in case order. Retrieval used the same explicit evaluation overrides as the known queue: `rerank=false`, `multiQuery=false`, `routing=false`, and `wholeDocFallback=true`. This is not a claim that all production defaults were used. Questions/fixtures/criteria were unchanged, with no gold-source filter, output repair or retry. `continueErrors=true` does not override the harness's native-timeout stop policy.

## Closure and provenance

Declaration freeze: **2026-10-06T03:12:01.840Z**. Collection started **03:12:24.651Z**. Postverification at **03:25:17.545Z** matched all 419 source and 112 compiled pins plus model, fixtures and harness. Observer disposal recorded zero errors/drops/pending replies; no owned native or Playwright process remained. The runner exited 1 and `safeToContinue=false`. No later group or fresh corpus was launched/authored.

Trace, screenshot and video were configured off. Playwright nevertheless generated an owned `error-context.md` on the failure. Under root authorization it was hashed and removed without reading its contents; raw/log/declaration/postverify evidence was retained. This historical exception is recorded in `out/optimization-20261005/ao-reasoning-capture-correction.json` (SHA-256 `c4cbf663804a19e0be8ff787baa4c22eb4eddbef18d72a6b13cd8bd3ee85823b`). It is not retroactively described as “no artifact generated.” No trace/screenshot/video artifact remained after cleanup.

- Build manifest: `564eb3cd028a8f4f7c51ce4f3f6cf7f08ea88de96af16fd5bd05819b9a3ff7c5`.
- Compiled worker: `2b5751b66659b31cc6307e52bd3764d92d681e44b6f8154956b0c4890ea0eb35`.
- Declaration: `out/optimization-20261005/ao-reasoning-replay-execution-declaration.json`, SHA-256 `9523294d368a2e587ea5e3ac4cf5bd69b9992a51c132925602288f19bc266255`.
- Postverification: `out/optimization-20261005/ao-reasoning-replay-postverify.json`, SHA-256 `06e2e5ea83a91909433b6ab75b830f21eb5f70a6cde46bf9591963d2c160a359`.
- Local [raw observations](raw.json), SHA-256 `0be61b6dc75f0aa127cd072690e62c25afb8774700cf4ab7cd9d886cc64ab8d1`.

Raw/log/declaration/correction files are generated local artifacts; this review, manual judgments and allowlisted observations preserve the result in version control. No private thought/check/envelope content was inspected. Report preparation changed no production, harness, fixture or grading requirement. See the [combined AO summary](../bugfix-20261006-ao-known-summary/REVIEW.md) for the full ten-case denominator and separate carried AN evidence.

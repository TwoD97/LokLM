# AN known AB app replay: three strict answer passes, one envelope-format discrepancy

**All three final answers pass the unchanged original rubric, including completeness, local citation support and requested format.** All completed within the app deadline, once each, without retries. Separately, AB02's valid JSON envelope had **one external line break despite the compact worker marker**. The answer-quality pass does not erase that runtime discrepancy.

[Tracked observations](observations.json) preserve every exact final, actual supplied source order and safe counters. [Manual judgments](manual.json) record independent original-criteria review. No private check, hidden thoughts/token arrays, raw generation envelope or rejected content was inspected or retained in these report files.

| Order | Case        | Strict answer result | App seconds | Native seconds | External JSON line breaks |
| ----- | ----------- | -------------------- | ----------: | -------------: | ------------------------: |
| 1     | ab-fresh-01 | Pass                 |     122.543 |        111.683 |                         0 |
| 2     | ab-fresh-02 | Pass                 |     153.520 |        135.790 |                     **1** |
| 3     | ab-fresh-03 | Pass                 |     153.604 |        136.002 |                         0 |

## Independent original-criteria review

**AB01 passes.** The compact framed sentence provides both exact NP-6/S8 alternatives: South **19 days** with 2:2 and North **14 days** with 1:1. Its lead limits the conclusion to what the supplied excerpts establish. There is no invented winner, approval denial, supersession, chronology or global absence of a binding interval. Both required values and references are present, without irrelevant heading/date units. The original English quotation in the German frame remains the same documented presentation tradeoff.

**AB02 passes, including the explanation missing in AM.** Current **5 projectors** follows from approved amendment 4:4, effective before the asked date; **7 tablets** remains supported by base 3:3. The final correctly says the later working paper does not change those limits **“as it was not approved.”** Proposal 5:5 explicitly supports that reason. All three references attach the coherent paragraph. No proposed nine-tablet value is presented as current, no unsupported approval/date condition is added, and the two-sentence answer is permitted by this question. The original strict requirement for explicit nonapproval is satisfied without changing the key or relaxing the AM assessment.

**AB03 passes.** Planned 2037 main-campus receipts of 29835 CHF minus recorded 2036 receipts of 27460 CHF equal **2375 CHF**. The one short sentence preserves the actual/planned distinction and years, cites both actual input passages 6:6 and 7:7 locally, and excludes the reserve and Annex figure. Repeating the two input amounts is not required by the question.

Thus requested-answer correctness, attribution and the strict original key all pass **3/3**. This is a three-case **known DEV** result, not new validation or general reliability evidence. The earlier [AM 2/3 strict result](../bugfix-20261006-am-ab-replay/REVIEW.md) and all prior failures remain unchanged.

## Observed treatment and the formatting limit

AN uses `typed-comparison-v16` with the ordinary-rule instruction to state the source-stated reason a selected/rejected rule governs or does not govern. The declared runtime remains bounded128, compact JSON, check-plus-result and the same comparison/source-admission structure. No isolated causal claim is made from this separate run.

The original AB01→02→03 questions ran with all eight original documents eligible, actual app retrieval and default whole-document expansion. The established harness disables reranking, multi-query and routing. Actual fed counts were 8, 8 and 7; every required passage was supplied. No gold-source selection, output repair or retry was used.

Every call logged v16, active bounded reasoning on the main route with maximum **128**, q8_0 KV, 8192 context, 14 GPU layers, temperature 0, repeat penalty disabled and maxTokens 2176. AB01 used a concise 31-unit catalog; the other two used full mode. All had normal `stopGenerationTrigger`, one completed terminal and a settled invocation, with no unsupported-wrapper, setup-failed or grammar-fallback status.

All three fixed worker start markers say `jsonWhitespace=compact`, but successful observer parses report **`rows[].capture.externalLineBreaks = 0, 1, 0`**. Therefore the declared zero-external-line-break predicate is **false for AB02** and true for the other two. The fixed scalar does not reveal the break's location or cause; neither is inferred. No raw envelope was retained or inspected. It would be incorrect to claim that all three observed envelopes were strictly compact merely from the start marker. This internal envelope discrepancy is separate from the correct, properly formatted displayed answer.

| Case | Prompt tokens | Prefill tokens / batches | Thought | Forced closing | Constrained response | Combined |
| ---- | ------------: | -----------------------: | ------: | -------------: | -------------------: | -------: |
| AB01 |          1618 |                 1617 / 7 |     128 |              2 |                   85 |      215 |
| AB02 |          1453 |                 1452 / 6 |     128 |              2 |                  148 |      278 |
| AB03 |          1294 |                 1293 / 6 |     128 |              2 |                  131 |      261 |

Each parsed envelope had a string check of 120 codepoints; only its type/length was observed. Constrained-response tokens include that private field and JSON syntax, not only user prose. The app's 180-second deadline includes retrieval/preparation; native timing is a subset. App margins were 57.457, 26.480 and 26.396 seconds. These measured completions are not a general latency guarantee.

## Provenance and cleanup

Declaration freeze: **2026-10-06T02:48:01.913Z**. Collection: **02:48:30.418Z–02:56:33.700Z**. Postverification: **02:56:58.517Z**. All 419 source and 112 compiled pins, model/fixture/harness bytes matched. The observer was disposed with zero errors, drops or pending replies; no owned native/Playwright process or capture artifact remained. Trace, screenshot and video capture were explicitly off. The runner exited 0.

- Build manifest SHA-256: `570cba0cae53bf5cbf3ae110c5891fba6830dc4aa8536862da551d81d12aa7c4`.
- Compiled worker SHA-256: `c2b3c41142a9523a108f9467981215cb3e5fbd0049468755c583edeae7798645`.
- Declaration: `out/optimization-20261005/an-ab-replay-execution-declaration.json`, SHA-256 `b952abca1623ea8a7066460d7dea54aba527adef5e67054fa392c5c90f129140`.
- Postverification: `out/optimization-20261005/an-ab-replay-postverify.json`, SHA-256 `add50290e3b96ab5c0ea631226f5f6873fd78bd17acde49cfc3656a637ac2af5`.
- Original local [raw observations](raw.json), SHA-256 `e49e0c1671443482fd761e53444a0b4f2819cad332c74f455df962e46b324eb9`.
- Unchanged rubric SHA-256: `1f58336d4e09cd0c17d05419bfed55fe96271d69cbc4f4814da5ba3b903f4079`.

Raw/log/declaration files are generated local artifacts. The review, manual judgments and allowlisted observations preserve the result in version control. Report preparation made no production, harness, fixture or grading changes and launched no model or fresh corpus.

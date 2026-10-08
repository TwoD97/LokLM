# AP result-only replay: one strict pass, one format partial, one non-answer

**AP fails the original three-case quality gate.** All three attempts completed within 180 seconds, but only the arithmetic answer strictly passes. The conflict answer includes both correct values and citations but violates the requested concise format; the rule question receives only an ellipsis and source links. Normal parsing and exit 0 do not make that a usable answer.

[Safe observations](observations.json) preserve all three exact final displays, actual fed source order and fixed runtime counters. [Manual judgments](manual.json) apply the unchanged original keys. This is a known DEV replay; original AC failures and subsequent diagnostics remain preserved.

| Case        | Requested-answer / source support                                 | Strict result                          | App seconds | Native seconds |
| ----------- | ----------------------------------------------------------------- | -------------------------------------- | ----------: | -------------: |
| ab-fresh-01 | Both intervals correct, safe uncertainty, both correct local refs | Partial: short-format/relevance defect |     102.427 |         91.763 |
| ab-fresh-02 | No substantive answer; only `...` plus valid refs                 | Failure: completed non-answer          |     109.181 |         92.018 |
| ab-fresh-03 | Correct 2375 CHF difference, status/years and both refs           | Pass                                   |     122.706 |        105.800 |

Requested/attempted/completed: **3/3/3**. Strict passes: **1**; strict partials: **1**; completed substantive failures: **1**; parser rejections/timeouts/unobserved within this group: **0/0/0**. The planned later ten AP cases were not launched because the required AB3 strict 3/3 gate failed. They receive no inferred verdict. No fresh set was authored.

## Independent original-criteria assessment

**AB01 is a format/relevance partial, not a false winner.** Actual supplied South 2:2 states 19 days and North 1:1 states 14 days for the same NP-6 campaign S8. Both exact value-bearing sentences appear with their own correct local references. The fixed evidence-scoped uncertainty lead does not choose a binding interval, invent priority/supersession, deny an external approval event or assert that no binding interval exists anywhere.

The final nevertheless selects four units: an issue-date sentence, the South interval, a literal North heading with a line break, and the North interval. The extra date and heading are true source material, but unnecessary for the requested short response. This expanded four-unit display fails the original one-short-sentence/no-irrelevant-appendix criterion. It is distinct from earlier missing-North failures: both requested values are now present, and there is no unsupported factual claim. Markdown escaping of source punctuation is not itself a date or citation error.

**AB02 is a completed non-answer.** Its entire displayed content is:

> ... [doc:3, chunk:3] [doc:5, chunk:5] [doc:4, chunk:4]

All three required originals were actually supplied: base 3:3 establishes 7 tablets, approved/effective amendment 4:4 sets 5 projectors and retains other provisions, and proposal 5:5 explicitly lacks approval and authority to change the limits. The final states none of those requested values, the change decision or the original key's required nonapproval explanation. Valid source IDs alone do not answer the question. This is a successfully parsed `answered` result and a completed terminal, not a parser rejection, timeout, false numerical assertion or evidence of any recoverable hidden answer. No discarded or private content is inferred.

**AB03 strictly passes.** Supplied 7:7 gives planned 2037 main-campus receipts of 29835 CHF and 6:6 gives recorded 2036 receipts of 27460 CHF. Their difference is 2375 CHF. The one short sentence preserves planned/recorded status and years, cites both inputs locally, excludes the reserve and Annex, and does not assert the target was achieved. The question does not require repeating both input amounts.

The full eight-document corpus was available to actual app retrieval. Actual supplied counts were 8, 8 and 7, with every required passage present. There was no gold-source filtering, question mutation, output repair or retry. Original facts, keys and strict interpretation remain unchanged, including the historical AM distinction between a correct decision and its omitted explicit nonapproval explanation.

## Observed treatment and timing

AP uses `typed-comparison-v17`, a result-only envelope, bounded128 and compact JSON. It is a new candidate and build, not assumed quality-neutral removal of a check field and not equivalent to the earlier AJ64 experiment. Dependency remediation was separately included in the declared build. This one sequence does not isolate causality or establish a latency guarantee.

All three calls observed active bounded128 on the main route, q8_0 KV, 8192 context, 14 GPU layers, temperature 0, repeat penalty disabled and maxTokens 2176. AB01 used a concise 31-unit comparison plan and returned `unresolved`; AB02/03 used full plans and returned `answered`. All ended normally with `stopGenerationTrigger`, settled completed terminals and no unsupported-wrapper/setup-failed/grammar-fallback status. Captured structures had only the `result` root key, absent-check type metadata and zero external JSON line breaks. No private body was inspected.

| Case | Prompt tokens | Prefill tokens / batches | Thought | Forced closing | Constrained response | Combined |
| ---- | ------------: | -----------------------: | ------: | -------------: | -------------------: | -------: |
| 01   |          1611 |                 1610 / 7 |     128 |              2 |                   45 |      175 |
| 02   |          1446 |                 1445 / 6 |     128 |              2 |                   47 |      177 |
| 03   |          1287 |                 1286 / 6 |     128 |              2 |                   73 |      203 |

These are content-free counts. Result-only constrained-response tokens include JSON syntax and source/unit selections, not only displayed prose. App times include retrieval/preparation; native generation is a subset. Shorter generation that publishes a non-answer is not a successful quality/latency improvement.

The exact evaluation overrides were `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, one attempt and zero retries, with the unchanged 180-second app deadline. This is not “all production defaults.” Trace, screenshot and video were off.

## Closure, provenance and scope

Declaration frozen **2026-10-06T03:54:11.112Z**; collection **03:54:38.940Z–04:01:05.901Z**; postverification **04:01:50.992Z**. All **421 source / 112 compiled** pins plus model, fixture and harness hashes matched, with no changed paths. The observer drained/disposed with zero errors/drops/pending replies and no owned native or Playwright process remained. No browser capture artifact remained. Runner exit 0 and `safeToContinue=true` describe operational cleanup only: the separate quality gate failed, so no later group was authorized from that flag.

- Build manifest: `ec019d2ccbbf1a513b1315c532459e2c25bb58bb883fb566e34980663177eaf1`.
- Compiled worker: `2b5751b66659b31cc6307e52bd3764d92d681e44b6f8154956b0c4890ea0eb35`.
- Declaration: `out/optimization-20261005/ap-ab-replay-execution-declaration.json`, SHA-256 `0f5d60c4815927b1adcff203f2f567e925b3289f4aa45ea20e934bf70ea9923e`.
- Postverification: `out/optimization-20261005/ap-ab-replay-postverify.json`, SHA-256 `a6608d5224985bcc382191536296c0ffb4af59b93c60b09c2f7c304ce7d8f82c`.
- Local [raw observations](raw.json), SHA-256 `83fdd250a0be60081a5478d6f40c04bcfc4a1e48677c8f93853b27d130816a92`.
- Original rubric: `tests/evals/native-calibration/ab-fresh-validation-20261006.grading.json`, SHA-256 `1f58336d4e09cd0c17d05419bfed55fe96271d69cbc4f4814da5ba3b903f4079`.

Raw/log/declaration/postverification files are generated local artifacts; tracked review, manual judgments and allowlisted observations preserve the final evidence. No private thoughts, check contents, rejected prose or raw generated envelopes were read. Report preparation changed no production/harness/fixture/criterion and launched no model. The corpus is now known DEV; this is neither fresh validation nor a reliability claim.

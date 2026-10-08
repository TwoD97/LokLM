# AR sealed fresh validation: unattempted-only continuation

**Five of six continuation cases pass the original strict criteria; 07 is a false refusal.** Only previously unattempted 03–08 ran, once each. The original eight-case denominator and case 02 rejection remain preserved; this is not a replacement run.

[Manual review](manual.json) records each finding; [safe observations](observations.json) retain exact validated finals and fixed metadata. The [complete eight-case summary](../bugfix-20261006-ar-fresh-validation-summary/REVIEW.md) separates correctness and timing.

| Case | Strict result |  App time | Native time | Clean within 180 |
| ---- | ------------- | --------: | ----------: | ---------------- |
| 03   | Pass          | 211.129 s |   200.482 s | No               |
| 04   | Pass          | 192.697 s |   175.191 s | No               |
| 05   | Pass          | 173.760 s |   156.156 s | Yes              |
| 06   | Pass          | 179.632 s |   161.665 s | Yes              |
| 07   | False refusal | 164.056 s |   143.047 s | Yes              |
| 08   | Pass          | 161.966 s |   142.731 s | Yes              |

**03:** Strict PASS. Actual 4:4 supplies retained 13-working-day period; 5:5 approves monthly 39-image quota on 2054-02-12, effective 2054-03-04 before asked 2054-05-02; 6:6 explicitly says the 2054-04-16 period proposal is unapproved and changes no rule. The final gives both current values and both requested authority reasons, including correct additional dates. All three canonical citations attach the coherent paragraph. No unapproved 10-day/current obsolete 27 claim or false refusal. No one-sentence limit was requested.

**04:** Strict PASS. Actual 7:7/8:8/9:9 jointly establish 15 CHF current at 2055-09-21, approved future 18 CHF from 2055-10-07, and 2055-08-13 approval distinct from activation. The final answers both amounts/date and requested reason, with all three local citations; it does not label the approved future rule unapproved or prematurely effective. No one-sentence limit was requested.

**05:** Strict PASS. Actual 11:11 planned 2054 west-block 1648 trees minus 10:10 completed 2053 west-block 1386 trees equals 262. The final gives both inputs, years, planned/completed distinction and difference in one short sentence with both local citations. West-block scope is unambiguous from the question and actual sources; its name need not be repeated. No nursery seedlings/east block or achieved-target claim is introduced.

**06:** Strict PASS. Actual 12:12 gives 0.84 kg and 13:13 gives 840g for the same entire dry sample with glass excluded. The final explicitly normalizes both to 840 grams, correctly says no contradiction and gives the requested matching sample-scope explanation with both local citations. Repeating the question date/time is not an extra requirement. No gross-container mass or invented partial sample; multiple sentences are permitted.

**07:** Strict FALSE REFUSAL. Actual 14:14 and 15:15 explicitly give same-cabinet T5 snapshots: 23 unused vouchers at 07:40 UTC before distribution and 9 at 16:10 UTC after distribution/returns. Both complete exact excerpts and correct citations are displayed, but the lead says no definite answer can be derived and the recorded decision is unresolved. The requested compatibility is answerable: different documented times/phases are not a same-time contradiction. Accurate quotation and citation identity do not repair the wrong relationship decision or missing requested synthesis. No retrieval omission: both required passages were supplied.

**08:** Strict PASS for the requested missing-input response. Actual 16:16 gives height 2.4m and explicitly omits width/front-face area. The final says the survey has no width, preventing area calculation, in one short sentence with the correct local citation. It invents neither an area nor a square shape and scopes the absence to the supplied survey.

All twenty sealed documents were eligible. Evaluation used `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, `CONTINUE_ERRORS=0`, one attempt and a prospective 300-second app cap. These are explicit evaluation settings, not all production defaults. Within 180 is a separate clean-completion measure; an errored request below 180 does not pass it. Native time excludes some app work, so it is not substituted for app elapsed.

All required passages were actually fed. Their captured source hashes and complete chunk text match the sealed original documents. Per-query source order, final references and scalar runtime evidence are preserved in [observations.json](observations.json). All attempted calls observed v19/check+result, bounded 128/main, compact JSON and zero external structural line breaks, with Q8 KV, 8K context, 14 GPU layers and 2176 total output allowance; no fallback. Hidden thought/private check text, raw generation envelopes and rejected prose were neither read nor retained in these reports.

Both collection closures matched their frozen 421 source/112 compiled pins plus model/data/harness pins, with no changed paths, clean observer disposal, no pending replies/errors and no owned processes or captures. These are historical closure facts: production sources changed after collection, and this report makes no claim that the current workspace still equals AR. Original fixture/key/seal bytes remain unchanged.

The continuation uses a fresh process, so 03 has first-query preparation rather than the third position in an uninterrupted run. No input changes, adaptive source filtering, output repairs, retries or intervening production tuning occurred. Production contributors received no case/key/output contents until all eight attempts were collected and both runs closed; root and the independent reviewer recorded verdicts before author verification.

- Frozen AR build: `c238f16db7574e4638d435a4d7191d47abba20c5670fd54bb1de29f2c255b0ea`.
- Declaration: `out/optimization-20261005/ar-fresh-validation-continuation01-execution-declaration.json`, SHA 256 `25f85673396191c59b77183164fb33c650aa8edfab15221388456edb182046e6`.
- Postverification: `out/optimization-20261005/ar-fresh-validation-continuation01-postverify.json`, SHA 256 `1c85c98b497b445f142187a7242b452e8275e5ddd560526ae7a8f09aaaf1c72d`.
- Local [raw observations](raw.json), SHA 256 `36153596256b41141414889cdb053de51befd9b79844fbf6c260a6882ec1d0ad`.

Raw/log/declaration files are ignored local artifacts; tracked REVIEW/manual/observations preserve safe evidence. Original AQ failures and the 13-case AR known report remain unchanged. No blanket reliability or exact discarded-label causal claim follows from this small internal validation.

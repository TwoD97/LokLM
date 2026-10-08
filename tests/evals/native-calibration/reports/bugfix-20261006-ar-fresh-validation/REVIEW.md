# AR sealed fresh validation: initial two attempts

**No strict passes among the two observed attempts: 01 has a format partial; 02 has a structural parser rejection.** The original request was eight cases. Cases 3–8 were initially unobserved and later collected only in the separately declared continuation, with no repeat of 01 or 02.

[Manual review](manual.json) records each finding; [safe observations](observations.json) retain exact validated finals and fixed metadata. The [complete eight-case summary](../bugfix-20261006-ar-fresh-validation-summary/REVIEW.md) separates correctness and timing.

| Case | Strict result  |  App time | Native time | Clean within 180 |
| ---- | -------------- | --------: | ----------: | ---------------- |
| 01   | Format partial | 138.972 s |   128.214 s | Yes              |
| 02   | Parser nonpass | 159.837 s |   142.555 s | No               |

**01:** Strict PARTIAL for the explicit short-sentence format. The 61-word outer frame (citation markers excluded) contains four full quoted sentence units. Both 1180/1260-pixel alternatives, source mapping and documentary lack of established priority are correct and locally cited 1:1/2:2. The lead is evidence-scoped, not a winner, global nonapproval or claim that no binding width exists. The original question requests one short sentence; four full-sentence quotation units and repeated qualification do not satisfy brevity, even though joined into one semicolon frame. This is not a factual/citation failure or a newly imposed numerical word cap.

**02:** Operational nonpass: completed constrained generation was rejected with fixed detail source_duplicate; no validated final is available. Actual supplied 3:3 contains both alternatives and the absence-of-priority statement. No discarded facts, selected IDs, exact duplicated syntax, intended decision or semantic quality is inferred. The initial run stops here and its failure remains part of denominator 8; this case is never retried.

All twenty sealed documents were eligible. Evaluation used `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, `CONTINUE_ERRORS=0`, one attempt and a prospective 300-second app cap. These are explicit evaluation settings, not all production defaults. Within 180 is a separate clean-completion measure; an errored request below 180 does not pass it. Native time excludes some app work, so it is not substituted for app elapsed.

All required passages were actually fed. Their captured source hashes and complete chunk text match the sealed original documents. Per-query source order, final references and scalar runtime evidence are preserved in [observations.json](observations.json). All attempted calls observed v19/check+result, bounded 128/main, compact JSON and zero external structural line breaks, with Q8 KV, 8K context, 14 GPU layers and 2176 total output allowance; no fallback. Hidden thought/private check text, raw generation envelopes and rejected prose were neither read nor retained in these reports.

Both collection closures matched their frozen 421 source/112 compiled pins plus model/data/harness pins, with no changed paths, clean observer disposal, no pending replies/errors and no owned processes or captures. These are historical closure facts: production sources changed after collection, and this report makes no claim that the current workspace still equals AR. Original fixture/key/seal bytes remain unchanged.

The continuation uses a fresh process, so 03 has first-query preparation rather than the third position in an uninterrupted run. No input changes, adaptive source filtering, output repairs, retries or intervening production tuning occurred. Production contributors received no case/key/output contents until all eight attempts were collected and both runs closed; root and the independent reviewer recorded verdicts before author verification.

- Frozen AR build: `c238f16db7574e4638d435a4d7191d47abba20c5670fd54bb1de29f2c255b0ea`.
- Declaration: `out/optimization-20261005/ar-fresh-validation-execution-declaration.json`, SHA 256 `ae7e90edbb6001e5f1520446dd6a24041dfee178c13ac8a8898fdb5bb9691e57`.
- Postverification: `out/optimization-20261005/ar-fresh-validation-postverify.json`, SHA 256 `f192465751df7c64f0dcd0a2a8a26295b8a888fb43c479b8c5fd854a136142e5`.
- Local [raw observations](raw.json), SHA 256 `c19ecc3ec7223fe2ad007d2556f896aa660ed7d4240c7028cbf4e213032255de`.

Raw/log/declaration files are ignored local artifacts; tracked REVIEW/manual/observations preserve safe evidence. Original AQ failures and the 13-case AR known report remain unchanged. No blanket reliability or exact discarded-label causal claim follows from this small internal validation.

# AR correctness coverage: original AB cases

**All three completed answers pass the unchanged original factual, completeness, citation and format criteria. All three also completed within 180 seconds.** This group was prospectively declared with a **300-second calibration cap**; it is a new known DEV collection, not a revision of earlier AQ failures or fresh validation.

[Safe observations](observations.json) retain the exact validated answers, actual supplied source order and allowlisted metadata. [Manual review](manual.json) grades every visible claim against the original key and actual fed chunks.

| Case | Strict result |  App time | Native time | Observed within 180 s |
| ---- | ------------- | --------: | ----------: | --------------------- |
| AB01 | Pass          | 128.960 s |   117.958 s | Yes                   |
| AB02 | Pass          | 169.497 s |   151.863 s | Yes                   |
| AB03 | Pass          | 144.655 s |   127.520 s | Yes                   |

Requested **3**, attempted **3**, validated finals **3**, strict passes **3**, parser rejections **0**, timeouts **0**, unobserved **0**. Each case was attempted once in original order, with no retry or repair.

## Original-criteria review

**AB01:** The compact framed answer preserves South's **19 days** from 2:2 and North's **14 days** from 1:1 for the same NP-6/S8 scope. Each exact source unit has its own correct canonical reference. The lead says the supplied passages do not establish a unique answer, without choosing a binding interval, denying an external approval event or claiming no interval exists. Only the two relevant units appear, with no date/heading appendix. The one-short-sentence presentation passes under the original compact framed-comparison interpretation; the English source quote remains a presentation tradeoff, not a factual or format failure.

**AB02:** The answer correctly gives **5 projectors and 7 tablets** for 2038-04-08. The approved amendment 4:4 changes only projectors before that date; base 3:3 retains the tablet quantity. Proposal 5:5 supports its stated 2038-04-02 circulation date, explicit facilities-council nonapproval, and lack of authority to alter the limits. The answer states the nonapproval reason explicitly, satisfying the original strict key without relaxing the historical AM criterion. All three canonical references support the coherent two-sentence paragraph. No one-sentence restriction applies to this question.

**AB03:** Planned main-campus receipts of **29,835 CHF for 2037** minus recorded **27,460 CHF for 2036** equal **2,375 CHF**. Actual fed 7:7 and 6:6 support both inputs, with both canonical references on the single short sentence. Planned/recorded status and years are preserved. The answer neither adds the reserve nor substitutes the Annex nor asserts that the target was achieved. Repeating both input amounts is not required by the question.

The exact question text, source corpus and sealed key are unchanged. These cases were initially authored after AB's source freeze and before AC by an internal evaluation contributor familiar with prior failures; production contributors first saw them after the initial collection. They have since been used repeatedly for development. This observation is known DEV evidence, not an independent or unseen benchmark, and supports no blanket reliability claim.

## Runtime and protocol

All calls observed **v19**, active bounded **128** on the main route, compact JSON, q8_0 KV, 8192 context, 14 GPU layers, maxTokens 2176, temperature 0 and repeat penalty disabled. No unsupported-wrapper, setup-failed or grammar-fallback status appeared. AB01 used the concise catalog (31 units) and selected `comparison/unresolved`; AB02 and AB03 used `answered`. All completed envelopes had check/result keys, a check string of 120 codepoints and **externalLineBreaks=0**. Only scalar structure was inspected.

Thought/forced-closing counts were 128/2 in each case. Constrained-response counts were 100/181/130; combined counts 230/311/260. Exact prompt counts were 1647/1482/1323, with prefill 1646/1481/1322 over 7/6/6 batches. These constrained-response counts include private check and JSON syntax, not just displayed prose.

All fixed source-label shape categories were zero. AB01 was a comparison with zero inspected ordinary blocks; AB02 and AB03 each had one inspected block (253 and 108 characters). Nothing was capped. These counts do not prove semantic correctness or infer unseen syntax from previous attempts. Observer work was 1/1/0 ms.

All **eight original documents** were available to retrieval for every case. Evaluation overrides were `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`; they are not all production defaults. There was no source/gold selection. `CONTINUE_ERRORS=0` and the 300-second timer were declared before collection. The timer belongs to calibration, not a production answer deadline. AB02 had the smallest observed margin below 180 seconds, **10.503 seconds**; this is an observation, not a latency guarantee.

This group contributes three new observations to the prospective AR correctness protocol. The separately reported [AR09 observation](../bugfix-20261006-ar-reasoning09-completion300/REVIEW.md) remains a semantic pass at **184.894 seconds**, above 180. The [AQ180 aggregate](../bugfix-20261006-aq-known-summary/REVIEW.md) and [AQ completion300 rejection](../bugfix-20261006-aq-reasoning09-completion300/REVIEW.md) are unchanged. Cases still awaiting a new group are not credited from earlier candidates.

## Provenance and cleanup

Declaration frozen **2026-10-06T05:12:08.988Z**; collection **05:14:51.207Z–05:23:07.740Z**; postverification **05:23:55.943Z**. All **421 source / 112 compiled** pins plus model, fixtures and harness matched, with `currentSourcesMatchBuild=true` and `changedPaths=[]`. Runner exit 0, `cleanupVerified=true`, `requestCompleted=true`; observer disposed with zero errors, drops and pending replies. No owned native/Playwright processes or capture artifacts remained. Trace/screenshot/video were off.

`safeToContinue=false` preserved the group review boundary; each later group requires its own explicit grant after independent review. No fresh facts were authored or authorized by this group.

- Frozen AR build: `c238f16db7574e4638d435a4d7191d47abba20c5670fd54bb1de29f2c255b0ea`.
- Declaration: `out/optimization-20261005/ar-completion300-ab-execution-declaration.json`, SHA256 `e5d0efd468efe30ebb17499273fa38c3f32ee4688955542b1da776a157b1e589`.
- Postverification: `out/optimization-20261005/ar-completion300-ab-postverify.json`, SHA256 `2b75b37c1c62b21b262f082aefd6d23dae82e0a9ffa73b7036d49392cd0c7077`.
- Local [raw observations](raw.json), SHA256 `1b0ceed5c991a19d274977bbce37d6463696fcf1c3f842a521bde7c4185c7e7f`.

Raw/log/declaration files are local generated artifacts; the tracked review/manual/observations preserve safe evidence. No private thought, private check, raw generated envelope or rejected content was read. Reporting changed no production, harness, source fixture or grading criterion and made no model calls.

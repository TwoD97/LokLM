# AR correctness coverage: five reasoning controls

**All five completed answers pass the unchanged original factual, completeness, citation and format criteria. All five also completed within 180 seconds.** They were collected under the new prospectively declared 300-second cap, once each, in order 02→05→06→11→12. These are known DEV observations, not fresh validation.

[Safe observations](observations.json) preserve exact validated finals, actual fed source order and allowlisted metadata. [Manual review](manual.json) gives the independent claim-by-claim assessment without replacing historical results.

| Case        | Strict result |  App time | Native time | Observed within 180 s |
| ----------- | ------------- | --------: | ----------: | --------------------- |
| reasoning02 | Pass          | 147.962 s |   137.218 s | Yes                   |
| reasoning05 | Pass          | 146.454 s |   128.966 s | Yes                   |
| reasoning06 | Pass          | 173.770 s |   155.857 s | Yes                   |
| reasoning11 | Pass          | 143.979 s |   126.350 s | Yes                   |
| reasoning12 | Pass          | 143.307 s |   126.323 s | Yes                   |

Requested **5**, attempted **5**, validated finals **5**, strict passes **5**, parser rejections **0**, timeouts **0**, unobserved **0**. There were no retries or evaluation-side repairs.

## Original-criteria review

**02 — partial amendment:** Actual base 3:3 provides the unchanged **5-saw** limit; approved amendment 4:4 changes only drills to **4**, effective before the asked 2031-06-01. The final gives both current limits with both local canonical references. This original question asks for the limits and evidence, not a separate authority explanation; the additional explanation requirement from AB02's distinct sealed key is not imported here.

**05 — later proposal:** Actual 9:9 supports the current **72 EUR** annual contribution. Actual 10:10 explicitly supports proposed **81 EUR**, the absence of an assembly vote and no change to the current order. The final states the values, decision and explicit source-stated reason correctly, with both references attached to the same coherent paragraph. Non-voting is stated in the source, not inferred from silence.

**06 — observations over time:** Actual 11:11 and 12:12 give **12 replacement sensors at 08:00 UTC** and **17 at 18:00 UTC**, on the same date and in the same cabinet, before and after daily movements. The final correctly says the observations do not contradict and supplies the requested counts and times, plus the supported date. Both local references support the whole paragraph. It invents no different location or measurement type. The question does not additionally demand the full before/after explanation.

**11 — supported rate:** Run A in actual supplied table **13:15** has **18 litres over 3 minutes**, so **6 litres per minute** is correct. The final cites the value-bearing table, not merely the header. The original question does not require displaying the calculation, and no extra measurement is invented.

**12 — missing electrical input:** Actual table **13:15** explicitly says it contains no electrical measurements; run B lists **24 litres** and **4 minutes**. Both chunks of the actual record, including header 13:14, were supplied. The final correctly says this record provides no electrically measured power and distinguishes its water/time entries. The local table reference supports all claims; no wattage or unsupported conversion is supplied. This is a claim about the supplied record, not a universal absence elsewhere.

Every question and original criterion was preserved. All required passages were actually fed, and all added claims were checked against them. No pass relies only on a keyword, source-ID membership or successful parsing.

## Runtime and limits

All calls observed v19 `answered`, active bounded 128 on the main route, compact JSON, q8_0 KV, 8192 context, 14 GPU layers, maxTokens 2176, temperature 0 and repeat penalty disabled. There was no unsupported-wrapper, setup-failed or grammar-fallback status. All completed envelopes had check/result keys and externalLineBreaks=0. Check codepoint lengths were **120/113/120/115/120**; private contents were not inspected.

In case order, exact prompt counts were **1983/1617/1999/2037/2010**, with prefill one token shorter over **8/7/8/9/8** batches. Thought/forced-closing counts were 128/2 each; constrained-response counts **129/130/172/109/111**, combined **259/260/302/239/241**. Those response counts include private check and JSON syntax, not only displayed prose. All fixed source-label shape counts were zero and uncapped; one ordinary block per case was inspected. Observer work was **1/0/0/0/0 ms**.

All **18 original documents** were eligible for every query. Actual configuration was `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, `CONTINUE_ERRORS=0`; these are explicit evaluation settings, not all production defaults. No gold source filter, adaptive reordering, artificial warmup or output repair was used. The timer is calibration-only and changes no production answer deadline.

App elapsed time includes retrieval/preparation and handoff; native timing is a subset. Reasoning06 had the smallest observed margin below 180 seconds, **6.230 seconds**. This is an observed margin, not a latency guarantee. Group/request-position and adaptive allocation differences remain confounds for cross-run performance claims.

At this group boundary, current AR evidence comprises these five, the [AB three](../bugfix-20261006-ar-completion300-ab/REVIEW.md), [original pair](../bugfix-20261006-ar-completion300-original/REVIEW.md), and [isolated09](../bugfix-20261006-ar-reasoning09-completion300/REVIEW.md): **11 strict completed answers, of which 10 were within 180 seconds**. Isolated09 remains 184.894 seconds. The two transfer cases are not credited before their own collection/review. The failed [AQ180 aggregate](../bugfix-20261006-aq-known-summary/REVIEW.md) and [AQ completion300 rejection](../bugfix-20261006-aq-reasoning09-completion300/REVIEW.md) remain unchanged; no historical failure has been overwritten.

## Provenance and cleanup

Declaration frozen **2026-10-06T05:34:00.151Z**; collection **05:34:21.135Z–05:47:52.452Z**; postverification **05:48:27.921Z**. All **421 source / 112 compiled** pins plus model, fixtures and harness matched, with `currentSourcesMatchBuild=true`, `changedPaths=[]`, runner exit 0, `cleanupVerified=true` and `requestCompleted=true`. Observer disposed with zero errors, dropped records and pending replies. No owned native/Playwright processes or capture artifacts remained; trace/screenshot/video were off.

`safeToContinue=false` preserves the review boundary; transfer requires a new explicit grant after review. No fresh facts were authored or authorized by this group.

- Frozen AR build: `c238f16db7574e4638d435a4d7191d47abba20c5670fd54bb1de29f2c255b0ea`.
- Declaration: `out/optimization-20261005/ar-completion300-reasoning-execution-declaration.json`, SHA256 `5df24c431f52575f3450573bdee20cbe2686bec3a838313169161f2d048b191d`.
- Postverification: `out/optimization-20261005/ar-completion300-reasoning-postverify.json`, SHA256 `ff4a9952230404f290589314ad6dd44c603b60a372a34baaff12d4227f4c864c`.
- Local [raw observations](raw.json), SHA256 `b93d0a448dee676d998e1b6459f0bf655ddc9b86c0bb0ab77767e91510fc7720`.

Raw/log/declaration files are local generated artifacts; tracked review/manual/observations preserve safe evidence. No hidden thought, private check, raw generated envelope or rejected content was read. Reporting changed no production, harness, fixtures or grading criteria and made no model calls.

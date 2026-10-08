# AR sealed fresh validation: eight-case result

**Strict result: 5/8.** Cases 03, 04, 05, 06 and 08 pass the unchanged original factual, completeness, citation and format criteria. Case 01 is a narrow format/brevity partial; 02 is a `source_duplicate` parser nonpass with no gradeable final; 07 falsely refuses an answerable snapshot comparison.

All eight were attempted exactly once. Seven validated answers completed within the prospective 300-second cap; five completed cleanly within 180 seconds. Only **three cases pass both strict correctness and within 180 performance** (05, 06, 08). Cases 03 and 04 are correct but slower than 180. Case 02's 159.837-second error is not a clean timing pass. Timeouts 0, unobserved 0, retries 0.

[Safe observations](observations.json) retain all seven exact finals, fixed rejection status, actual source identities/order and allowlisted runtime metadata. [Manual review](manual.json) preserves the original-criteria findings. [Initial run](../bugfix-20261006-ar-fresh-validation/REVIEW.md) and [continuation](../bugfix-20261006-ar-fresh-validation-continuation01/REVIEW.md) retain their separate denominators and immutable artifacts.

| Case | Strict result  |  App time | Native time | Clean within 180 |
| ---- | -------------- | --------: | ----------: | ---------------- |
| 01   | Format partial | 138.972 s |   128.214 s | Yes              |
| 02   | Parser nonpass | 159.837 s |   142.555 s | No               |
| 03   | Pass           | 211.129 s |   200.482 s | No               |
| 04   | Pass           | 192.697 s |   175.191 s | No               |
| 05   | Pass           | 173.760 s |   156.156 s | Yes              |
| 06   | Pass           | 179.632 s |   161.665 s | Yes              |
| 07   | False refusal  | 164.056 s |   143.047 s | Yes              |
| 08   | Pass           | 161.966 s |   142.731 s | Yes              |

The failures remain specific:

- **01:** Both 1180/1260-pixel alternatives, their local source references and evidence-scoped lack of established priority are correct. The 61-word outer frame contains four full quoted sentence units, exceeding the requested short-sentence presentation. This is a format partial, not a factual/citation failure or a new fixed word-count rule.
- **02:** The one required passage was supplied, but parsing rejected with the fixed `source_duplicate` detail. No final answer exists; its intended facts, exact repeated syntax and semantics are unknown.
- **07:** Both exact excerpts and citations correctly report 23 vouchers at 07:40 UTC before activity and 9 at 16:10 after activity in the same cabinet. The lead nevertheless says no definite answer can be derived and records `unresolved`. The original question requests the compatible relationship and reason; accurate quotation does not resolve that false refusal.

The successful cases preserve the requested distinctions: 03 applies an approved partial change while retaining the base period and explicitly rejects the unapproved proposal; 04 separates approval from future effectiveness; 05 subtracts planned versus actual same-scope tree counts with both inputs; 06 normalizes both dry masses with matching scope; 08 identifies the missing width without inventing an area. Every extra clause is supported by its attached actual supplied sources. Full case-specific reasoning is in the manual review; no key requirement was relaxed.

All twenty sealed documents were eligible. Evaluation used `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, `CONTINUE_ERRORS=0`, one attempt and a prospective 300-second app cap. These are explicit evaluation settings, not all production defaults. Within 180 is a separate clean-completion measure; an errored request below 180 does not pass it. Native time excludes some app work, so it is not substituted for app elapsed.

All required passages were actually fed. Their captured source hashes and complete chunk text match the sealed original documents. Per-query source order, final references and scalar runtime evidence are preserved in [observations.json](observations.json). All attempted calls observed v19/check+result, bounded 128/main, compact JSON and zero external structural line breaks, with Q8 KV, 8K context, 14 GPU layers and 2176 total output allowance; no fallback. Hidden thought/private check text, raw generation envelopes and rejected prose were neither read nor retained in these reports.

Both collection closures matched their frozen 421 source/112 compiled pins plus model/data/harness pins, with no changed paths, clean observer disposal, no pending replies/errors and no owned processes or captures. These are historical closure facts: production sources changed after collection, and this report makes no claim that the current workspace still equals AR. Original fixture/key/seal bytes remain unchanged.

The accepted candidate/model/harness/protocol freeze preceded authorship: freeze **2026-10-06T06:23:52.683Z**, authorship **2026-10-06T06:28:26.020920+00:00**, original seal **2026-10-06T06:34:23.605794+00:00**. The corpus has 20 documents, 6462 UTF-8 bytes (304–363/document), 8 questions (179–204 codepoints), 4 DE/4 EN and 4 genuine distractors. Preseal static admission retained all 20 complete chunks for every question at 8K/2176, max prompt estimate 3597; that check did not force runtime retrieval. Five integrity tests, full TypeScript, scoped lint and format passed before collection. No model trials or output-based regeneration occurred.

Collection stopped after 02's error. Following verified cleanup and a separate root grant, only 03–08 continued with unchanged source/key/question/model/build/settings; 01/02 were never re-asked. The new process gives 03 first-query handoff timing, so this is not an uninterrupted eight-case run or a controlled latency comparison. Original denominator 8 and failure 02 remain intact.

Root and production contributors were blinded to the new facts/key/output contents until all eight attempts closed. Root and an independent production-side reviewer recorded verdicts before the author read final outputs. The internal author knew prior DEV work and contributed evaluation infrastructure; this is **not an independent researcher-blind benchmark**. The prior 13/13 known correctness result did not establish general reliability. All AQ failures and previous protocol/report bytes remain preserved.

- Frozen AR build: `c238f16db7574e4638d435a4d7191d47abba20c5670fd54bb1de29f2c255b0ea`.
- Pre-authorship freeze SHA 256: `e6fec777d7cfe7aed3f7e6e6da761b417ffe0a3397c6179399c55c2585e85512`.
- Original [seal](../../ar-fresh-validation-20261006.seal.json): `41bf31d79018deb712434e0d8c7535991cab305de7a98732a9d32bdc201dec18`.
- Original [grading key](../../ar-fresh-validation-20261006.grading.json): `e8c3a1cfdd83b04cf63c96602f303711d1b621efc648a2146b577b6095752d7a`.
- Unchanged [prospective protocol](../../ar-fresh-validation-20261006.protocol.json): `76456106b149f79160098079f162bac0974ffb8afe99ea4dfbad58536349c4ff`.
- Combined closure: `out/optimization-20261005/ar-fresh-validation-collection-closure.json`, SHA 256 `9b92e5c3ebdca50329ae2705e8c84acf1c8c4b5c2a75f5c99a6f5ef72caf81f1`.

No fixture/key edits, production changes, model calls or discarded-content inspection were made for reporting. Safe public artifacts use repository-relative paths and contain no personal profile/model paths. Raw logs and execution declarations remain local ignored artifacts.

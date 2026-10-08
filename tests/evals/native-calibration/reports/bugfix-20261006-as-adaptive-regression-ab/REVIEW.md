# AS adaptive AB group: strict 2/3

**AB02 and AB03 pass; AB01 does not.** AB01 gives both correct intervals and local citations but asserts that both conflicting intervals apply, without establishing a governing choice from the supplied evidence. This is a semantic applicability defect, not a parser rejection or invented single winner.

Requested 3, attempted 3, validated finals 3, strict passes 2, semantic nonpasses 1, parser nonpasses 0, timeouts 0, unobserved 0, retries 0. All three completed within the prospective 300-second app cap and passed adaptive runtime verification. Two completed within 180 seconds; only **one, AB03, passes both strict correctness and within 180**. AB02 took 180.305 seconds.

[Safe observations](observations.json) preserve the exact final answers and actual fed source order. [Manual review](manual.json) records unchanged-key judgments for every visible clause.

| Case | Strict result         |  App time | Native time | Actual KV | Clean within 180 |
| ---- | --------------------- | --------: | ----------: | --------- | ---------------- |
| 01   | Applicability nonpass | 141.428 s |   130.787 s | F16       | Yes              |
| 02   | Pass                  | 180.305 s |   162.312 s | F16       | No               |
| 03   | Pass                  | 155.420 s |   138.206 s | Q8        | Yes              |

AB01's complete final is:

> Laut den Notizen Nord (14 Tage) und Süd (19 Tage) gelten beide Intervalle, wobei die Südnotiz keine Vorrangbestätigung enthält. [doc:1, chunk:1] [doc:2, chunk:2]

The original question asks which binding interval applies and requires both reported intervals in one short sentence. The original key requires that the supplied notes do not establish a binding winner. The two values, their North/South mapping, missing South priority confirmation, local references and short-sentence form are correct. However, **“gelten beide Intervalle”** asserts joint applicability of incompatible same-scope intervals; neither note supports that conclusion. The subordinate missing-priority clause does not clearly resolve that unsupported applicability claim. This is more than a readability concern, while remaining distinct from choosing a single winner or inventing approval/supersession. The source texts and key are unchanged; no discarded content was inspected.

AB02 correctly gives five projectors and seven tablets, retains the base tablet limit after the approved partial amendment, and explicitly explains that the later paper does not change limits because the facilities council has not approved it. Its added April 2 circulation date is correct. All actual 3:3/4:4/5:5 sources locally support the paragraph. The strict key's original nonapproval-reason requirement is satisfied. The 305 ms excess over 180 remains a separate timing nonpass.

AB03 correctly gives 2375 CHF for planned 2037 receipts minus recorded 2036 receipts, with both actual input sources 6:6/7:7 locally attached and one short sentence. The calculation is 29835 minus 27460; reserve and Annex figures are excluded. The original question does not require displaying both numerical inputs, so their omission from the sentence is not a new completeness failure.

All eight original documents were eligible, and every required passage was actually fed. Source hashes match the sealed original fixtures. Each captured chunk differs only by the parser's blank line after its heading; every original body line is unchanged. Settings were `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, `CONTINUE_ERRORS=0`, one attempt and a 300-second app cap. These are explicit evaluation overrides, not all production defaults. App and native durations remain distinct; no answer repair, re-ask or key relaxation occurred.

Actual allocation was F16 for AB01/02 and Q8 for AB03, each with 8192 context, 14 of 33 GPU layers and Vulkan. Observed defaults were six threads and 1 GiB reserve. All calls observed v20/check+result, bounded 128/main, allowance 2176, compact JSON with zero external line breaks, and no fallback. These satisfy this group's prospective adaptive contract. The old AS exact-Q8 gate remains failed; it is not retroactively reclassified. Precision, process and order differences prevent causal latency or quality claims.

Declaration frozen **2026-10-06T08:20:31.226Z**. At closure, all source/compiled/data/model/harness pins matched, `changedPaths=[]`, `cleanupVerified=true`, `captureVerified=true`, `requestCompleted=true`, `treatmentVerified=true` and `workerDefaultsVerified=true`. Observer disposal had zero errors/pending replies, with no owned processes or captures. `safeToContinue=false` is preserved. The original pair remains unattempted and held; this report authorizes no follow-on execution.

- Frozen AS build: `98ed3e0ec91bb9d5a8a05eff13c943fd6d2eea03334d6d8992bb66fed6c99075`.
- Declaration: `out/optimization-20261005/as-adaptive-regression-ab-execution-declaration.json`, SHA256 `1ac2cd4f4d5264a959ef87285f4a3fd57842979351faf19b2e06ae52db9da7b9`.
- Postverification: `out/optimization-20261005/as-adaptive-regression-ab-postverify.json`, SHA256 `c37b64030423c13b4cf4e6742bb3919602f69f3d4c44504775fde5d6aff2efed`.
- Local ignored [raw observations](raw.json), SHA256 `94f2ab8975d74e10a7cd136427f57129a6a354ecd7dcae16f01a42fc082216c5`.
- [AS remaining five](../bugfix-20261006-as-adaptive-regression-remaining/REVIEW.md): strict 5/5 under adaptive allocation.
- [Historical AS gate](../bugfix-20261006-as-regression-gate/REVIEW.md): content 3/3 with exact-Q8 runtime failure.
- [Original AR fresh summary](../bugfix-20261006-ar-fresh-validation-summary/REVIEW.md): unchanged strict 5/8.

AS known content coverage now has 13 requested, 11 attempted, 10 strict passes, one semantic nonpass and two unobserved original cases. Seven of the 11 completed within 180; six both pass strict criteria and finish within 180. These content totals span the historical exact-Q8 gate and two prospective adaptive groups, not one uniform-runtime experiment. All AS cases are known DEV; no fresh-generalization claim follows. Historical AR/AQ failures and original keys/seals remain unchanged. Safe artifacts contain no hidden thoughts/check text, raw envelopes, rejected prose, unrestricted logs or personal paths. Reporting made no model call or production/harness change.

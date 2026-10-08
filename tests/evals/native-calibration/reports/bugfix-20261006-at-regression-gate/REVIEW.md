# AT first known gate: semantic precision partial

**AB01 is a strict partial/nonpass.** Both reported values, their mapping and canonical citations are correct, and the final is one short sentence. The answer removes AS's unsupported claim that both intervals apply, but now says no binding value exists, which is stronger than the supplied notes failing to establish which alternative governs. Internal unit-style labels also appear in the final.

Requested 1, attempted 1, validated final 1, strict passes 0, semantic partials 1, parser nonpasses 0, timeouts 0, retries 0. The request completed cleanly in **148.934 seconds** (native 137.976 seconds), within both the prospective 300-second cap and the separate 180-second threshold. Runtime compliance passed independently of answer quality. All twelve later declared cases remain unattempted.

[Safe observations](observations.json) preserve the exact final, supplied source order and allowlisted scalar metadata. [Manual review](manual.json) records the original-key finding.

The complete final is:

> Laut den Notizen Nord (14 Tage, U7) und Süd (19 Tage, U3) gibt es keinen verbindlichen Wert, da keine Priorität festgelegt ist (U4, U8). [doc:1, chunk:1] [doc:2, chunk:2]

The original question asks which binding maintenance interval applies and explicitly requests both reported intervals in one short sentence. The original key requires the evidence boundary: the supplied notes do not establish a binding winner, and missing documentary approval/priority must not become a claim that no binding interval exists.

Actual North 1:1 gives 14 days and lacks an approval signature or priority statement; actual South 2:2 gives 19 days with the corresponding documentary limitations. Both passages were supplied. Their local canonical references correctly support the values and mappings. Neither passage establishes the broader conclusion **“gibt es keinen verbindlichen Wert.”** The introductory “Laut den Notizen” names the evidence, but it does not make the notes state that no binding value exists instead of leaving its determination unresolved. This narrow overclaim is separate from inventing a single winner, replacement, chronology or joint applicability.

The visible U7/U3/U4/U8 labels are a separate presentation/output-contract defect. They are internal unit-style metadata, not ordinary source prose; the correct canonical document references remain present. Their exact selection role or any private model reasoning is not inferred from their appearance. The one-short-sentence requirement itself is met; no new word threshold or key condition is introduced.

All eight original documents were eligible. Every required passage was actually fed, with source hashes matching sealed originals and only the parser's added blank line after headings; all original body lines are unchanged. No output, question, fixture or key was repaired. Settings retained `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, `CONTINUE_ERRORS=0`, one attempt and 300-second app cap. These are disclosed evaluation overrides, not all production defaults.

The call observed v21/check+result, ordinary answered mode with a concise catalog of 31 units, active bounded 128/main, effective allowance 2176, compact JSON with zero external structural line breaks and no fallback. Actual allocation was Q8/8192/14 on Vulkan, with six threads and 1 GiB reserve. Counts were 128 thought tokens, two forced closing tokens and 126 constrained envelope tokens (256 combined). Counts do not expose hidden text or equate envelope length with final-answer length.

Declaration frozen **2026-10-06T08:43:56.162Z**. Source/compiled/model/input pins matched at closure, `changedPaths=[]`, `cleanupVerified=true`, `captureVerified=true`, `requestCompleted=true`, `treatmentVerified=true`, `workerDefaultsVerified=true`. Observer disposal had no errors or pending replies; no owned native/Playwright processes or captures remained. `safeToContinue=false` is preserved. These historical closure facts do not imply semantic success or current workspace equivalence.

- Frozen AT build: `993093c6c089de9e79c5f259a1c8018fc058fe1a9e812fd08098306736c101ec`.
- Declaration: `out/optimization-20261005/at-regression-gate-execution-declaration.json`, SHA256 `e24025df1da94f7fa9e2fc3c50ed7222ca8b6312c18e7b25107834247fd5e1ff`.
- Postverification: `out/optimization-20261005/at-regression-gate-postverify.json`, SHA256 `e91460e65e5b134ed5cbe3106f10f9c19dc6a4565e2bf7cd7a8626d5d4272f45`.
- Local ignored [raw observations](raw.json), SHA256 `7dc6356efe6f8b9c5b6b7e063cf010b1d95b545acbc8b047d403243ede6c510a`.
- [Historical AS AB nonpass](../bugfix-20261006-as-adaptive-regression-ab/REVIEW.md) and [AS13 aggregate](../bugfix-20261006-as-known-summary/REVIEW.md) remain unchanged.
- [Original AR fresh5/8](../bugfix-20261006-ar-fresh-validation-summary/REVIEW.md) remains unchanged.

This is one known DEV observation, not fresh validation or a causal proof of the prompt change. No later cases or retries are authorized by this report. Historical failures, original criteria and seals remain intact. Reporting used no hidden thought/check text, raw envelope, rejected prose, unrestricted logs or personal paths and made no model call or production/harness edit.

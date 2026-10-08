# AS known regression gate: content passes, runtime protocol does not

**All three validated answers pass the original semantic, citation and format criteria. The exact-runtime gate remains failed:** case 07 used F16 KV instead of the declared Q8 requirement. `treatmentVerified=false` is preserved; clean provenance and successful answers do not normalize that discrepancy.

Requested 3, attempted 3, validated finals 3, strict content passes 3, parser nonpasses 0, timeouts 0, unobserved 0, retries 0. All completed within the prospective 300-second app cap; two completed within 180. These are new-candidate **known DEV** observations of original AR failures, not new fresh results or a revision of AR's strict 5/8.

[Manual review](manual.json) records unchanged-criteria judgments; [safe observations](observations.json) retain exact displayed finals, actual source order/references, runtime and fixed metadata.

| Case | Content/citation/format |  App time | Native time | Actual KV | Required runtime met | Clean within 180 |
| ---- | ----------------------- | --------: | ----------: | --------- | -------------------- | ---------------- |
| 01   | Pass                    | 181.940 s |   170.837 s | Q8        | Yes                  | No               |
| 02   | Pass                    | 172.323 s |   153.919 s | Q8        | Yes                  | Yes              |
| 07   | Pass                    | 127.055 s |   109.237 s | F16       | **No**               | Yes              |

**01:** Both 1180/1260-pixel alternatives and Copper/Silver mapping are correct. The final states that neither note establishes priority and gives the source-stated missing signature/priority evidence, without claiming approval never occurred or choosing a winner. One 34-word sentence excluding citation markers satisfies the original brevity requirement; this is descriptive counting, not a new threshold. Both 1:1/2:2 references attach the coherent answer. Minor German agreement wording does not change the meaning.

**02:** The single actual passage 3:3 supports Cedar 610 Hz and Birch 650 Hz for the same OC-9/L3/21C/date. The 28-word sentence gives both and explicitly says the record establishes no priority, with the correct local reference. “Entries apply to” identifies the shared test scope; the contrastive clause does not select a governing tone. No new signature/correction recital is required by the original question. This success is an observation in the new candidate; the exact discarded AR duplicate or causal effect of the duplicate-handling change is not established by it.

**07:** The compatible lead is correct, and both complete exact excerpts preserve same cabinet T5/date, 23 vouchers at 07:40 UTC before distribution, and 9 at 16:10 UTC after distribution/returns. The displayed evidence supplies the requested explanation, with 15:15/14:14 correctly adjacent; there is no unrelated location or invented transaction count. The question has no short-sentence limit. **The content pass is separate from the F16 runtime violation.** Precision and allocation differences prevent attributing quality or latency changes solely to the prompt/helper changes.

All 20 original documents were eligible. Every required passage was actually fed and matches the sealed original text. Settings were `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, `CONTINUE_ERRORS=0`, one attempt and 300-second app cap. These are explicit evaluation overrides, not all production defaults. No repair, re-ask, source filtering or grading relaxation occurred. Within 180 uses total app elapsed, not native elapsed after subtracting retrieval or handoff.

All three calls observed v20/check+result, active bounded 128/main, compact JSON with zero external structural line breaks, 8192 context, 14 GPU layers and 2176 total output allowance, with no fallback. Only 01/02 match required Q8; 07 records `f16`. Modes were answered, answered and comparison/compatible. All native generations stopped normally. Token counts include the private check and JSON structure, not only displayed prose; hidden thought/check text and raw envelopes were not inspected.

Declaration frozen **2026-10-06T07:27:36.844Z**. Source/compiled pins matched at the recorded closure, `changedPaths=[]`, `cleanupVerified=true`, `requestCompleted=true`, capture verified, observer disposed with zero errors/pending replies, and no owned native/Playwright processes or captures remained. `safeToContinue=false` and `treatmentVerified=false` remain unchanged. These are closure-time claims, not a claim about current workspace source equality.

- Frozen AS build: `98ed3e0ec91bb9d5a8a05eff13c943fd6d2eea03334d6d8992bb66fed6c99075`.
- Declaration: `out/optimization-20261005/as-regression-gate-execution-declaration.json`, SHA 256 `6572d3c86b312aa3fc67dfd69724293d20dd5386fc6078e645fcf6cac0eb54c6`.
- Postverification: `out/optimization-20261005/as-regression-gate-postverify.json`, SHA 256 `9593330dcbe907f722fc41d6c9379fbb618d9a9aa24625991c524342d5eca78c`.
- Local [raw observations](raw.json), SHA 256 `c3a67751bdc287ed9c9e40455589ac9a7de6d7d5d19edc0a5b848f9777fbdb46`.
- Unchanged original [AR fresh summary](../bugfix-20261006-ar-fresh-validation-summary/REVIEW.md), strict 5/8.

Later groups remain held for a separate root decision. Original fixture/key/seal and AR/AQ histories are preserved. Safe tracked artifacts contain no hidden thoughts, private check, rejected prose, raw envelope, profile paths or unrestricted logs. Reporting made no model call or production/harness/fixture change.

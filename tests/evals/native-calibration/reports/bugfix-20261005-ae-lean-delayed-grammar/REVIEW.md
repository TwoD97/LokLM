# AE lean-contract diagnostic: one of four strict passes

**The 64-token arm passed 1 of 2 cases; the zero-token arm passed 0 of 2.** All four predeclared native calls completed once within the 180-second generation deadline, without retry. One completed response failed the final parser and produced no validated answer. The process returned exit 1 for that failure, completed cleanup and released the GPU. This is a direct replay of two already-revealed development cases, not an application regression pass, production change or unseen validation.

[Tracked final observations](observations.json) preserve every validated answer, source identities and safe counters. [Manual judgments](manual.json) retain separate factual, completeness and citation dimensions. No rejected prose, private check, thought text/token array, chat history or raw model envelope was retained or inspected.

| Arm    | Case        | Strict result                                          | Native seconds | Exact prompt tokens | Thought / constrained response tokens |
| ------ | ----------- | ------------------------------------------------------ | -------------: | ------------------: | ------------------------------------: |
| Lean64 | ab-fresh-01 | Pass: both values, exact sources, safe uncertainty     |        113.044 |                1517 |                              64 / 147 |
| Lean64 | ab-fresh-02 | Nonpass: parser rejection `answer`, no validated final |        121.161 |                1365 |                              64 / 178 |
| Lean0  | ab-fresh-01 | Nonpass: North value/citation omitted                  |         93.903 |                1519 |                               0 / 168 |
| Lean0  | ab-fresh-02 | Nonpass: correct facts, proposal citation omitted      |        100.498 |                1367 |                               0 / 193 |

## Final-answer review

**Lean64, case01 passes.** The answer gives South's 19 days and North's 14 days for the same NP-6 filters/campaign S8, each through the exact original sentence and its own correct 2:2 or 1:1 reference. The fixed lead says the supplied excerpts do not establish a definitive answer. It does not choose a governing winner, assert nonapproval, invent chronology or claim that no interval exists. The compact framed sentence satisfies the requested short form under the same criteria used for the prior original-case gate; retained English source wording is a presentation tradeoff. There is no irrelevant heading/date appendix.

**Lean64, case02 has no assessable final answer.** Native decoding ended normally, but the unchanged frozen production parser returned the broad `answer` rejection category. That is an operational nonpass, not an inferred authority or citation verdict. The retained metadata does not reveal the specific failed condition. All three required passages were supplied; no hidden contents were inspected and no repair or second attempt was made.

**Lean0, case01 remains incomplete.** Four authentic South units include the heading, issue date, 19-day value and documentary-priority qualifier. North's 14-day alternative and citation are entirely absent, although the complete North note was supplied second. The safe unresolved lead and literal quotations do not satisfy the explicit request for both intervals. The additional heading/date material also works against the requested brief format.

**Lean0, case02 gets the facts right but misses required attribution.** It states current 5 projectors and 7 tablets and correctly rejects the unapproved 9-tablet proposal. Both answer blocks cite only base 3:3 and amendment 4:4. The claim that the later paper proposes 9 and was not approved by the facilities council comes from proposal 5:5, which is supplied but never cited. Correct values and valid other references do not support those proposal clauses. The repeated explanation does not repair the missing source.

## Frozen treatment and limits

The four-cell order was fixed before execution: case01/64, case02/64, case01/0, case02/0. Each paired input has identical original question, all eight actual AC-fed passages and their order, reconstructed user prompt, lean system contract, v11 schema and final parser. Pair equality was checked before execution and again during reporting. The concise 31-unit catalog is used for case01; case02 uses full mode. No gold subset, source reorder, schema relaxation or citation retargeting occurred.

The lean system contract replaces the longer AC/AD2 system instructions. This jointly changes instruction length, routing emphasis and the check objective; it is not an isolated token-length treatment. Reconstructed token estimates decrease from 2561 to 1631 for case01 and 2897 to 1571 for case02. These estimates differ from the actual public-wrapper prompt counts in the table. Source/user-prompt/schema bytes remain unchanged.

Lean64 uses public Qwen3.5 `thoughts:auto`, at most 64 ungrammared thought tokens, then a fresh grammar on the same sequence. Both calls reached that budget and used a two-token forced closer. Lean0 uses `thoughts:discourage` and grammar before the first sampled token; it has no ungrammared phase or forced closer. Both use the same Q4_K_M model bytes, Q8 KV, 8192 context, 14 GPU layers, 6 threads, batch 254, 1 GiB VRAM reserve, temperature 0, repeat penalty disabled and 2176 total generated tokens. Each cell resets the session/sequence. There is no second full prefill within a call.

The deadline includes native prefill and decoding, but excludes per-cell reset, grammar compilation and tokenization setup. The additional 15-second bound is abort acknowledgement grace, not accepted generation time. `visibleTokens` in the retained telemetry means constrained structured-response tokens, including the private check field; it does **not** measure final displayed-answer tokens. The first/last visible timestamps are grammar-phase callbacks, not UI streaming or exact prefill measurements.

[AD2](../bugfix-20261005-ad-delayed-grammar/REVIEW.md) had 0/2 strict passes on these same known cases with the longer system contract and 64-token thought budget. AE64 improves the comparison selection in this observation but also loses a validated answer on the authority case. AE0 retains a missing-value failure and the proposal-citation omission. The fixed 64-before-0 order, two cases, one call per cell and separate AD2 collection do not establish a causal latency benefit or general quality improvement. Neither arm meets a complete acceptance criterion; no production promotion follows from this diagnostic.

## Provenance and preserved artifacts

Collection ran from 2026-10-05T23:53:24.535Z to 2026-10-06T00:00:52.367Z. All four requested cells were observed, fingerprints matched after cleanup, and the owned process exited. The frozen input plan is `out/optimization-20261005/ae-diagnostic-inputs.json`, SHA-256 `aca66bd57f583ed86ecc48dda42087e485926b885bce8385d6238d241d959dc7`. The lean-contract module SHA-256 is `c1b2f48c89faf5ec09eac4b2f78377ab1fb7e04baf1c29a809d6ea4ce0df3735`. The separate execution declaration is `out/optimization-20261005/ae-execution-declaration.json`; it records 18 no-model tests and four-cell validation before the root's execution grant.

The local original result is `out/optimization-20261005/ae-lean-delayed-grammar-native-20261005-2353/raw.json`, SHA-256 `43a4eb354f0aae2560dc65e3800f32991c4dd0f7efd1ecdcdee3c77c55ffa2b5`. It is an ignored generated artifact; this review, manual judgments and the bounded [observations](observations.json) are intended for version control. Runner SHA-256: `654035252b21c97d9a732bfa73ee4a7092e05186677b7dcd2258787b49b17ea5`; sequence-helper SHA-256: `1a9597137e19f78e8ec857674cf5278a6b7b36c32aefd90047d8d464aadd60ec`. Frozen AC build manifest: `a153fccc912c4ce974aa80d588a04cd3c8359c29940098418d1b44b51fd11af3`.

The [original AC first-observation failures](../bugfix-20261005-ac-fresh-validation/REVIEW.md), [sealed key](../../ab-fresh-validation-20261006.grading.json), original source/seal bytes and [initial AD setup failure plus AD2](../bugfix-20261005-ad-delayed-grammar/REVIEW.md) remain unchanged. These cases became known DEV after AC's full collection; AE must not be described as fresh or blind evaluation.

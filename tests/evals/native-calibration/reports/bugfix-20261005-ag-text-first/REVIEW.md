# AG text-before-sources diagnostic: one known-case pass

**The single requested case passed strict final-answer review.** It correctly gives 5 projectors and 7 tablets, rejects the unapproved 9-tablet proposal, and cites all three required passages. Native generation took **177.330 seconds**, only **2.670 seconds below the 180-second diagnostic limit**. This is one known development case, not production promotion, an application latency result or evidence of general reliability.

[Tracked final observations](observations.json) preserve the exact validated answer and safe metadata. [Manual review](manual.json) records the factual, completeness, authority and local-citation assessment. No private check, thought text/token array, chat history, discarded prose or raw model response envelope was inspected or retained.

| Requested cell        | Strict result | Native seconds | Native stop           | Final output              |
| --------------------- | ------------- | -------------: | --------------------- | ------------------------- |
| ab-fresh-02/thought64 | Pass          |        177.330 | stopGenerationTrigger | Validated ordinary answer |

## Independent final-answer assessment

The supplied base 3:3 establishes 7 tablets and continued validity until an approved amendment changes a provision. Amendment 4:4 is approved and effective before the asked 2038-04-08 date, raises only the projector limit to 5 and explicitly retains all other provisions. Proposal 5:5 suggests 9 tablets but explicitly lacks approval and authority to change the limits. The final answer correctly composes current 5/7 and explains why the proposed 9 does not displace 7. Its three canonical references attach the same coherent answer record, including the proposal/nonapproval clauses that were left uncited in prior observations.

There is no invented current value, approval event, chronology, changed scope or extra condition. Both requested quantities and the later paper's effect are answered. The question does not require a single sentence, so the two-sentence answer is complete without adding a new format criterion. All eight original AC-fed passages and their order were retained; the required three were actually supplied, not selected through a gold-source subset.

## Frozen treatment

AG uses an out-only, mechanically checked copy of the production comparison module. Ordinary records generate `text` before `sources`, with matching property/required order, strict first-key validation, lean-system example/reminder and generated footer clause. Comparison branches are unchanged. Source membership, duplicate rejection, Markdown protections, bounds, fixed rejection callbacks and rendering remain the original shared implementations. `typed-comparison-v11` identifies the base contract, not a production release of this experimental order.

The original question, source text, source order, IDs, units, arithmetic catalogs and decoding helper are unchanged. The matching order instructions are part of the treatment, so this is not a schema-order-only intervention. No citation substitution, answer repair, fallback, repeated model attempt or renderer relaxation was used. The preparation review records 26 no-model prototype tests, the unchanged 18 decoder tests and one-cell validation before the native grant.

The field-order hypothesis is that selecting citations after writing the prose may help bind sources to all claims already expressed. This observation is compatible with that hypothesis but does not establish it: the model can still invent a claim and attach a plausible, non-supporting source afterward. Valid source membership is not semantic entailment or authority proof. The successful result also does not reveal the exact source label or discarded content rejected in [AF](../bugfix-20261005-af-rejection-detail/REVIEW.md); those remain unknown.

AG runs first and alone in a fresh context, like AF. AE's case02 ran second after `clearHistory` in the same model/context. One observation per treatment, the context-order difference from AE and the longer generated response preclude a causal performance claim. [AE's four outcomes](../bugfix-20261005-ae-lean-delayed-grammar/REVIEW.md), AF's rejection and the [original AC failures](../bugfix-20261005-ac-fresh-validation/REVIEW.md) remain preserved.

## Timing and execution limits

Runtime stayed Qwen3.5-4B Q4_K_M, public `thoughts:auto`, Q8 KV, 8192 context, 14 GPU layers, 6 threads, batch 254, 1 GiB VRAM reserve, temperature 0, repeat penalty disabled and 2176 total generated tokens. The call reached its 64-token thought budget, used a two-token forced closer, then generated 296 constrained-response tokens: 362 combined tokens. The native output meter reports 360 sampled tokens; the two forced closer tokens explain the difference. The exact prompt length was 1377, with 1378 input tokens recorded by the meter. The constrained response was 613 characters.

`visibleTokens` in telemetry means the structured constrained response, including the private check field, rather than final displayed-answer tokens. The first grammar-phase callback was at 40.676 seconds; this is neither UI streaming time nor an exact prefill measure. The 180-second bound includes native prefill and both decoding phases but excludes reset/grammar/tokenization setup and app retrieval. The additional 15 seconds is abort acknowledgement grace, not accepted generation time. The small 2.670-second margin is a material operational limitation even though this call completed successfully.

## Provenance

The execution declaration froze at 2026-10-06T00:25:04.175Z. Collection ran from 00:25:21.762Z to 00:28:38.492Z, exited successfully, completed cleanup and released the GPU. Fingerprints were unchanged after the run. Reporting verified all eight files pinned by the declaration and exact original question/evidence/ID-order parity with AE.

- Input plan: `out/optimization-20261005/ag-diagnostic-inputs.json`, SHA-256 `1cb42eabccbaeec71501da91d102241e9bebc3ed349e180f0ed6521ea2f14820`.
- Execution declaration: `out/optimization-20261005/ag-execution-declaration.json`, SHA-256 `0003bc28e70e3c441578175331f295c67cb38ea42e780177395eb4152e644c54`.
- Preparation review: `out/optimization-20261005/ag-text-first-review.md`, SHA-256 `3bcda35118a58c6c4788fe523bbd984d39494aa45dde89267437c24791251329`.
- Runner SHA-256: `75464ea0e5aa32704c979b534351638cc4966bad4aa8b2122c35ede9ea8cfcb2`; unchanged AE decoder SHA-256: `1a9597137e19f78e8ec857674cf5278a6b7b36c32aefd90047d8d464aadd60ec`.
- Base instrumentation build manifest SHA-256: `1a10b34abc5e3c1f9ad44bfc5a280d97bca500b71a4c565c2f3d99378fe60089`. The experimental module is separately pinned; the compiled app was not changed to use it.

The original local result is `out/optimization-20261005/ag-text-first-native-20261006-0025/raw.json`, SHA-256 `c1092c4be665bfd3c9c2e9d7b8e749dec0503ee613ab81996ba75406bd0da0da`. It is an ignored generated artifact; this review, manual judgment and allowlisted observations preserve the validated result in version control. Sealed inputs, criteria and earlier observations were not changed. No new fresh corpus or production edits were made for this report.

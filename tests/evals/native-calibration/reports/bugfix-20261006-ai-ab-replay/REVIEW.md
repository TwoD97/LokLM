# AI known AB app replay: one pass, one timeout, one unobserved

**The three-case group stopped after two attempts: AB01 passed strict review, AB02 timed out, and AB03 was never attempted.** Only one complete answer exists. This is neither a completed three-case evaluation nor a 2/3 result. The original requested denominator and run boundary are preserved; no question was retried or repaired.

[Tracked observations](observations.json) preserve the final answer, fixed interruption notice, actual fed source order and safe runtime evidence. [Manual judgments](manual.json) contain the two observed cases only. AB03 is explicitly unobserved in the observation artifact and table below.

| Requested order | Case        | Result                          | App seconds | Native seconds | Usable final |
| --------------- | ----------- | ------------------------------- | ----------: | -------------: | ------------ |
| 1               | ab-fresh-01 | Strict pass                     |     126.420 |        115.686 | Yes          |
| 2               | ab-fresh-02 | Operational timeout / cancelled |     180.364 |        163.185 | No           |
| 3               | ab-fresh-03 | Unobserved after stop           |           — |              — | No attempt   |

## Independent original-criteria review

**AB01 passes.** Both exact supplied North 1:1 and South 2:2 notes concern the same NP-6/S8 scope. The compact framed final answer gives South 19 days and North 14 days through their original sentences, each with its own correct canonical reference. The lead limits uncertainty to what the supplied excerpts establish. It does not choose a governing winner, invent approval/supersession/chronology or claim that no interval exists anywhere. Both requested values, attribution and the short-sentence format are satisfied. The original English quotation remains a presentation tradeoff under the unchanged criteria; there is no unrelated heading/date appendix.

**AB02 has no assessable semantic answer.** The UI received only `_[Answer interrupted.]_` after the 180-second app deadline. The invocation settled, with one cancelled terminal and no mismatch, but no checked result or usable final answer was produced. All three required base/amendment/proposal passages were actually supplied among eight. This is an operational nonpass; it is not evidence of a wrong current value, correct authority inference, malformed schema or missing citation. No discarded model content was inspected.

**AB03 remains unobserved.** Its original question and arithmetic criteria were unchanged, but the timeout policy ended the group before it began. Do not infer an outcome from AC's earlier arithmetic pass or other diagnostics. The remaining groups in the prepared 13-case replay were not executed by this run.

## Actual app treatment and timeout evidence

The original AB questions were run once in the declared 01→02→03 order, using the full eight-document corpus, actual app retrieval and default whole-document expansion. The fixed established harness disables reranking, multi-query and routing. There was no oracle source filtering, source/order repair or edited reference answer. Both attempted cases received all eight passages. The failed authority case's required sources were first in its supplied order: base 3:3, proposal 5:5 and amendment 4:4.

Both calls actually logged typed-comparison-v12, active bounded reasoning with a 64-token maximum, main route, 8K context, q8_0 KV, 14 GPU layers, temperature 0, repeat penalty disabled and maxTokens 2176. Neither unsupported-wrapper nor setup-failed status was observed. AB01 used the 31-unit concise catalog and completed comparison/unresolved mode. AB02 entered full mode and has no final branch/result.

For AB01, the adapter prefills 1531 of 1532 prompt tokens, then records 64 thought tokens, 2 forced-closing tokens and 146 constrained-response tokens, 212 combined. For AB02, it prefills 1376 of 1377 prompt tokens, then records 64 thought tokens, 2 forced-closing tokens and 271 constrained-response tokens before cancellation, 337 combined. These are content-free counters. The latter proves internal generation progress, not a partial user answer or semantic result. On cancellation, outer returned-text fields remain unset even though nested adapter counters record earlier internal progress.

The app's 180-second request deadline includes retrieval and preparation as well as generation; native 163.185 seconds is only the generation portion for AB02. Its total 180.364 seconds includes cancellation/terminal delivery. This must not be compared as the same deadline boundary as [AG's 177.330-second direct native call](../bugfix-20261005-ag-text-first/REVIEW.md), whose setup and app retrieval were excluded. Likewise, internal `visibleTokens` includes the structured envelope/private check and does not count final displayed prose. No thought or check text/token arrays were retained or read.

`CONTINUE_ERRORS=1` permits only a settled, unambiguous ordinary error to be left behind. It does **not** continue a timeout, cancellation failure, ambiguous terminal or unsettled invocation. AB02's `collectionDecision` was `stop`, so the harness exited 1 and left AB03 unattempted. A future separately declared unattempted continuation, if authorized, cannot erase this timeout or complete this original run retroactively.

## Provenance, cleanup and limitations

The declaration froze at 2026-10-06T01:12:22.137Z; collection started at 01:12:43.558Z. Postverification completed at 01:19:33.893Z, confirming all 418 source and 112 compiled pins, model bytes and fixtures unchanged. The observer was disposed with zero errors, dropped rows or pending replies; no owned Electron/native runner process remained. The original build manifest is `13db13c556454b10ae7efa086656b72c22661524983ee292f6621a495e7d8793`. The declared build had 3626 passing unit tests plus typecheck/lint success; those checks are separate from this incomplete native quality collection.

- Execution declaration: `out/optimization-20261005/ai-ab-replay-execution-declaration.json`, SHA-256 `0a8e687ee3d1b4ba8bf227eafcf36ba3bc69476ea66e0a8b8b57635b6ad8f65b`.
- Postverification: `out/optimization-20261005/ai-ab-replay-postverify.json`, SHA-256 `56cf3495b324ca1fc46412cfebb6328930e51877aaf91a05400d4c5ea0834a3f`.
- Original local [raw observations](raw.json), SHA-256 `392b0e86f64670494e551e0f55f9b42852f5de88648d0f9302e0f4335d91e80a`. Raw/log files are generated local artifacts; the review, manual judgments and allowlisted observations preserve the report in version control.

This historical run accidentally used Playwright's default failure trace/screenshot capture. After closure, the owner added explicit capture-off settings and removed only its ignored owned trace, screenshot and error-context artifacts, preserving actual observations/logs. The record is `out/optimization-20261005/ai-capture-correction.json`. This report did not inspect those debug artifacts. That later test-only correction must not be attributed to the original frozen harness or used to relabel its provenance.

All AB cases are now known DEV. The [original AC first-observation failures](../bugfix-20261005-ac-fresh-validation/REVIEW.md), [AG](../bugfix-20261005-ag-text-first/REVIEW.md) and [AH](../bugfix-20261005-ah-text-first-controls/REVIEW.md) remain unchanged. AB01 is a useful observed app regression pass; the authority case still lacks a completed answer under the declared app deadline. This run does not demonstrate a general repair or complete the planned 13-case coverage. No fresh set was authored or evaluated.

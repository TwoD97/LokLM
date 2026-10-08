# AH text-first controls: one of three strict passes

**AH passed 1 of 3 requested controls.** Both zero-thought cases failed strict completeness or attribution review; the 64-token comparison case passed. All three native calls completed once, parsed successfully and reached a normal grammar stop without cancellation. Exit and cleanup were successful, hashes remained unchanged and the GPU was released. This is known development evidence using the frozen out-only AG prototype, not a fresh test or production promotion.

[Tracked observations](observations.json) preserve all three final answers, actual input source order and safe counters. [Manual judgments](manual.json) distinguish literal fidelity and factual correctness from complete requested answers and supported citations. No private check, thought text/token array, rejected prose, history or raw model envelope was read or retained.

| Fixed order | Case / thought budget | Strict result                                         | Native seconds | Constrained response tokens |
| ----------- | --------------------- | ----------------------------------------------------- | -------------: | --------------------------: |
| 1           | ab-fresh-01 / 0       | Nonpass: North 14 and its source omitted              |         98.357 |                         164 |
| 2           | ab-fresh-02 / 0       | Nonpass: correct facts, amendment citation omitted    |        111.135 |                         218 |
| 3           | ab-fresh-01 / 64      | Pass: both intervals, local sources, safe uncertainty |        120.994 |                         151 |

## Independent final-answer review

**Zero-thought case01 is incomplete.** The answer selects four authentic South units: heading, issue date, 19-day interval and absent documentary precedence. North's 14-day value and 1:1 citation are missing despite the complete North note being supplied. The fixed evidence-scoped unresolved lead is safe, but the question explicitly requests both intervals in a short answer. Extra heading/date material adds unnecessary display length. The visible answer equals the prior AE0 result; this is not a new successful comparison.

**Zero-thought case02 has a citation gap.** Its current 5 projectors/7 tablets and proposed 9 with explicit nonapproval/no effect are all factually correct. The final paragraph cites only base 3:3 and proposal 5:5. The base says 2 projectors, and the tablet proposal does not establish a projector limit; current 5 is supported by approved/effective amendment 4:4, which was supplied but never cited. The other valid references do not repair that missing support. This differs from AE0's omission of proposal 5:5: both are attribution failures, with different missing sources.

**The 64-token case01 passes.** The two selected original sentences give South 19 days and North 14 days for the same NP-6/S8 scope, each with its own exact 2:2/1:1 reference. The lead says only that the supplied excerpts do not establish a definitive answer. It invents no winner, nonapproval event, replacement, chronology or global absence of a binding interval. The compact framed sentence meets the requested format under the existing criteria. Its visible answer equals AE64's successful comparison answer; original English source wording remains a presentation tradeoff.

## Relation to AG and execution limits

The separately collected [AG64 case02](../bugfix-20261005-ag-text-first/REVIEW.md) passed current 5/7, proposal status and all three required citations. Together with AH64 case01, the two distinct known cases have **2/2 observed strict passes under the 64-token text-first prototype**. Those observations span separate declared runs following earlier failures. They are not a fresh two-case holdout, a complete app benchmark or evidence of general correctness. AG also took 177.330 seconds, leaving only 2.670 seconds under its native limit. AH alone remains 1/3, and its zero-token controls remain 0/2.

AH retains the exact AG ordinary `text`-before-`sources` schema/parser ordering and matching lean reminders, with unchanged comparison branches and source validation/rendering. The original questions, all eight actual AC-fed passages and their order, source IDs and arithmetic/unit catalogs remain intact. No gold-source subset, source repair, fallback or retry was used. Membership and structurally attached citations are not entailment proof, as the zero-thought citation gap demonstrates.

The fixed order was zero-thought 01, zero-thought 02, then 64-token 01 in one loaded model/context, clearing history between cells. Zero-thought uses the public discourage prefix and grammar from the first sample. The 64-token arm uses public auto, an ungrammared budget then fresh grammar on the same sequence; it reached 64 and required a two-token forced closer. Configuration remains Qwen3.5-4B Q4_K_M, 8K Q8 context, 14 GPU layers, 6 threads, batch 254, 1 GiB reserve, temperature 0, repeat penalty disabled and 2176 total tokens.

The 180-second deadline includes native prefill and decoding, excluding reset/grammar/tokenization setup and app retrieval. The additional 15 seconds is cancellation acknowledgement grace. Telemetry `visibleTokens` counts the constrained structured envelope, including private check, not final displayed prose. Callback timestamps are not UI latency or exact prefill. Fixed order, separate runs, one observation per cell and differing output lengths prevent causal latency or reasoning-benefit claims.

## Provenance

The declaration froze at 2026-10-06T00:30:54.217Z. Collection ran from 00:31:18.320Z to 00:37:08.339Z and observed all three requested cells. Reporting verified original question/evidence/source-order equality and all nine declaration file hashes. No source, sealed criterion or earlier report judgment was changed.

- Input plan: `out/optimization-20261005/ah-diagnostic-inputs.json`, SHA-256 `cc8243eb022f8a583872dcbab224f5ff7e364b1ac334ca274785d98bb6d464b4`.
- Execution declaration: `out/optimization-20261005/ah-execution-declaration.json`, SHA-256 `07675ebf411e020c6e7db704ceb55b0961592dc4c5614b33b409bf769b5ff593`.
- Runner SHA-256: `6375e32b24692898aa01916010a5cfa60addf34cf6a8cfa03654179fd3379ac7`; unchanged AE decoder SHA-256: `1a9597137e19f78e8ec857674cf5278a6b7b36c32aefd90047d8d464aadd60ec`.
- Base instrumentation build manifest SHA-256: `1a10b34abc5e3c1f9ad44bfc5a280d97bca500b71a4c565c2f3d99378fe60089`. The experimental prototype is separately pinned and was not enabled in this compiled app.

The original local result is `out/optimization-20261005/ah-text-first-native-20261006-0031/raw.json`, SHA-256 `16441d20169b21a7feb89e5c7fe48d29c765690b0291e00a4666679a757b27ed`. It is ignored generated output; this review, manual grades and bounded observations preserve the final evidence in version control. [AE](../bugfix-20261005-ae-lean-delayed-grammar/REVIEW.md), [AF](../bugfix-20261005-af-rejection-detail/REVIEW.md) and [AC's original first-observation failures](../bugfix-20261005-ac-fresh-validation/REVIEW.md) remain unchanged. No new fresh dataset was created.

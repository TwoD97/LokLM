# H: typed comparison, known twelve-case regression

All 12 requested cases completed once. Independent manual review gives **6 strict passes and 6 partial answers**: 3/7 answerable questions and 3/5 uncertainty questions fully satisfied their requirements. Correct excerpt membership did not ensure a complete answer. H is not a demonstrated general reliability improvement or a fresh evaluation.

This reruns the already observed G challenge with all 18 source documents through actual import, retrieval and answer generation. No gold-source filtering, retry or failed-result replacement was used. The author of this corpus also participated in candidate design; it was never an independently authored blind holdout. Its earlier presealed/previously-unrun status applies only to the [original G run](../bugfix-20261005-g-reasoning-reserved/REVIEW.md).

## Frozen treatment

- Production schema: `typed-comparison-v2`; one checked raw generation per question, temperature 0, repetition penalty disabled, actual context 8192 and output budget 2176.
- Ordinary `answered` output remains available. `comparison` selects source-present quotations and a model-selected compatible/established/unresolved/insufficient outcome. The parser proves source membership, not semantic relevance, scope, authority or completeness.
- Normal small-document expansion is enabled (`wholeDocFallback:true`). G's twelve-case run explicitly disabled it; its [separate expansion control](../bugfix-20261005-g-default-expansion-control/REVIEW.md) had already recovered the omitted table. This is a grouped candidate/configuration comparison, not an isolated prompt or parser experiment.
- Full corpus; rerank, multi-query and routing disabled as in the fixed calibration configuration. Query cache enabled; no alias/footer/evidence-assessor experiment.
- Native per-question deadline 180 seconds; one repetition; no Playwright retry. All 12 had one completed terminal, no timeout, no schema fallback and no malformed content-free diagnostic.
- Source freeze: `out/optimization-20261005/h-production-freeze.json`, 2026-10-05T13:35:24.565Z. Build manifest SHA-256 `ee5d5065f3eca7aa599dfbba34a3efd6731c09085a58c7b50a366be6e62871f1`; worker SHA-256 `8f3527f6b3707783d90a6a27e7f80948e713410b9774036a9de96d94541fe85c`. Provenance matched current sources at both checks, and compiled files remained unchanged.
- Actual hardware/model: Vulkan GTX 1050 Ti 4 GB; Qwen3.5 4B Q4_K_M, partially offloaded 14 layers, 8192-token f16 context for every observation. GPU embedding and exclusive residency remain active; reranker unloaded.

## Manual results

| Case | Mode/outcome              | Strict result | Material observation                                                                                                                                                         |
| ---- | ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01   | comparison / unresolved   | Pass          | Both deadlines and exact approval/replacement qualifications; no invented categorical non-replacement. Four quotation blocks are verbose for “briefly.”                      |
| 02   | comparison / established  | Partial       | Correct original/amended limits, but “Ab diesem Tag” loses its effective-date antecedent and no explicit applicable 4-drill/5-saw answer is synthesized.                     |
| 03   | comparison / compatible   | Partial       | Correct 2750 L and 2.75 m³ quotations; missing requested normalization into litres. Volume was outside the frozen helper's supported dimensions.                             |
| 04   | comparison / unresolved   | Partial       | Correct durations and no-priority qualifications, but only 150 s is normalized; missing 2,25 min = 135 s. Comma decimals were deliberately unsupported by the frozen helper. |
| 05   | answered                  | Pass          | Current 72 EUR, proposed 81 EUR, no vote and explicit non-revocation; correct local sources.                                                                                 |
| 06   | comparison / compatible   | Pass          | Correct 12 at 08:00 and 17 at 18:00; no invented same-time explanation.                                                                                                      |
| 07   | answered                  | Partial       | Correct 24 L and approval date with table/header sources, but fabricated visible `@119:128` and `@0:10` locators.                                                            |
| 08   | comparison / unresolved   | Partial       | Correct deployment uncertainty; requested function results 6 and 7 omitted entirely. Nonliteral-call question wording was outside the code helper.                           |
| 09   | comparison / established  | Partial       | Exact 31/34 inputs only; missing requested total 65 and disjoint-cohort explanation.                                                                                         |
| 10   | comparison / insufficient | Pass          | Exact flow rate and explicit missing duration/total; no invented volume or whole-document claim.                                                                             |
| 11   | answered                  | Pass          | 18 L / 3 min = 6 L/min, complete and locally attributed to the table.                                                                                                        |
| 12   | comparison / insufficient | Pass          | Exact table statement that electrical measurements are absent; no incorrect claim that the record omits A/B distinction.                                                     |

For case 07, the table's `24 Liter` is at 108:116, whereas the emitted 119:128 points to `4 Minuten`; the header phrase is at 76:101, whereas 0:10 points to `# Ivaren L`. These unsupported locators were left visible and retained in the strict partial assessment.

The two `established` results suppress useful synthesis. Other comparison outcomes also lose requested derivations when helper coverage is absent. A safe outcome label plus valid quotes cannot be scored as a complete answer. Conversely, ordinary answers in 05 and 11 demonstrate that a general sum/ratio interpreter is not necessary to preserve useful prose.

## Timing and artifacts

The native run lasted from 2026-10-05T13:35:30.966Z to 14:02:13.081Z. Startup was 42.477 seconds and indexing 10.194 seconds. End-to-end question latency had an even-count median of **122.9835 seconds**, range **97.503–173.295 seconds**. These are small, unreplicated observations with adaptive resource management, not a causal performance estimate.

Checked output is delivered near completion. Case 11 had authoritative terminal text but no token event; token-based first-visible time is therefore absent for that case and must not be inferred from its completion time.

[manual.json](manual.json) contains the tracked per-case judgments, independently cross-reviewed. `raw.json` and `review.json` are local generated artifacts, not tracked release evidence. Raw SHA-256: `632033c7bb52916e84b3c78e87ed92f767973b77bc7019a488ac7170d88355e6`. The mechanical report is auxiliary: escaped Markdown dates and the [sealed reference-format defects](../../reasoning-reserved-20261005.README.md) can affect regex checks without constituting factual errors. Source excerpts, exact passage IDs and the actual requested answer were manually assessed.

The separately predeclared literal-code control is recorded in [its own report](../bugfix-20261005-h-known-literal-code/REVIEW.md). It is not part of this twelve-case denominator.

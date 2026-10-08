# X: original regression

**The three exact original regressions produced one strict pass, one material false refusal and one format/relevance partial.** All completed once without transport failure. The original user-reported conflict is safer, but the full original task is not fixed. [manual.json](manual.json) records factual, authority, citation, completeness and requested-format judgments separately.

- **02 passes:** 156 planned inspections in 2025, one short English sentence, correctly citing the actual table 2:5 rather than its approval header.
- **06 fails:** both supplied revenue tables determine 78,165 − 73,410 = 4,755 GBP, but the model selects `comparison/insufficient` and refuses. It displays those very tables with correct references instead of performing the requested subtraction. This is a false refusal and completeness/routing regression, not retrieval loss. The long display also violates the requested one short sentence.
- **10 is partial:** both ISO deadlines and the actual draft qualifications are preserved in exact 3:6 / 4:7 excerpts. The source-scoped unresolved lead invents neither a winner nor an external approval/replacement event. However, it violates the requested one short sentence with long source blocks and adds irrelevant 23-day-to-seconds conversions. Authority and citation safety do not erase the format/relevance failure.

| Case       | Manual verdict | Total seconds | Actual KV | Input / output tokens | Mode                    |
| ---------- | -------------- | ------------: | --------- | --------------------: | ----------------------- |
| heldout-02 | supported      |        84.306 | q8_0      |            2394 / 109 | answered                |
| heldout-06 | false-refusal  |       105.657 | q8_0      |            2602 / 131 | comparison/insufficient |
| heldout-10 | partial        |       105.144 | q8_0      |            2589 / 133 | comparison/unresolved   |

These are reused known development questions, including the exact Orvo question from [the October 1 report](../optimization-20261001-heldout-regression/REVIEW.md). All six original documents and the original questions, languages and requested formats remain unchanged. Earlier observations remain preserved; these results are not a fresh accuracy estimate. Default whole-document expansion here differs from some historical configurations, so this is a grouped current-candidate regression test rather than an isolated causal comparison.

The complete corpus remained eligible, with default whole-document expansion, the unchanged X production build, 180-second per-question limit, one attempt, no hidden retry and synthetic observer enabled. No gold-source filtering, output repair or source rewriting was applied. Actual native allocations are reported per question; automatic KV allocation can vary, so cross-candidate times do not isolate a prompt or schema effect.

The source-ID contract constructs canonical references and full comparison passages mechanically, but does not verify the selected source relevance or inferred relationship. Case 06 demonstrates that correct source selection can coexist with an incorrect refusal. The fixed full-passage display cannot satisfy case 10's requested concise output in this observation; that is an actual task defect, not merely a general preference for shorter prose.

The owned process 53745 exited successfully and the GPU was released. Fresh validation was not launched; its grading/source contents remain unopened by this executing agent. The subsequent Y proposal is a separate candidate requiring a new freeze and explicit native authorization. No X output or source was repaired or retried.

The local synthetic observer retained bounded structural metadata only, without private check text, raw response envelopes or hidden segments. Local generated [metrics.json](metrics.json) records actual allocations, content-free completion counters, source IDs and observer status. Internal callback timings are neither user-visible streaming nor exact prefill timings.

Startup: 42.444 seconds; indexing: 9.066 seconds; sampled peak GPU use: 3485 MiB. Build unchanged after completion: **true**; sources matched after completion: **true**. The owner separately confirms process exit before releasing the GPU or launching another group.

Manifest SHA-256: `282142934df7e53fdae60e193e841ff09e8f930d76b9a80f7057e5294480b716`; worker SHA-256: `1afc9f5617eda7029a56602786205c66d2eb5de79755d9b214e054c01d21e376`. Source freeze remains **2026-10-05T20:26:14.595Z**. The predeclared local record is `out/optimization-20261005/x-original-regression-declaration.json`.

Raw SHA-256: `8d266beb6f9e54463548eaae82e0d4e6cc54c2bcc0fdf54b397ffbf458fd2361`. `raw.json`, `review.json`, `metrics.json`, `app.log` and `retrieval.log` are local generated artifacts; this review and manual judgments are tracked. These small synthetic observations do not establish general model reliability.

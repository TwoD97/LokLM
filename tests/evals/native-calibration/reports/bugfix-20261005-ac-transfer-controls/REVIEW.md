# AC transfer-controls: 2 strict passes from 2 requested cases

This is a fixed known-development collection, not fresh validation. Requested: **2**; observed: **2**; strict passes: **2**; timed out: **0**. Unobserved requested cases: none. No case was retried. [Manual judgments](manual.json) retain all-claims, completeness, authority, citation and format review against the actual supplied passages; organizer_store independently checked the completed observations.

| Case                  | Manual verdict | Total seconds | Actual KV | Input / output tokens | Output mode           |
| --------------------- | -------------- | ------------: | --------- | --------------------: | --------------------- |
| authority-transfer-01 | supported      |       131.539 | q8_0      |            2452 / 207 | answered              |
| authority-transfer-04 | supported      |       105.832 | q8_0      |            2674 / 129 | comparison/unresolved |

Every source document in the declared corpus remained eligible. Default whole-document expansion was enabled, with 180 seconds per question, one attempt, zero retries and the bounded synthetic observer. No gold-source filtering, post-generation citation retargeting or answer repair was applied. Actual supplied citation events, rather than only retrieval ranks, are retained in local metrics. Source/ID membership is not evidence of entailment by itself.

AC is a grouped treatment: field-by-field applicability guidance plus a bounded q8 attempt at the exact requested context before the original q4 fallback. The schema, catalog, rendering contract and inference settings remain unchanged. Each observed call's actual allocation, checked mode and native counters are recorded in [metrics](metrics.json). Timing comparisons with earlier candidates are descriptive and confounded by allocation, context/order and runtime state; this collection does not isolate either change's causal effect.

No private check text, hidden thought segments or raw response envelope was retained or read. Synthetic observer status and content-free native counters are reported; callback timing is not visible streaming or exact prefill time.

Startup 42.464 s; indexing 10.114 s; sampled peak GPU 3413 MiB. Final compiled tree unchanged: **true**; current sources match build: **true**.

Manifest SHA-256: `a153fccc912c4ce974aa80d588a04cd3c8359c29940098418d1b44b51fd11af3`. Compiled worker SHA-256: `6f2c6abf27484f50fe3afa1d6af5330f278cfe276b8a7420daf2ad4ef02ede5d`. Raw SHA-256: `77e320598a626b896640478afa17995740f28f407c4f5beb2ea0883203b8eaab`. The [raw](raw.json), [derived review](review.json), [metrics](metrics.json), app.log and retrieval.log are local generated artifacts; this review and manual judgments are tracked.

Earlier AB failures and all other candidate reports remain unchanged. The successful [AC02](../bugfix-20261005-ac-known-r02/REVIEW.md) and [exact original pair](../bugfix-20261005-ac-original-gate/REVIEW.md) are separate observations, not repeated members of this group. Later groups require their declared conditions and authorization; the new sealed set was unrun at this collection boundary. Its source/gold content was then withheld from production contributors; the evaluator authored it after AB freeze but before AC and is not an independent researcher-blind author.

Subsequent validation is preserved separately: [the sealed three-case collection](../bugfix-20261005-ac-fresh-validation/REVIEW.md) produced only **1/3 strict passes**, including one critical false current/base value. The known-case passes here do not establish general reliability.

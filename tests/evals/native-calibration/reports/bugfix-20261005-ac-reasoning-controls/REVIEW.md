# AC reasoning-controls: 5 strict passes from 5 requested cases

This is a fixed known-development collection, not fresh validation. Requested: **5**; observed: **5**; strict passes: **5**; timed out: **0**. Unobserved requested cases: none. No case was retried. [Manual judgments](manual.json) retain all-claims, completeness, authority, citation and format review against the actual supplied passages; organizer_store independently checked the completed observations.

| Case                  | Manual verdict | Total seconds | Actual KV | Input / output tokens | Output mode             |
| --------------------- | -------------- | ------------: | --------- | --------------------: | ----------------------- |
| reasoning-reserved-05 | supported      |       121.071 | q8_0      |            2324 / 189 | answered                |
| reasoning-reserved-06 | supported      |       103.264 | q8_0      |            2860 / 120 | comparison/compatible   |
| reasoning-reserved-09 | supported      |       145.023 | q8_0      |            2872 / 208 | answered                |
| reasoning-reserved-11 | supported      |       129.003 | q8_0      |            2898 / 174 | answered                |
| reasoning-reserved-12 | supported      |        93.140 | q8_0      |            2717 / 101 | comparison/insufficient |

Two presentation limitations remain visible: case09 uses an awkward German collocation despite explicitly correct exclusive populations and addition; case12 appends accurate but irrelevant water/time conversions. These are not claims of polished output. The unchanged mechanical checker misses case06 clock times because Markdown escapes its colons and requires manual abstention confirmation for case12. Those flags remain in the derived review; actual rendered facts and the explicit missing electrical data were independently verified.

Every source document in the declared corpus remained eligible. Default whole-document expansion was enabled, with 180 seconds per question, one attempt, zero retries and the bounded synthetic observer. No gold-source filtering, post-generation citation retargeting or answer repair was applied. Actual supplied citation events, rather than only retrieval ranks, are retained in local metrics. Source/ID membership is not evidence of entailment by itself.

AC is a grouped treatment: field-by-field applicability guidance plus a bounded q8 attempt at the exact requested context before the original q4 fallback. The schema, catalog, rendering contract and inference settings remain unchanged. Each observed call's actual allocation, checked mode and native counters are recorded in [metrics](metrics.json). Timing comparisons with earlier candidates are descriptive and confounded by allocation, context/order and runtime state; this collection does not isolate either change's causal effect.

No private check text, hidden thought segments or raw response envelope was retained or read. Synthetic observer status and content-free native counters are reported; callback timing is not visible streaming or exact prefill time.

Startup 42.392 s; indexing 10.345 s; sampled peak GPU 3428 MiB. Final compiled tree unchanged: **true**; current sources match build: **true**.

Manifest SHA-256: `a153fccc912c4ce974aa80d588a04cd3c8359c29940098418d1b44b51fd11af3`. Compiled worker SHA-256: `6f2c6abf27484f50fe3afa1d6af5330f278cfe276b8a7420daf2ad4ef02ede5d`. Raw SHA-256: `441dc4c6c3adbfe27eb69c3d3b94d07da21a64f3b004eb92eeb88753ccd9222f`. The [raw](raw.json), [derived review](review.json), [metrics](metrics.json), app.log and retrieval.log are local generated artifacts; this review and manual judgments are tracked.

Earlier AB failures and all other candidate reports remain unchanged. The successful [AC02](../bugfix-20261005-ac-known-r02/REVIEW.md) and [exact original pair](../bugfix-20261005-ac-original-gate/REVIEW.md) are separate observations, not repeated members of this group. All five controls passed independently, the owned process exited successfully, and frozen hashes were verified before the authorized transfer01/04 pair launched. Later groups require their declared conditions and authorization; the new sealed set was unrun at this collection boundary. Its source/gold content was then withheld from production contributors; the evaluator authored it after AB freeze but before AC and is not an independent researcher-blind author.

Subsequent validation is preserved separately: [the sealed three-case collection](../bugfix-20261005-ac-fresh-validation/REVIEW.md) produced only **1/3 strict passes**, including one critical false current/base value. The known-case passes here do not establish general reliability.

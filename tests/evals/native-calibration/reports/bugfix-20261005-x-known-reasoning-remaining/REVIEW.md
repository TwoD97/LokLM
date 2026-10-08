# X: all ten remaining known reasoning cases pass

**All ten requested questions completed once and passed independent factual, completeness and citation review.** Together with the separately observed [02/06 gate](../bugfix-20261005-x-known-r02-r06/REVIEW.md), this gives **12/12 strict passes on the reused known reasoning set**. These questions informed earlier development; this is regression evidence, not a fresh holdout or a general reliability estimate.

The review checked actual supplied passages, every requested value/date/unit or computation, source applicability, documentary uncertainty, local citation attachment and extra claims. The two directly reviewed gates were not repeated in this group.

| Case | Coverage                                | Total seconds | Actual KV | Input / output tokens | Mode                    |
| ---- | --------------------------------------- | ------------: | --------- | --------------------: | ----------------------- |
| 01   | Conflicting draft deadlines             |        86.379 | q8_0      |            2496 / 109 | comparison/unresolved   |
| 03   | Equivalent water volumes                |        95.934 | q8_0      |            2522 / 115 | comparison/compatible   |
| 04   | Conflicting measured durations          |       104.394 | q8_0      |            2733 / 125 | comparison/unresolved   |
| 05   | Current fee versus proposal             |       136.247 | q8_0      |            2172 / 208 | answered                |
| 07   | Table value and approval date           |        131.34 | q8_0      |            2748 / 185 | answered                |
| 08   | Code results and deployment uncertainty |        98.763 | q8_0      |            2340 / 125 | answered                |
| 09   | Sum of disjoint populations             |       147.574 | q8_0      |            2713 / 220 | answered                |
| 10   | Rate without duration or total          |        95.094 | q8_0      |            2497 / 115 | comparison/insufficient |
| 11   | Source-backed average rate              |       115.505 | q8_0      |            2739 / 153 | answered                |
| 12   | Missing electrical measurement          |        99.179 | q8_0      |            2565 / 104 | comparison/insufficient |

Notable outcomes:

- Conflicting deadlines and 135/150-second measurements remain unresolved with both alternatives and their authority qualifications preserved; neither acquires an invented winner.
- Equivalent volumes are normalized to 2750 L each. The current 72 EUR rule remains governing despite an 81 EUR unapproved proposal.
- The table value 24 L and ISO approval date have distinct correct source passages. Code outputs 6/7 and documentary deployment uncertainty attach to the same locally cited record.
- Disjoint populations 31/34 correctly total 65. Missing duration prevents an invented total volume; 18 L / 3 minutes supports 6 L/minute.
- Missing electrical evidence produces a source-scoped refusal. Its accurate automatic water/time conversion appendix is unnecessary display overhead, consistent with the prior S/I grading distinction. English original quotations inside a German response and long full-passage displays remain presentation tradeoffs.

All 18 corpus documents remained eligible with default expansion; actual supplied IDs and native metrics are in local [metrics.json](metrics.json). No reference-source selection, re-ask, answer repair, retry, timeout or generation error occurred. All calls stopped at stopGenerationTrigger. Actual allocations are reported per query rather than inferred from startup. Automatic profile selection was full with an actual 8K context; the fixed checked path uses its own explicit system. KV/allocation variability prevents a clean causal timing claim across candidates.

The ordinary schema and parser remain unchanged from W; X combines task-first routing with source-first comparison grammar, while retaining V's lexical retrieval correction. Valid references and copied original text do not mechanically prove semantic correctness. The independent manual judgments are what support these observed passes.

Median total latency was 101.7865 seconds, with range 86.379–147.574 seconds. Startup took 42.409 seconds, indexing 10.570 seconds and sampled peak GPU use was 3536 MiB. Internal text callback timings are not user-visible streaming or exact prefill measurements. The observer retained bounded fixed structural metadata only, with no errors/drops/pending requests. No private check, raw envelope or hidden segments were inspected or retained.

The owned process 29590 exited 0, compiled bytes remained unchanged and source correspondence matched after exit. The separately declared [four known authority-transfer cases](../bugfix-20261005-x-known-transfer/REVIEW.md) then started under the parent-authorized conditional grant. Fresh validation had not been launched or read by this executing agent at this group's close.

Declaration: local generated `out/optimization-20261005/x-known-remaining-declaration.json`, **2026-10-05T20:33:56.812Z**. Candidate freeze remains **2026-10-05T20:26:14.595Z**. Manifest SHA-256: `282142934df7e53fdae60e193e841ff09e8f930d76b9a80f7057e5294480b716`; worker SHA-256: `1afc9f5617eda7029a56602786205c66d2eb5de79755d9b214e054c01d21e376`.

[manual.json](manual.json) records all ten judgments. `raw.json`,`review.json`,`app.log`,`retrieval.log` and metrics JSON are local generated artifacts. Raw SHA-256: `29c33e8689931c5661729c7e83611861d406785a5b0eabc3944dc05384474eb8`. Earlier S/T/V/W failures and partials remain preserved in their original reports.

# G presealed reasoning challenge: 2026-10-05

All 12 requested cases completed once, without timeout, transport failure or grammar fallback. Strict manual review finds **6 passes, 4 partial answers and 2 substantive failures**: **3/7 answerable cases** and **3/5 uncertainty cases** are fully supported and complete. This does not demonstrate that all reasoning or citation errors are fixed.

## Provenance and evaluation limits

The 12 questions and 18 source documents were sealed before the diagnostic runs, then published byte for byte only after G's final freeze. They had not previously been run. However, their author also contributed to candidate design and evaluation. **This shared authorship creates contamination risk; this is not an independently authored blind holdout.** The root implementer and independent answer reviewer had not opened these facts or answers before freeze. It remains a small synthetic, source-disjoint challenge, not a general reliability benchmark.

The original seal SHA-256 is `0b828e0eb1427fc4e0f1abc63c9fb87b9d9399e7a29cba0f1695bc4280b0b6cd`. See [fixture provenance and known authoring defects](../../reasoning-reserved-20261005.README.md). Eight regex checks in six archived reference strings fail on joined-word formatting; the sealed bytes were not repaired, and references were not supplied to the model. Human grading used the actual source facts, question and visible answer. Mechanical flags alone did not determine semantic verdicts.

The application imported all 18 documents and retrieved its own context. No gold-source selection or retries were used. The fixed configuration disables reranking, multi-query, routing and **whole-document expansion**. In particular, `wholeDocFallback:false` suppresses the app's normal small-document sibling expansion. Cases 07 and 12 lost the Ivaren table under this setting; this is not yet evidence that default application retrieval loses it. A separate [07 expansion control](../bugfix-20261005-g-default-expansion-control/REVIEW.md) changes that setting only, without overwriting these results.

## Manual results

| Case | Strict verdict | Evidence-based finding                                                                                                                                                                   | Total time |
| ---- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 01   | Partial        | Correct unresolved deadline and both ISO dates at 1:1/2:2. “Neither replaces the other” still overstates absent replacement documentation.                                               | 93.578 s   |
| 02   | Partial        | Correct drill/saw limits 4/5, but cites amendment 4:4 for saw value 5, found only in supplied 3:3. Adds unsupported absence of any later change.                                         | 164.771 s  |
| 03   | Pass           | Correctly equates 2.75 cubic metres and 2750 litres, with both exact passages 5:5/6:6.                                                                                                   | 90.828 s   |
| 04   | Pass           | Correct 135 versus 150 seconds, exact 7:7/8:8 attribution and no documentary priority. All converted alternatives supplied.                                                              | 121.173 s  |
| 05   | Partial        | Current 72 EUR versus nonbinding 81 EUR proposal is correct. The opening authority/effect claim lacks local citation; supporting bullets incompletely attach that conclusion.            | 141.482 s  |
| 06   | Failure        | Correct counts/times and no-conflict outcome, but the explanation claims different quantities at the same times. Sources describe the same inventory at different times.                 | 124.174 s  |
| 07   | Failure        | Correct approval date at 13:14; requested 24 litres omitted because table 13:15 was not fed. Adds unrelated Leran duration material. Retrieval/packing failure under disabled expansion. | 150.546 s  |
| 08   | Pass           | Correct north/south code results 6/7 with 14:13/15:16 and deployment described as undocumented. All claims repeated with explicit citations.                                             | 117.987 s  |
| 09   | Pass           | Correct 31+34=65 with exact 16:17/17:18 inputs and genuinely disjoint serial ranges.                                                                                                     | 121.323 s  |
| 10   | Pass           | Correctly refuses to derive total volume from 8 litres/minute without duration, explicitly grounded in 18:19.                                                                            | 92.597 s   |
| 11   | Pass           | Correct 18/3=6 litres/minute, with exact table 13:15 rather than the approval header.                                                                                                    | 109.194 s  |
| 12   | Partial        | Correctly withholds electrical power, but generalizes header-only context to claim the record does not distinguish A/B. Omitted table 13:15 does distinguish them.                       | 99.971 s   |

The independent reviewer cross-checked all 12 cases. Citation membership, numeric correctness and main decision correctness were kept separate from all-claims support. A correct final decision does not excuse a false explanation, a wrong passage, or an overbroad statement about missing evidence. The 07 refusal is relative to the full indexed corpus; the model was not given its decisive table.

## Runtime and retained evidence

Every query executed `checked-answer-v1` with actual 8K context, a 2,176-token output budget, temperature 0 and `repeatPenalty:false`, one raw generation, and a completed checking stage. Actual runtime remained f16 KV with 14 chat GPU layers; the GPU embedder and chat were resident in turn, with reranking disabled. No extra verifier/model call was added per answer. The internal model-authored check is not an entailment proof and was not used as evidence for manual grading.

The conventional even-count median total latency is **119.580 s**, with observed range **90.828–164.771 s**. Startup took 42.520 s and indexing 10.525 s. Final text appears only after checked generation completes, so first visible text is near total latency. The bounded implementation is operational here, but this remains a significant wait on the tested 4GB GPU. No isolated causal speed claim follows from these runs.

Build-manifest SHA-256: `e13a1c6c31ea1cb7fc29999ffcfb223f6889827d1d46c746caac0ee929fed23c`. Worker SHA-256: `8f3527f6b3707783d90a6a27e7f80948e713410b9774036a9de96d94541fe85c`. Current production sources matched the build and recursive compiled fingerprints were unchanged after execution. Raw SHA-256: `0dfa7420d617418483a66c083cb6a854997ac10056efd1d71f827208db16acaa`.

[manual.json](manual.json) retains all judgments. [raw.json](raw.json) and [review.json](review.json) are local generated artifacts excluded from version control; original native observations were not rewritten. Freeze/publication records are under `out/optimization-20261005/`. Any later candidate using these observations must call them known development regressions, not fresh evaluation.

# Frozen E: reused original-heldout regression

All 12 requested questions completed. Independent assistant-agent review finds **8/9 supported answerable cases and 2/3 safe, complete factual abstentions**. There are two material failures: a correct count with the wrong exact source passage, and an invented authority decision. These results do not establish an overall quality or safety improvement. This corpus had already informed development; it is a reused regression, not a fresh reserved test.

| Case                     | Review                                   | Evidence                                                                                        |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 01 revenue               | Supported                                | 73,410 GBP; exact ledger table 1:2                                                              |
| 02 inspections           | **Incorrect attribution**                | Correct 156, but cited 2:4 only has approval; supplied 2:5 contains the count                   |
| 03 approval date         | Supported                                | Requested ISO 2025-02-06; exact 2:4                                                             |
| 04 sample mass           | Supported                                | Teral 31.6 kg; exact PDF 6:9                                                                    |
| 05 combined trays        | Supported                                | Clearly states 18+29=47; exact 6:9                                                              |
| 06 revenue comparison    | Supported                                | 78,165 minus 73,410 = 4,755 GBP; both exact inputs 2:5 and 1:2                                  |
| 07 batch identifier      | Supported                                | ORV-862; exact 3:6                                                                              |
| 08 positive code branch  | Supported                                | min(3×20,90)=60 seconds; exact 5:8                                                              |
| 09 missing CEO           | Safe abstention                          | Does not invent a person                                                                        |
| 10 conflicting deadlines | **Unsupported final authority**          | Picks May 15 and invents documentation rules under which B replaced A; only 4:7 cited           |
| 11 early return          | Supported                                | attempt≤0 returns 0 seconds; exact 5:8                                                          |
| 12 missing temperature   | Safe factual abstention; language defect | No outdoor measurements, exact 6:9; broken German/English phrasing outside the source quotation |

For 10, both draft passages were supplied. Draft A says 2027-05-08 and explicitly lacks approval/supersession. Draft B says 2027-05-15 and explicitly lacks approval or any replacement statement. Both have the same issue date. The answer's invented documentation-rule override is not supported anywhere in the supplied context. Mentioning both dates and using an existing marker do not make that conclusion grounded. A second independent assistant agent confirmed this failure and the code cases 08/11.

The most recent comparison is `optimization-20261001-heldout-regression`: it had 9/9 supported answerable cases and 2/3 safe abstentions, with correct citations for both02 and 06. E therefore has an observed exact-passage regression on 02 (9/9 to 8/9), while the critical authority failure and 2/3 safe-abstention count remain unchanged. These are individual observations under different builds and resource states, not a causal accuracy estimate.

The older `heldout-8k-final` had 8/9 answerable and 2/3 abstention successes because06 cited the wrong ledger passage and 10 invented authority. Only against that older observation do the aggregate counts match and 06's current correct citation look improved. The October 1 run had already corrected 06 and clearly worded05. All three runs remain intact and must not be conflated.

Case 12 is counted as safe factual abstention because the absence claim and quotation are correct. Its mixed-language clause is a visible output-quality defect, so these counts must not be described as complete language/format compliance.

Median total latency was 55.4465 seconds; median first-visible text 36.952 seconds. Startup was 45.702 seconds and indexing 10.115 seconds, outside those per-query totals. All snapshots record FULL, actual 8192 context and 14 GPU layers; E maps this hardware-limited FULL depth to standard. KV precision varies with resource availability. These latencies are descriptive observations, not an assessment-on/off A/B.

The raw report ended at 2026-10-02T10:59:38.947Z with 12 completed terminals and no question timeout, cancellation or error. The outer PowerShell wrapper exited 1 because its `ErrorActionPreference=Stop` treated a Node `NO_COLOR`/`FORCE_COLOR` stderr warning as terminating before the wrapper's final verification. The harness's after-run provenance was already recorded. This wrapper failure is retained as an operational caveat; no question was retried. The operator independently verified E's compiled and current source match before starting the separately frozen reserved run; the record is `out/optimization-20261002/final-e-original-postverify.json`.

Candidate E remains frozen, and neither this reused regression nor the reserved corpus may drive further production tuning under the reserved evaluation claim. `manual.json` and `review.json` preserve exact claims, citations and outcome dimensions; the original raw file is unchanged.

# October optimization: native DEV regression

All twelve development questions ran once on the compiled application with real local inference. This is a small, previously used synthetic regression set, not held-out evidence or a production accuracy estimate. No answer-driven prompt or retrieval tuning was applied during the run.

**All nine answerable cases have correct facts and exact supporting passage citations. Two of three missing-fact/conflict responses fully preserve safe uncertainty. The remaining missing-temperature response is partial because it adds an unsupported description of what the report says. This is not a perfect twelve-case result.**

| Case                   | Independent answer and passage review                                                                | Outcome         |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | --------------- |
| 01 revenue             | Correct EUR 48,260 for 2025; exact table 1:2.                                                        | Supported       |
| 02 inspections         | Correct 184, in German; exact table 1:2.                                                             | Supported       |
| 03 approval            | Requested ISO date 2026-03-09; exact approval 2:4.                                                   | Supported       |
| 04 PDF mass            | Correct Neral 18.4 kg and survey date; exact PDF table 6:9.                                          | Supported       |
| 05 PDF total           | Correct 27 + 35 = 62 accepted trays; exact PDF table 6:9.                                            | Supported       |
| 06 comparison          | Correct EUR 53,780 minus EUR 48,260 = EUR 5,520; both exact tables 1:2 and 2:5.                      | Supported       |
| 07 identifier          | Correct MSX-417, in German; exact draft A 3:6.                                                       | Supported       |
| 08 code upper bound    | Correct return value 4; complete supplied function 5:8.                                              | Supported       |
| 09 missing officer     | Says the supplied context does not identify the CFO; no person invented. No inline citation claimed. | Safe abstention |
| 10 conflict            | Both ISO dates and exact drafts 3:6/4:7; explicitly leaves definitive authority unresolved.          | Safe abstention |
| 11 code lower bound    | Correct return value 0, in German; complete function 5:8.                                            | Supported       |
| 12 missing temperature | No numeric temperature invented, but adds an unsupported stronger description of PDF 6:9.            | Partial         |

Case 12 says the report explicitly states that it does not measure outdoor temperatures. The source states only: “The report contains no outdoor temperature measurements.” Absence from a report does not establish that measurements were not taken. The safe first clause does not excuse the additional claim. This is the same strict distinction used in the previous footer experiment; it is not a wrong temperature value or an invented citation ID.

The revenue comparison's former wrong-passage attribution is absent in this observation. All requested numbers, units, dates, identifiers and code return values are correct. Responses use the requested language and one sentence, although cases 05 and 10 are wordier than necessary. Case 09's terminal source array is provided context; it must not be interpreted as inline citations that the answer did not make.

## Runtime and comparison limits

The run used the requested and actual 8,192-token context, with 14 of 33 chat layers on the GPU throughout. Startup chose q8_0 KV; all twelve answering allocations used q4_0. Canonical citations, default threads/reserve, query-vector caching and guarded GPU-layer reuse were enabled; reranking, query expansion, routing, whole-document fallback, aliases and source-marker footers were disabled. There were no repeats, inference timeouts or stream error events. The initial allocation missed the plan cache; all twelve post-retrieval reloads recorded validated cache hits with no allocation fallback in the retained log.

Conventional medians are **38.570 s to the first token event**, **38.8065 s to first visible text**, and **53.845 s to the terminal event**. Startup was 42.903 s and indexing 9.101 s. Sampled whole-card usage peaked at 3,484 MiB on the 4,096 MiB GPU, leaving a minimum observed 612 MiB; samples include desktop use and can miss brief peaks. Sampled free system RAM reached 2.865 GiB. This is partial GPU offload, not full model residency on the card.

For comparison, `dev-8k-final` had eight of nine fully supported answerable cases and three safe uncertainty responses. Its first-visible median was 37.8845 s and terminal-event median 56.4465 s. The present run improves the comparison citation but includes a new unsupported extra clause on the missing-temperature case. The timing differences do not isolate an optimization or establish a general speedup.

The DEV manifest and model hashes match that baseline. Four source files and their complete extracted chunk objects also match. The ledger and plan Markdown tables have since gained alignment whitespace and longer separator dashes: cell facts are unchanged, but source hashes and chunks 1:2/2:5 differ, with token estimates increasing from 101/109 to 133/140. Case order, application/dependencies and runtime memory state also differ. Thus this is a semantic regression comparison, not a byte-identical controlled treatment. The original frozen held-out hash lock is unaffected.

All eight compiled JavaScript artifacts under main/preload, including shared chunks and workers, matched their before-run fingerprints after cleanup. Source hashes and a tracked-diff hash identify the recorded inputs; concurrently edited source files do not change the executed build. `manual.json` records each independent verdict; `mechanical-review.json` contains mechanical checks and measured observations. The raw answers and supplied passages remain unchanged. Scanned documents, charts, large-library selectivity, long conversations and broad real-document accuracy remain untested by this sample.

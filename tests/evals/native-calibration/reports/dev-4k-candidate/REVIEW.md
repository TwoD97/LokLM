# 4K development candidate: independent review

**This candidate does not pass the no-new-grounding-regressions gate.** It fixes the baseline's incorrect code result, but introduces a wrong-source approval-date citation and an uncited identifier answer. The revenue comparison improves from an unrelated citation to one correct input citation, while still omitting the second input's source.

The first pass contains 12 distinct questions: six of nine answerable cases have correct answers with complete supporting citations; three missing/conflicting-fact cases safely abstain. The baseline had seven of nine completely grounded answerable cases and the same three safe abstentions. These are small synthetic counts, not general accuracy estimates. All nine candidate answerable results are semantically correct, but that does not repair their citation failures.

| Case                          | Baseline                           | Candidate first pass                                                                                    |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 01 revenue                    | Supported                          | Supported; relevant passage now ranks first.                                                            |
| 02 inspections                | Supported                          | Supported; decisive English passage still ranks seventh.                                                |
| 03 approval date              | Supported, correct ISO date/source | **Wrong source** 4:7 instead of supplied 2:4; semantic date correct, requested ISO format ignored.      |
| 04 PDF mass                   | Supported                          | Supported, 18.4 kg with correct row/unit/source.                                                        |
| 05 table sum                  | Supported                          | Supported, 27 + 35 = 62.                                                                                |
| 06 revenue difference         | Wrong source                       | **Partial citation coverage**: 5,520 EUR correct, 2025 source cited, required 2026 source uncited.      |
| 07 batch identifier           | Supported                          | **No inline citation**, despite correct MSX-417 and supplied draft A.                                   |
| 08 positive code input        | Supported                          | Supported return value 4.                                                                               |
| 09 absent CFO                 | Safe abstention                    | Safe abstention.                                                                                        |
| 10 conflicting deadlines      | Safe abstention                    | Safe abstention with both correct dates/sources; final explanatory sentence still lacks its own marker. |
| 11 zero-capacity code input   | Wrong final result 4               | **Fixed**: correct return value 0 with supporting function citation.                                    |
| 12 absent outdoor temperature | Safe abstention                    | Safe abstention with explicit supporting passage.                                                       |

Both repeats are kept outside those first-pass counts. Repeated case 01 stays correct. Repeated case 03 reproduces the exact wrong-source citation and non-ISO date; faster repeated generation does not erase that regression.

## Timing and GPU observations

| Metric                                  |  Baseline first pass (12) | Candidate first pass (12) |
| --------------------------------------- | ------------------------: | ------------------------: |
| Actual context                          |                     4,096 |                     4,096 |
| Chat layers on GPU                      |                     15/33 |                     21/33 |
| First token event, conventional median  |                  62.193 s |                  65.007 s |
| First visible text, conventional median | Not measured consistently |                 65.3815 s |
| Recorded total, conventional median     |                  89.162 s |                 88.9205 s |
| Recorded total, maximum                 |                 132.883 s |                 135.821 s |
| Startup                                 |                  40.638 s |                  47.969 s |
| Indexing                                |                  43.381 s |                  48.388 s |
| Whole-GPU initial / sampled peak        |         1,590 / 3,552 MiB |         1,658 / 3,678 MiB |

The hardware is a GTX 1050 Ti with 4,096 MiB. All candidate queries recorded 4K context and 21/33 layers; this remains partial GPU offload. Baseline's four missing terminal-event observations and whitespace-only first-token events limit direct timing comparability. The candidate captured a terminal event for all 14 observations. Neither run observed timeouts or error events.

There is **no demonstrated first-pass latency improvement** in these aggregate observations. Timing varies per case and the run is not a controlled repeated or randomized timing study. Several interventions changed together: decomposition of style instructions, calculation guidance, memory padding, and query caching. Do not attribute individual differences to one intervention.

The two repeated queries show a narrower useful result:

| Repeated case | First-pass visible / total | Repeat visible / total | Quality                  |
| ------------- | -------------------------: | ---------------------: | ------------------------ |
| 01 revenue    |          61.513 / 71.582 s |      19.357 / 35.023 s | Correct both times.      |
| 03 approval   |          62.512 / 77.878 s |      33.482 / 51.919 s | Wrong source both times. |

Every first-pass query logged one embedder preparation and one chat preparation. Neither repeat logged those preparations, consistent with the cache avoiding the GPU handoff. This supports the tested repeated-query benefit only; two repeats cannot establish broad cache hit rates or tail-latency guarantees.

## Integrity and limits

Models, model hashes, manifest hash, and all extracted source chunk objects exactly match baseline. Six source files produce only nine chunks. The lean retrieval harness disables reranking, generated multi-query, summary/inventory routing, and whole-document fallback. It does not cover large-library selectivity, scanned/mixed-layout PDFs, charts, or long conversations.

`manual.json` records each claim/citation assessment; `review.json` separates repetitions, mechanical flags, observed allocations, and manual verdicts. Passing regex patterns does not establish support. The code-result fix is promising, but the new citation failures mean this combined candidate is not a validated quality replacement. Further development must preserve the frozen held-out split and report its result once the final candidate is chosen.

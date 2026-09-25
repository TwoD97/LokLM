# 8K targeted development review

Six distinct development questions were rerun: 02, 03, 06, 07, 11, and 12. Cases 03 and 11 were repeated once. This is **not a full twelve-question development run**, and none of these observations is held-out evaluation.

Four of five answerable first-pass cases have correct results with supporting passage citations. The missing-temperature case safely abstains. Case 06 still fails exact passage attribution: its 5,520 EUR difference is correct, but it cites plan introduction/approval passage 2:4 instead of the actual planned-revenue table at 2:5. Both document IDs are present, showing that document-level coverage alone is insufficient.

| Case | First-pass review                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| 02   | Supported: 184 completed inspections with ledger citation 1:2.                                                           |
| 03   | Supported: exact requested ISO date 2026-03-09 with approval citation 2:4.                                               |
| 06   | **Unsupported passage attribution**: correct difference; 2025 input cited correctly, 2026 input points to wrong passage. |
| 07   | Supported: MSX-417 with draft A citation 3:6.                                                                            |
| 11   | Supported: return value 0 with function citation 5:8.                                                                    |
| 12   | Safe abstention: no outdoor measurements, explicitly supported by PDF citation 6:9.                                      |

The date and identifier citation regressions of the first 4K candidate are absent here. The corrected code result persists. Both repeated questions remain correct and correctly cited. The unresolved comparison prevents describing all tested answers as grounded.

Every observation recorded actual 8,192-token context and 14/33 GPU layers. The run uses a 1,024 MiB reserve and six inference threads. Model file hashes, the fixture manifest hash, and extracted chunk objects match the development baseline. The application build differs: query cleanup, rank modifiers, citation instructions, context, and thread configuration changed from earlier candidates. **Improvement cannot be attributed to the larger context alone.** The entire tiny corpus already fit into the 4K runs.

For the six first-pass queries, conventional median first-token-event time was 65.3895 s, first visible text 65.648 s, and total time 82.609 s. These are a selected-case mix and must not be compared with twelve-case aggregate medians as a speed effect. All eight observations captured a terminal event; no timeout or stream error was observed. Sampled whole-GPU peak was 3,173 MiB, not an isolated app allocation or guaranteed maximum between samples.

| Repeated case | First-pass visible / total | Repeat visible / total |
| ------------- | -------------------------: | ---------------------: |
| 03 approval   |          62.391 / 78.000 s |      21.927 / 41.813 s |
| 11 code clamp |          66.133 / 78.815 s |      22.218 / 35.597 s |

`manual.json` documents all eight semantic reviews. `review.json` keeps the six first-pass cases separate from the two repeats and lists the six development cases not rerun. A separate control using the identical compiled application is needed to compare thread settings; this run by itself does not establish a thread-policy benefit.

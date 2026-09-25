# Offline replay of native DEV retrieval rankings

The clean question's approval-date passage is dense rank 1 (cosine **0.877151**) and RRF rank 2, but the current heuristics push it to final rank 7. It is only 153 characters long. Removing the short-chunk penalty moves it to rank 4; also removing the response-language preference restores rank 2. This is a concrete relevance-order problem, independent of the model's later citation failure.

The replay uses **recorded native** lexical/dense rankings from the baseline's first query arm, before the separate answer-format suffix polluted fusion. It calls the current production fusion, title, length, recency, language, code-symbol/file, and diversification helpers. Original all-arm final orders and full-precision adjusted scores reproduced exactly for **all 12 DEV cases** before changing either factor. No GPU, embedding, indexing, or generation operation ran. No heldout data was opened.

Reproduction: `pnpm exec tsx tests/evals/native-calibration/replay-native-ranks.ts`. The script refuses to overwrite existing output; pass a new output filename as its optional final argument to retain earlier reports. Its initial report is `tests/evals/native-calibration/reports/dev-4k-baseline/offline-rank-replay.json`, with hashes of the source trace/raw data and production modules. The script does not write raw data or fixture manifests.

## Decisive fact ranks

Notation is document ID:chunk ID. Columns after Original use only the saved clean arm0; no newly rewritten query vector is being approximated.

| Case and decisive fact chunk             | Original all arms | Short0.7 / lang1.1 | Short1 / lang1.1 | Short0.7 / lang1 | Short1 / lang1 |
| ---------------------------------------- | ----------------: | -----------------: | ---------------: | ---------------: | -------------: |
| 01 recorded revenue, 1:2                 |                 3 |                  1 |                2 |                1 |              2 |
| 02 completed inspections, 1:2            |                 7 |                  5 |                5 |                5 |              5 |
| 03 approval date, 2:4                    |                 7 |                  7 |                4 |                7 |              2 |
| 04 PDF mass and unit, 6:9                |                 1 |                  2 |                3 |                1 |              1 |
| 05 accepted-tray arithmetic, 6:9         |                 1 |                  1 |                1 |                1 |              1 |
| 06 prior revenue, 1:2                    |                 3 |                  1 |                1 |                1 |              1 |
| 06 planned revenue, 2:5                  |                 5 |                  3 |                5 |                3 |              5 |
| 07 exact batch identifier, 3:6           |                 2 |                  3 |                3 |                2 |              2 |
| 08 reservation function, 5:8             |                 1 |                  1 |                1 |                1 |              1 |
| 10 conflicting deadline A, 3:6           |                 1 |                  1 |                1 |                1 |              1 |
| 10 conflicting deadline B, 4:7           |                 2 |                  2 |                2 |                2 |              2 |
| 11 reservation function, 5:8             |                 2 |                  1 |                1 |                1 |              1 |
| 12 explicit absence of temperatures, 6:9 |                 1 |                  2 |                3 |                1 |              2 |

Case 09 asks for a CFO name absent from all source passages. It has no decisive positive fact chunk and is excluded from rank metrics. Case 12 differs: the PDF explicitly states the absence of temperature measurements, so it has a supporting negative-evidence passage.

| Configuration             | Decisive passages in top3 (of13) | In top5 (of13) | Cases with every decisive passage in top3 (of11) |
| ------------------------- | -------------------------------: | -------------: | -----------------------------------------------: |
| Original all arms         |                               10 |             11 |                                                8 |
| Clean, short0.7 / lang1.1 |                               11 |             12 |                                                9 |
| Clean, short1 / lang1.1   |                               10 |             13 |                                                8 |
| Clean, short0.7 / lang1   |                               11 |             12 |                                                9 |
| Clean, short1 / lang1     |                               11 |             13 |                                                9 |

## Interpretation and limits

Removing a blanket length penalty prevents a complete concise factual sentence from being treated as lower-quality merely because it is short. It also raises short topic headers: revenue case01 moves from rank1 to2, and the second required comparison passage moves from3 to5. It is therefore a defensible document-specific simplification with an observed tradeoff, not a universal ranking improvement. Removing the same-language preference helps these cross-language PDF and identifier cases; answer language is not necessarily evidence language.

Only nine chunks exist in this manually auditable corpus, most of which fit topK10. Better top5 rank coverage does not demonstrate improved retrieval recall on a large library, and none of these counterfactual rankings demonstrates better generated answers or citations. In particular, a model can still cite an unrelated supplied passage even with the correct evidence present. Native generation of a selected candidate, followed by independent claim-level review, remains necessary.

Structural code workspaces, large multi-document distractor pools, long PDFs, and alternate embedders are outside this replay. Do not infer that their defaults should change. No production retrieval behavior was edited by this investigation.

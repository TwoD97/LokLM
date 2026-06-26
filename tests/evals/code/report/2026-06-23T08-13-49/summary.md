# Code-retrieval eval — by query-type recall

- Embedder: fake · Reranker: bge-reranker-v2-m3
- Corpus: 1870 chunks (1204 code, 666 doc)
- Targets: 8 · Query instruction: `Represent this question to retrieve the source code that answers it:⏎`

**recall@5 per query type** (exact-symbol is the "perfect" query; the rest are noisy).
**gap** = recall@5(exact) − worst noisy recall@5. Lower gap = more even. Ranked by worst-noisy floor.

| Config       | exact | nl-desc | paraphrase | vague | misspelled | worstNoisy |   gap | overall R@1 |   R@5 |  R@10 |   MRR |
| ------------ | ----: | ------: | ---------: | ----: | ---------: | ---------: | ----: | ----------: | ----: | ----: | ----: |
| f1_qinstr    | 0.875 |   0.375 |      0.500 | 0.125 |      0.125 |  **0.125** | 0.750 |       0.075 | 0.400 | 0.550 | 0.216 |
| recall_combo | 1.000 |   0.500 |      0.625 | 0.125 |      0.250 |  **0.125** | 0.875 |       0.175 | 0.500 | 0.625 | 0.288 |
| all_fixes    | 1.000 |   0.375 |      0.500 | 0.125 |      0.375 |  **0.125** | 0.875 |       0.250 | 0.475 | 0.675 | 0.351 |
| all_fixes_rr | 1.000 |   0.375 |      0.500 | 0.125 |      0.375 |  **0.125** | 0.875 |       0.250 | 0.475 | 0.675 | 0.351 |
| prod         | 0.875 |   0.500 |      0.375 | 0.000 |      0.125 |  **0.000** | 0.875 |       0.050 | 0.375 | 0.525 | 0.194 |
| base_norr    | 0.875 |   0.500 |      0.375 | 0.000 |      0.125 |  **0.000** | 0.875 |       0.050 | 0.375 | 0.525 | 0.194 |
| f4_symfts    | 1.000 |   0.500 |      0.375 | 0.000 |      0.250 |  **0.000** | 1.000 |       0.100 | 0.425 | 0.625 | 0.237 |
| f2_shareAll  | 0.875 |   0.500 |      0.375 | 0.000 |      0.125 |  **0.000** | 0.875 |       0.050 | 0.375 | 0.525 | 0.194 |
| f2_fnSubstr  | 0.875 |   0.375 |      0.500 | 0.000 |      0.125 |  **0.000** | 0.875 |       0.125 | 0.375 | 0.575 | 0.247 |
| f3_dynK      | 0.875 |   0.500 |      0.375 | 0.000 |      0.125 |  **0.000** | 0.875 |       0.050 | 0.375 | 0.525 | 0.194 |

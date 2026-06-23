# Code-retrieval eval — by query-type recall

- Embedder: bge-m3 · Reranker: bge-reranker-v2-m3
- Corpus: 1870 chunks (1204 code, 666 doc)
- Targets: 35 · Query instruction: `Represent this question to retrieve the source code that answers it:⏎`

**recall@5 per query type** (exact-symbol is the "perfect" query; the rest are noisy).
**gap** = recall@5(exact) − worst noisy recall@5. Lower gap = more even. Ranked by worst-noisy floor.

| Config       | exact | nl-desc | paraphrase | vague | misspelled | worstNoisy |   gap | overall R@1 |   R@5 |  R@10 |   MRR |
| ------------ | ----: | ------: | ---------: | ----: | ---------: | ---------: | ----: | ----------: | ----: | ----: | ----: |
| all_fixes    | 1.000 |   0.486 |      0.514 | 0.200 |      0.686 |  **0.200** | 0.800 |       0.309 | 0.577 | 0.680 | 0.419 |
| f1_qinstr    | 0.771 |   0.400 |      0.429 | 0.143 |      0.343 |  **0.143** | 0.629 |       0.206 | 0.417 | 0.554 | 0.303 |
| f2_fnSubstr  | 0.857 |   0.429 |      0.514 | 0.143 |      0.343 |  **0.143** | 0.714 |       0.234 | 0.457 | 0.566 | 0.327 |
| f4_symfts    | 1.000 |   0.457 |      0.429 | 0.114 |      0.629 |  **0.114** | 0.886 |       0.229 | 0.526 | 0.646 | 0.354 |
| recall_combo | 1.000 |   0.514 |      0.457 | 0.114 |      0.629 |  **0.114** | 0.886 |       0.234 | 0.543 | 0.657 | 0.364 |
| base_norr    | 0.771 |   0.371 |      0.400 | 0.086 |      0.286 |  **0.086** | 0.686 |       0.189 | 0.383 | 0.531 | 0.284 |
| f2_shareAll  | 0.771 |   0.371 |      0.400 | 0.086 |      0.286 |  **0.086** | 0.686 |       0.189 | 0.383 | 0.531 | 0.284 |
| f3_dynK      | 0.771 |   0.371 |      0.400 | 0.086 |      0.286 |  **0.086** | 0.686 |       0.189 | 0.383 | 0.531 | 0.284 |

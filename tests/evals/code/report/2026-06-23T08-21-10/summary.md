# Code-retrieval eval — by query-type recall

- Embedder: bge-m3 · Reranker: bge-reranker-v2-m3
- Corpus: 1870 chunks (1204 code, 666 doc)
- Targets: 35 · Query instruction: `Represent this question to retrieve the source code that answers it:⏎`

**recall@5 per query type** (exact-symbol is the "perfect" query; the rest are noisy).
**gap** = recall@5(exact) − worst noisy recall@5. Lower gap = more even. Ranked by worst-noisy floor.

| Config       | exact | nl-desc | paraphrase | vague | misspelled | worstNoisy |   gap | overall R@1 |   R@5 |  R@10 |   MRR |
| ------------ | ----: | ------: | ---------: | ----: | ---------: | ---------: | ----: | ----------: | ----: | ----: | ----: |
| prod         | 0.429 |   0.429 |      0.486 | 0.200 |      0.343 |  **0.200** | 0.229 |       0.131 | 0.377 | 0.554 | 0.237 |
| all_fixes_rr | 0.714 |   0.486 |      0.429 | 0.171 |      0.600 |  **0.171** | 0.543 |       0.177 | 0.480 | 0.691 | 0.313 |

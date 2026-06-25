# Code-retrieval eval — by query-type recall

- Embedder: fake · Reranker: bge-reranker-v2-m3
- Corpus: 3055 chunks (2260 code, 795 doc)
- Targets: 5 · Query instruction: `Represent this question to retrieve the source code that answers it:⏎`

**recall@5 per query type** (exact-symbol is the "perfect" query; the rest are noisy).
**gap** = recall@5(exact) − worst noisy recall@5. Lower gap = more even. Ranked by worst-noisy floor.

| Config    | exact | nl-desc | paraphrase | vague | misspelled | worstNoisy |   gap | overall R@1 |   R@5 |  R@10 |   MRR |
| --------- | ----: | ------: | ---------: | ----: | ---------: | ---------: | ----: | ----------: | ----: | ----: | ----: |
| prod      | 0.800 |   0.400 |      0.800 | 0.000 |      0.200 |  **0.000** | 0.800 |       0.160 | 0.440 | 0.560 | 0.262 |
| base_norr | 0.800 |   0.400 |      0.800 | 0.000 |      0.200 |  **0.000** | 0.800 |       0.160 | 0.440 | 0.560 | 0.262 |

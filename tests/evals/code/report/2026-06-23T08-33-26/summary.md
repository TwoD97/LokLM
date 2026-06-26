# Code-retrieval eval — by query-type recall

- Embedder: Qwen3-Embedding-0.6B-Q8_0.gguf · Reranker: bge-reranker-v2-m3
- Corpus: 1870 chunks (1204 code, 666 doc)
- Targets: 35 · Query instruction: `Instruct: Given a question about a codebase, retrieve the source code file that answers it.⏎Query: `

**recall@5 per query type** (exact-symbol is the "perfect" query; the rest are noisy).
**gap** = recall@5(exact) − worst noisy recall@5. Lower gap = more even. Ranked by worst-noisy floor.

| Config       | exact | nl-desc | paraphrase | vague | misspelled | worstNoisy |   gap | overall R@1 |   R@5 |  R@10 |   MRR |
| ------------ | ----: | ------: | ---------: | ----: | ---------: | ---------: | ----: | ----------: | ----: | ----: | ----: |
| all_fixes_rr | 0.657 |   0.514 |      0.514 | 0.257 |      0.657 |  **0.257** | 0.400 |       0.171 | 0.520 | 0.766 | 0.325 |
| prod         | 0.429 |   0.486 |      0.457 | 0.200 |      0.457 |  **0.200** | 0.229 |       0.114 | 0.406 | 0.669 | 0.253 |

# Code-retrieval eval — by query-type recall

- Embedder: Qwen3-Embedding-0.6B-Q8_0.gguf · Reranker: bge-reranker-v2-m3
- Corpus: 3055 chunks (2260 code, 795 doc)
- Targets: 35 · Query instruction: `Instruct: Given a question about a codebase, retrieve the source code file that answers it.⏎Query: `

**recall@5 per query type** (exact-symbol is the "perfect" query; the rest are noisy).
**gap** = recall@5(exact) − worst noisy recall@5. Lower gap = more even. Ranked by worst-noisy floor.

| Config       | exact | nl-desc | paraphrase | vague | misspelled | worstNoisy |   gap | overall R@1 |   R@5 |  R@10 |   MRR |
| ------------ | ----: | ------: | ---------: | ----: | ---------: | ---------: | ----: | ----------: | ----: | ----: | ----: |
| all_fixes    | 1.000 |   0.857 |      0.743 | 0.400 |      0.886 |  **0.400** | 0.600 |       0.486 | 0.777 | 0.857 | 0.604 |
| recall_combo | 1.000 |   0.829 |      0.714 | 0.286 |      0.857 |  **0.286** | 0.714 |       0.463 | 0.737 | 0.829 | 0.577 |
| f5_role      | 0.971 |   0.657 |      0.686 | 0.171 |      0.743 |  **0.171** | 0.800 |       0.406 | 0.646 | 0.754 | 0.516 |
| base_norr    | 0.971 |   0.629 |      0.629 | 0.143 |      0.714 |  **0.143** | 0.829 |       0.366 | 0.617 | 0.714 | 0.476 |

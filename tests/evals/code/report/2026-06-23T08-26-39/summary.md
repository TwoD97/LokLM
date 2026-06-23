# Code-retrieval eval — by query-type recall

- Embedder: Qwen3-Embedding-0.6B-Q8_0.gguf · Reranker: bge-reranker-v2-m3
- Corpus: 1870 chunks (1204 code, 666 doc)
- Targets: 35 · Query instruction: `Instruct: Given a question about a codebase, retrieve the source code file that answers it.⏎Query: `

**recall@5 per query type** (exact-symbol is the "perfect" query; the rest are noisy).
**gap** = recall@5(exact) − worst noisy recall@5. Lower gap = more even. Ranked by worst-noisy floor.

| Config       | exact | nl-desc | paraphrase | vague | misspelled | worstNoisy |   gap | overall R@1 |   R@5 |  R@10 |   MRR |
| ------------ | ----: | ------: | ---------: | ----: | ---------: | ---------: | ----: | ----------: | ----: | ----: | ----: |
| all_fixes    | 1.000 |   0.857 |      0.686 | 0.457 |      0.914 |  **0.457** | 0.543 |       0.486 | 0.783 | 0.874 | 0.607 |
| recall_combo | 1.000 |   0.886 |      0.714 | 0.400 |      0.914 |  **0.400** | 0.600 |       0.514 | 0.783 | 0.857 | 0.625 |
| f4_symfts    | 1.000 |   0.886 |      0.686 | 0.343 |      0.886 |  **0.343** | 0.657 |       0.457 | 0.760 | 0.823 | 0.574 |
| f1_qinstr    | 1.000 |   0.743 |      0.743 | 0.286 |      0.857 |  **0.286** | 0.714 |       0.400 | 0.726 | 0.829 | 0.547 |
| base_norr    | 0.971 |   0.743 |      0.714 | 0.171 |      0.771 |  **0.171** | 0.800 |       0.349 | 0.674 | 0.771 | 0.490 |
